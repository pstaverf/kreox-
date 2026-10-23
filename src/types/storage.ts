import type { GameInput, InventoryItem, Player, PreparedReply, ProcessedMessage, Reply, Reward } from './game.js';

export interface GameStore {
  processed(eventId: string): Promise<ProcessedMessage | null>;
  remember(input: GameInput, reply: Reply): Promise<PreparedReply>;
  player(vkId: number): Promise<Player | null>;
  register(vkId: number, name: string): Promise<Player | null>;
  now(): Promise<Date>;
  claim(player: Player, day: number, reward: Reward, now: Date): Promise<boolean>;
  inventory(vkId: number, page: number): Promise<InventoryItem[]>;
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
