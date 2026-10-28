import type { BossStore } from './boss.js';
import type { MailingStore } from './mailing.js';
import type { CasinoStore } from './casino.js';
import type { BankStore } from './bank.js';
import type { DonateStore } from './donate.js';
import type { ItemStore } from './items.js';
import type { BalanceCurrency, BalanceOperation } from './admin-balance.js';
import type { Promo, PromoActivation, PromoCreation, PromoDraft } from './promo.js';
import type { GameInput, InventoryStack, MiningFarm, Notification, Player, Ranking, RankingMetric, PreparedReply, ProcessedMessage, Reply, Reward } from './game.js';

export interface GameStore extends BossStore, ItemStore, DonateStore, BankStore, CasinoStore, MailingStore {
  notificationsQueued(): boolean;
  setCoinOpen(vkId: number, open: boolean): Promise<void>;
  updateBalance(vkId: number, currency: BalanceCurrency, operation: BalanceOperation, amount: number): Promise<boolean>;
  updateKC(vkId: number, operation: BalanceOperation, amount: number): Promise<boolean>;
  setPromoDraft(vkId: number, draft: PromoDraft | null): Promise<void>;
  promo(name: string): Promise<Promo | null>;
  promos(vkId: number, after: string | null): Promise<Promo[]>;
  createPromo(player: Player, promo: Promo): Promise<PromoCreation>;
  activatePromo(player: Player, promo: Promo): Promise<PromoActivation>;
  processed(eventId: string): Promise<ProcessedMessage | null>;
  remember(input: GameInput, reply: Reply): Promise<PreparedReply>;
  player(vkId: number): Promise<Player | null>;
  register(vkId: number, name: string): Promise<Player | null>;
  now(): Promise<Date>;
  claim(player: Player, day: number, reward: Reward, now: Date): Promise<boolean>;
  inventory(vkId: number, page: number): Promise<InventoryStack[]>;
  inventoryAll(vkId: number): Promise<InventoryStack[]>;
  saveMining(player: Player, farm: MiningFarm, bitcoinDelta: number): Promise<boolean>;
  ranking(metric: RankingMetric, player: Player): Promise<Ranking>;
  saveReferralUrl(vkId: number, url: string): Promise<void>;
  rewardReferral(inviter: Player, newcomer: Player, text: string): Promise<boolean>;
}

export interface GameDatabase {
  hasPlayer(vkId: number): Promise<boolean>;
  transaction<T>(action: (store: GameStore) => Promise<T>): Promise<T>;
}

export class DuplicateWriteError extends Error {
  constructor() {
    super('Concurrent unique write');
    this.name = 'DuplicateWriteError';
  }
}

export interface NotificationQueue {
  leaseNotification(leaseId: string): Promise<Notification | null>;
  finishNotification(id: string, leaseId: string, state: 'sent' | 'failed' | 'pending', delayMs: number): Promise<void>;
}
