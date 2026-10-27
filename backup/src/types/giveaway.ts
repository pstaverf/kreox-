import type { BalanceCurrency } from './admin-balance.js';
import type { ItemKind } from './items.js';

export type GiveawayReward =
  | { kind: 'currency'; currency: BalanceCurrency; amount: number }
  | { kind: 'item'; itemKind: ItemKind; quantity: number };
export type GiveawayCommand =
  | { kind: 'force_invalid' }
  | { kind: 'force_giveaway'; count: number; reward: GiveawayReward }
  | { kind: 'giveaway_claim'; peerId: number; token: string }
  | { kind: 'giveaway_cancel'; peerId: number; token: string };
export interface GiveawayState {
  _id: string;
  kind: 'giveaway';
  version: number;
  peerId: number;
  token: string;
  reward: GiveawayReward;
  count: number;
  remaining: number;
  stage: 'active' | 'finished' | 'cancelled';
}
export interface GiveawayClaim {
  _id: string;
  kind: 'giveaway_claim';
  version: number;
  vkId: number;
}
