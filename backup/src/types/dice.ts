import type { BalanceCurrency } from './admin-balance.js';

export type DiceCommand =
  | { kind: 'dice_list' }
  | { kind: 'dice_invalid'; currency: BalanceCurrency; minimum: boolean }
  | { kind: 'dice_create'; currency: BalanceCurrency; amount: number; slots: number }
  | { kind: 'dice_join' | 'dice_leave'; peerId: number; gameId: number };
export interface DiceParticipant { vkId: number; name: string; entryId: string }
export interface DiceGame {
  gameId: number;
  currency: BalanceCurrency;
  amount: number;
  slots: number;
  expiresAt: Date;
  players: DiceParticipant[];
}
export interface DiceChat {
  _id: string;
  kind: 'dice_chat';
  version: number;
  peerId: number;
  lastGame: number;
  games: DiceGame[];
  dueAt: Date;
}
export interface DiceCredit {
  _id: string;
  kind: 'dice_credit';
  version: number;
  vkId: number;
  currency: BalanceCurrency;
  amount: number;
  notice: string;
  stage: 'pending' | 'paid';
  dueAt: Date;
}
