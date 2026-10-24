import { itemConfig } from '../config/items.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { AdminItemCommand, ItemCommand, ItemDraft, ItemKind, PlayerTarget } from '../types/items.js';
import type { GameStore } from '../types/storage.js';
import { assertNever } from '../utils/validation.js';
import { caseRewards, parseItemPrice, parsePlayerTarget, validItemQuantity } from './item-rules.js';
import { boughtText, caseResultText, giftReceivedText, giftSentText, itemCatalogText, itemDetails, itemQuantityText, itemTexts, offerText, soldText } from './item-texts.js';
import { parsePromoInteger } from './promo-rules.js';

export async function resolveStoredTarget(store: GameStore, target: PlayerTarget, resolved: number | null | undefined): Promise<Player | null | 'target'> {
  switch (target.kind) {
    case 'number': return await store.playerByAccountId(target.id) ?? await store.player(target.id);
    case 'vk': return store.player(target.id);
    case 'screen': return resolved === undefined ? 'target' : resolved === null ? null : store.player(resolved);
    default: return assertNever(target);
  }
}
const back = (text: string, kind: ItemKind): Reply => ({ text, keyboard: { kind: 'item_back', itemKind: kind } });

export async function adminItems(store: GameStore, command: AdminItemCommand): Promise<Reply> {
  const reply = (text: string): Reply => ({ text, keyboard: { kind: 'none' } });
  if (command.kind === 'admin_itemlist') {
    return reply(itemCatalogText());
  }
  if (command.kind === 'admin_item_invalid') {
    return reply(itemTexts.adminUsage);
  }
  const entry = itemConfig.catalog.find(item => item.id === command.catalogId);
  if (entry === undefined || command.target.kind === 'screen' || !validItemQuantity(command.quantity)
    || (command.operation === 'take' && command.quantity !== 1)) {
    return reply(itemTexts.adminUsage);
  }
  const receiver = await resolveStoredTarget(store, command.target, undefined);
  if (receiver === null || receiver === 'target') {
    return reply(itemTexts.missing);
  }
  const success = command.operation === 'give' ? await store.grantItems(receiver._id, entry.kind, command.quantity)
    : await store.removeItems(receiver._id, entry.kind, 1, await store.now());
  return reply(success ? itemTexts.done : command.operation === 'take' ? itemTexts.none : itemTexts.limit);
}
export async function itemView(store: GameStore, player: Player, itemKind: ItemKind, use = false): Promise<Reply> {
  const count = await store.itemCount(player._id, itemKind, await store.now());
  return count === 0 ? { text: itemTexts.none, keyboard: { kind: 'profile' } } : {
    text: itemDetails(itemKind, count, use), keyboard: { kind: use ? 'item_use' : 'item_detail', itemKind }
  };
}
async function open(store: GameStore, player: Player, kind: ItemKind, quantity: number, roll: () => number): Promise<Reply> {
  if (!validItemQuantity(quantity)) {
    return back(itemTexts.badQuantity, kind);
  }
  const now = await store.now();
  if (await store.itemCount(player._id, kind, now) < quantity) {
    return back(itemTexts.none, kind);
  }
  const rewards = caseRewards(quantity, roll);
  const result = await store.openItems(player, kind, quantity, rewards, now);
  if (result !== 'ok') {
    return back(result === 'items' ? itemTexts.none : itemTexts.limit, kind);
  }
  await store.setItemDraft(player._id, null);
  return { text: caseResultText(player, rewards), keyboard: { kind: 'item_use', itemKind: kind } };
}
export async function itemAction(store: GameStore, player: Player, command: ItemCommand, input: GameInput, roll: () => number): Promise<Reply> {
  switch (command.kind) {
    case 'item_detail': case 'item_use':
      await store.setItemDraft(player._id, null);
      return itemView(store, player, command.itemKind, command.kind === 'item_use');
    case 'item_custom': case 'item_gift': case 'item_sell': {
      const count = await store.itemCount(player._id, command.itemKind, await store.now());
      if (count === 0) {
        return back(itemTexts.none, command.itemKind);
      }
      const draft: ItemDraft = command.kind === 'item_custom' ? { step: 'custom', itemKind: command.itemKind }
        : { step: 'target', itemKind: command.itemKind, mode: command.kind === 'item_gift' ? 'gift' : 'sale' };
      await store.setItemDraft(player._id, draft);
      return back(command.kind === 'item_custom' ? itemTexts.custom : itemTexts.target, command.itemKind);
    }
    case 'item_open':
      if (![1, 5, 10].includes(command.quantity)) {
        return back(itemTexts.badQuantity, command.itemKind);
      }
      return open(store, player, command.itemKind, command.quantity, roll);
    case 'item_open_confirm': {
      const draft = player.itemDraft;
      if (draft?.step !== 'open_confirm' || draft.token !== command.token) {
        return { text: itemTexts.stale, keyboard: { kind: 'profile' } };
      }
      return open(store, player, draft.itemKind, draft.quantity, roll);
    }
    case 'item_confirm': {
      const draft = player.itemDraft;
      if ((draft?.step !== 'gift_confirm' && draft?.step !== 'sale_confirm') || draft.token !== command.token
        || !validItemQuantity(draft.quantity) || draft.targetId === player._id) {
        return { text: itemTexts.stale, keyboard: { kind: 'profile' } };
      }
      const target = await store.player(draft.targetId);
      if (target === null) {
        return back(itemTexts.missing, draft.itemKind);
      }
      const now = await store.now();
      if (draft.step === 'gift_confirm') {
        const result = await store.giftItems(player, target, draft.itemKind, draft.quantity, now);
        if (result !== 'ok') {
          return back(result === 'items' ? itemTexts.none : itemTexts.limit, draft.itemKind);
        }
        await store.enqueueItemNotification(`gift:${input.eventId}`, target._id,
          giftReceivedText(player, draft.itemKind, draft.quantity), { kind: 'none' });
        await store.setItemDraft(player._id, null);
        return back(giftSentText(target, draft.itemKind, draft.quantity), draft.itemKind);
      }
      const offer = {
        _id: input.eventId, sellerId: player._id, buyerId: target._id, itemKind: draft.itemKind, quantity: draft.quantity,
        price: draft.price, expiresAt: new Date(now.getTime() + itemConfig.offerDurationMs), state: 'pending' as const
      };
      if (!await store.reserveOffer(offer, now)) {
        return back(itemTexts.none, draft.itemKind);
      }
      await store.enqueueItemNotification(`offer:${offer._id}`, target._id, offerText(player, offer), { kind: 'item_offer', offerId: offer._id });
      await store.setItemDraft(player._id, null);
      return back(itemTexts.sent, draft.itemKind);
    }
    case 'item_buy': {
      const offer = await store.itemOffer(command.offerId);
      if (offer === null || offer.buyerId !== player._id || offer.state !== 'pending') {
        return { text: itemTexts.invalidOffer, keyboard: { kind: 'profile' } };
      }
      const seller = await store.player(offer.sellerId);
      if (seller === null) {
        return { text: itemTexts.invalidOffer, keyboard: { kind: 'profile' } };
      }
      const result = await store.purchaseOffer(offer, player, seller, await store.now());
      if (result !== 'ok') {
        const text = result === 'funds' ? itemTexts.funds : result === 'expired' ? itemTexts.expired
          : result === 'invalid' ? itemTexts.invalidOffer : result === 'items' ? itemTexts.none : itemTexts.limit;
        return { text, keyboard: { kind: 'profile' } };
      }
      await store.enqueueItemNotification(`sold:${offer._id}`, seller._id, soldText(player, offer), { kind: 'item_back', itemKind: offer.itemKind });
      return { text: boughtText(player), keyboard: { kind: 'profile' } };
    }
    default: return assertNever(command);
  }
}
export async function itemText(store: GameStore, player: Player, draft: ItemDraft, input: GameInput, resolved: number | null | undefined): Promise<Reply | 'target'> {
  const text = input.text?.trim() ?? '';
  if (/^(отменить|отмена)$/i.test(text)) {
    await store.setItemDraft(player._id, null);
    return { text: itemTexts.cancelled, keyboard: { kind: 'main' } };
  }
  switch (draft.step) {
    case 'custom': {
      const quantity = parsePromoInteger(text);
      if (quantity === null || !validItemQuantity(quantity)) {
        return back(itemTexts.badQuantity, draft.itemKind);
      }
      if (await store.itemCount(player._id, draft.itemKind, await store.now()) < quantity) {
        return back(itemTexts.none, draft.itemKind);
      }
      await store.setItemDraft(player._id, { step: 'open_confirm', itemKind: draft.itemKind, quantity, token: input.eventId });
      return { text: itemTexts.ready, keyboard: { kind: 'item_confirmation', mode: 'open', token: input.eventId } };
    }
    case 'target': {
      const parsed = parsePlayerTarget(text);
      if (parsed === null) {
        return back(itemTexts.missing, draft.itemKind);
      }
      const target = await resolveStoredTarget(store, parsed, resolved);
      if (target === 'target') {
        return 'target';
      }
      if (target === null || target._id === player._id) {
        return back(target === null ? itemTexts.missing : itemTexts.self, draft.itemKind);
      }
      await store.setItemDraft(player._id, { ...draft, step: 'quantity', targetId: target._id });
      return back(itemQuantityText(await store.itemCount(player._id, draft.itemKind, await store.now())), draft.itemKind);
    }
    case 'quantity': {
      const quantity = parsePromoInteger(text);
      if (quantity === null || !validItemQuantity(quantity)) {
        return back(itemTexts.badQuantity, draft.itemKind);
      }
      if (await store.itemCount(player._id, draft.itemKind, await store.now()) < quantity) {
        return back(itemTexts.none, draft.itemKind);
      }
      if (draft.mode === 'sale') {
        await store.setItemDraft(player._id, { step: 'price', itemKind: draft.itemKind, quantity, targetId: draft.targetId });
        return back(itemTexts.price, draft.itemKind);
      }
      await store.setItemDraft(player._id, { step: 'gift_confirm', itemKind: draft.itemKind, targetId: draft.targetId, quantity, token: input.eventId });
      return { text: itemTexts.giftConfirm, keyboard: { kind: 'item_confirmation', mode: 'gift', token: input.eventId } };
    }
    case 'price': {
      const price = parseItemPrice(text);
      if (price === null) {
        return back(itemTexts.badPrice, draft.itemKind);
      }
      await store.setItemDraft(player._id, { ...draft, step: 'sale_confirm', price, token: input.eventId });
      return { text: itemTexts.saleConfirm, keyboard: { kind: 'item_confirmation', mode: 'sale', token: input.eventId } };
    }
    case 'open_confirm':
      return { text: itemTexts.ready, keyboard: { kind: 'item_confirmation', mode: 'open', token: draft.token } };
    case 'gift_confirm':
      return { text: itemTexts.giftConfirm, keyboard: { kind: 'item_confirmation', mode: 'gift', token: draft.token } };
    case 'sale_confirm':
      return { text: itemTexts.saleConfirm, keyboard: { kind: 'item_confirmation', mode: 'sale', token: draft.token } };
    default: return assertNever(draft);
  }
}
