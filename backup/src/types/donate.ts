import type { Player } from './game.js';

export type DonateCommand =
  | { kind: 'donate' | 'donate_nick' | 'donate_thief' | 'donate_dealer' | 'dealer_buy' | 'dealer_view' | 'theft' }
  | { kind: 'donate_confirm' | 'donate_cancel'; token: string };
export type DonateDraft =
  | { step: 'nickname' }
  | { step: 'confirm_nickname'; nickname: string; token: string }
  | { step: 'confirm_thief' | 'confirm_dealer'; token: string };
export interface DealerState {
  _id: 'casino';
  holderId: number | null;
  earnedKC: number;
  nextChangeAt: Date;
}
export type DonatePurchase = 'ok' | 'funds' | 'limit';
export type DealerPurchase = DonatePurchase | 'self' | 'cooldown';
export interface DonateStore {
  setDonateDraft(vkId: number, draft: DonateDraft | null): Promise<void>;
  changeNickname(player: Player, nickname: string): Promise<DonatePurchase>;
  buyThief(player: Player, now: Date): Promise<DonatePurchase | 'active'>;
  theftTargetCount(actorId: number, memberIds: readonly number[]): Promise<number>;
  theftTarget(actorId: number, memberIds: readonly number[], offset: number): Promise<Player | null>;
  steal(actor: Player, victim: Player, amount: number, now: Date): Promise<boolean>;
  dealer(): Promise<DealerState>;
  hasCroupier(vkId: number): Promise<boolean>;
  buyDealer(player: Player, previous: Player | null, state: DealerState, now: Date): Promise<DealerPurchase>;
}
