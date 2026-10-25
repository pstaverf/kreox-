import type { InventoryItem, KeyboardSpec, Player } from './game.js';

export type ItemKind = 'zhdun_case' | 'referral_case' | 'croupier';
export type PlayerTarget = { kind: 'number'; id: number } | { kind: 'vk'; id: number } | { kind: 'screen'; name: string };
export type AdminItemCommand =
  | { kind: 'admin_itemlist' }
  | { kind: 'admin_item_invalid' }
  | { kind: 'admin_item'; operation: 'give' | 'take'; target: PlayerTarget; catalogId: number; quantity: number };
export type ItemCommand =
  | { kind: 'item_detail' | 'item_use' | 'item_custom' | 'item_gift' | 'item_sell'; itemKind: ItemKind }
  | { kind: 'item_open'; itemKind: ItemKind; quantity: number }
  | { kind: 'item_confirm' | 'item_open_confirm'; token: string }
  | { kind: 'item_buy'; offerId: string };
export type ItemDraft =
  | { step: 'custom'; itemKind: ItemKind }
  | { step: 'open_confirm'; itemKind: ItemKind; quantity: number; token: string }
  | { step: 'target'; itemKind: ItemKind; mode: 'gift' | 'sale' }
  | { step: 'quantity'; itemKind: ItemKind; mode: 'gift' | 'sale'; targetId: number }
  | { step: 'price'; itemKind: ItemKind; targetId: number; quantity: number }
  | { step: 'gift_confirm'; itemKind: ItemKind; targetId: number; quantity: number; token: string }
  | { step: 'sale_confirm'; itemKind: ItemKind; targetId: number; quantity: number; price: number; token: string };
export interface ItemOffer {
  _id: string;
  sellerId: number;
  buyerId: number;
  itemKind: ItemKind;
  quantity: number;
  price: number;
  expiresAt: Date;
  state: 'pending' | 'completed' | 'expired';
}
export interface CaseRewards { kc: number; euro: number; counts: number[] }
export type ItemResult = 'ok' | 'items' | 'limit';
export type PurchaseResult = ItemResult | 'funds' | 'expired' | 'invalid';
export type ItemKeyboard =
  | { kind: 'item_detail' | 'item_use' | 'item_back'; itemKind: ItemKind }
  | { kind: 'item_confirmation'; token: string; mode: 'gift' | 'sale' | 'open' }
  | { kind: 'item_offer'; offerId: string };
export interface ItemStore {
  playerByAccountId(accountId: number): Promise<Player | null>;
  ownedItem(vkId: number, itemId: number): Promise<InventoryItem | null>;
  itemCount(vkId: number, kind: ItemKind, now: Date): Promise<number>;
  hasReservedItems(vkId: number, kind: ItemKind, now: Date): Promise<boolean>;
  setItemDraft(vkId: number, draft: ItemDraft | null): Promise<void>;
  grantItems(vkId: number, kind: ItemKind, quantity: number): Promise<boolean>;
  removeItems(vkId: number, kind: ItemKind, quantity: number, now: Date): Promise<boolean>;
  openItems(player: Player, kind: ItemKind, quantity: number, rewards: CaseRewards, now: Date): Promise<ItemResult>;
  giftItems(sender: Player, receiver: Player, kind: ItemKind, quantity: number, now: Date): Promise<ItemResult>;
  reserveOffer(offer: ItemOffer, now: Date): Promise<boolean>;
  itemOffer(id: string): Promise<ItemOffer | null>;
  purchaseOffer(offer: ItemOffer, buyer: Player, seller: Player, now: Date): Promise<PurchaseResult>;
  enqueueItemNotification(id: string, peerId: number, text: string, keyboard: KeyboardSpec, roulettePhoto?: number): Promise<void>;
}
