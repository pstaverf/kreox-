import type { GameInput, InventoryItem, MiningFarm, Notification, Player, Ranking, RankingMetric, PreparedReply, ProcessedMessage, Reply, Reward } from './game.js';

export interface GameStore {
  processed(eventId: string): Promise<ProcessedMessage | null>;
  remember(input: GameInput, reply: Reply): Promise<PreparedReply>;
  player(vkId: number): Promise<Player | null>;
  register(vkId: number, name: string): Promise<Player | null>;
  now(): Promise<Date>;
  claim(player: Player, day: number, reward: Reward, now: Date): Promise<boolean>;
  inventory(vkId: number, page: number): Promise<InventoryItem[]>;
  inventoryAll(vkId: number): Promise<InventoryItem[]>;
  saveMining(player: Player, farm: MiningFarm, bitcoinDelta: number): Promise<boolean>;
  ranking(metric: RankingMetric, player: Player): Promise<Ranking>;
  saveReferralUrl(vkId: number, url: string): Promise<void>;
  rewardReferral(inviter: Player, newcomer: Player, text: string): Promise<void>;
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
