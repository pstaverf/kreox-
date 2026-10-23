import type { PromoCommand, PromoDraft } from './promo.js';

export interface Player {
  _id: number;
  accountId: number;
  name: string;
  kc: number;
  euro: number;
  bitcoin: number;
  reputation: number;
  completedTasks: number;
  bonusDay: number;
  lastBonusAt: Date | null;
  nextBonusAt: Date;
  nextItemId: number;
  mining?: MiningFarm;
  referrals?: number;
  stolenKC?: number;
  referralUrl?: string;
  promoDraft?: PromoDraft;
}

export interface InventoryItem {
  _id: string;
  vkId: number;
  itemId: number;
  kind: 'zhdun_case' | 'referral_case';
}

export type Command =
  | { kind: 'delete_keyboards' }
  | { kind: 'profile' }
  | { kind: 'menu' }
  | { kind: 'bonus' }
  | { kind: 'inventory'; page: number }
  | { kind: 'item'; itemId: number }
  | { kind: 'development' }
  | { kind: 'city' }
  | PromoCommand
  | MiningCommand
  | { kind: 'referrals' }
  | { kind: 'ranking'; metric: RankingMetric };

export type KeyboardSpec =
  | { kind: 'none' }
  | { kind: 'promo' | 'promo_currency' | 'promo_back' }
  | { kind: 'promo_confirm'; token: string }
  | { kind: 'promo_list'; after: string | null }
  | { kind: 'mining' | 'ranking' | 'referrals' }
  | { kind: 'mining_upgrade'; level: number }
  | { kind: 'main' }
  | { kind: 'profile' }
  | { kind: 'inventory'; itemIds: number[]; page: number; hasNext: boolean };

export interface Reply {
  text: string;
  keyboard: KeyboardSpec;
}

export interface PreparedReply extends Reply {
  randomId: number;
}

export interface ProcessedMessage {
  _id: string;
  vkId: number;
  reply: PreparedReply;
}

export interface Counter {
  _id: 'registrations' | 'responses';
  value: number;
}

export interface GameInput {
  eventId: string;
  vkId: number;
  command: Command;
  isChat?: boolean;
  text?: string;
  hasPayload?: boolean;
  referrerId?: number;
}

export type Reward = {
  kc: number;
  bitcoin: number;
  case: boolean;
};

export interface MiningFarm {
  rate: number;
  balance: number;
  remainder: number;
  level: number;
  upgradeCost: number;
  updatedAt: Date;
  activeUntil: Date;
}

export type RankingMetric = 'kc' | 'bitcoin' | 'mining' | 'euro' | 'referrals' | 'reputation' | 'stolenKC';

export type RankedPlayer = Pick<Player, '_id' | 'name' | 'accountId'>
  & Partial<Pick<Player, 'kc' | 'bitcoin' | 'mining' | 'euro' | 'referrals' | 'reputation' | 'stolenKC'>>;

export interface Leader {
  _id: number;
  name: string;
  accountId: number;
  score: number;
}

export interface Ranking {
  leaders: Leader[];
  place: number;
}

export interface Notification {
  _id: string;
  peerId: number;
  text: string;
  randomId: number;
  state: 'pending' | 'sent' | 'failed';
  nextAttemptAt: Date;
  attempts: number;
  leaseId?: string;
}

export type MiningCommand =
  | { kind: 'mining' }
  | { kind: 'mining_start' }
  | { kind: 'mining_withdraw' }
  | { kind: 'mining_upgrade' }
  | { kind: 'mining_confirm'; level: number };
