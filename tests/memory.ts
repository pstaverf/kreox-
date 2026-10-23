import { accountCapacity, game } from '../src/config/game.js';
import type { GameInput, InventoryItem, Player, PreparedReply, ProcessedMessage, Reply, Reward } from '../src/types/game.js';
import type { GameDatabase, GameStore } from '../src/types/storage.js';

interface State {
  players: Map<number, Player>;
  items: InventoryItem[];
  messages: Map<string, ProcessedMessage>;
  registrations: number;
  responses: number;
}

export class MemoryDatabase implements GameDatabase {
  state: State = { players: new Map(), items: [], messages: new Map(), registrations: 0, responses: 0 };
  time = new Date('2026-10-23T00:00:00.000Z');
  failRemember = false;
  private queue: Promise<void> = Promise.resolve();

  async hasPlayer(vkId: number): Promise<boolean> {
    return this.state.players.has(vkId);
  }

  async transaction<T>(action: (store: GameStore) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release = (): void => {};
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const draft = structuredClone(this.state);
    try {
      const result = await action(new MemoryStore(draft, this));
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }

  player(vkId = 1): Player {
    const player = this.state.players.get(vkId);
    if (player === undefined) {
      throw new Error('Missing fixture player');
    }
    return player;
  }
}

class MemoryStore implements GameStore {
  constructor(private readonly state: State, private readonly database: MemoryDatabase) {}

  async processed(eventId: string): Promise<ProcessedMessage | null> {
    return this.state.messages.get(eventId) ?? null;
  }

  async remember(input: GameInput, reply: Reply): Promise<PreparedReply> {
    if (this.database.failRemember) {
      throw new Error('Simulated database failure');
    }
    const prepared = { ...reply, randomId: ++this.state.responses };
    this.state.messages.set(input.eventId, { _id: input.eventId, vkId: input.vkId, reply: prepared });
    return prepared;
  }

  async player(vkId: number): Promise<Player | null> {
    return this.state.players.get(vkId) ?? null;
  }

  async register(vkId: number, name: string): Promise<Player | null> {
    if (this.state.registrations >= accountCapacity) {
      return null;
    }
    const index = this.state.registrations++;
    const player: Player = {
      _id: vkId, name, accountId: index < 50 ? index : index + 1,
      kc: 0, euro: 0, bitcoin: 0, reputation: 0, completedTasks: 0,
      bonusDay: 0, lastBonusAt: null, nextBonusAt: new Date(0), nextItemId: 1
    };
    this.state.players.set(vkId, player);
    return player;
  }

  async now(): Promise<Date> {
    return new Date(this.database.time);
  }

  async claim(player: Player, day: number, reward: Reward, now: Date): Promise<boolean> {
    if (player.kc > game.maxAmount - reward.kc || player.bitcoin > game.maxAmount - reward.bitcoin
      || player.nextItemId > game.maxAmount - (reward.case ? 1 : 0)) {
      return false;
    }
    player.kc += reward.kc;
    player.bitcoin += reward.bitcoin;
    player.bonusDay = day;
    player.lastBonusAt = now;
    player.nextBonusAt = new Date(now.getTime() + game.bonusIntervalMs);
    if (reward.case) {
      this.state.items.push({
        _id: `${player._id}:${player.nextItemId}`,
        vkId: player._id, itemId: player.nextItemId++, kind: 'zhdun_case'
      });
    }
    return true;
  }

  async inventory(vkId: number, page: number): Promise<InventoryItem[]> {
    return this.state.items.filter(item => item.vkId === vkId && item.itemId > page * game.inventoryPageSize)
      .sort((left, right) => left.itemId - right.itemId).slice(0, game.inventoryPageSize + 1);
  }
}
