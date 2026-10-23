import { accountCapacity, game } from '../src/config/game.js';
import type { GameInput, InventoryItem, MiningFarm, Notification, Player, PreparedReply, Ranking, RankingMetric, ProcessedMessage, Reply, Reward } from '../src/types/game.js';
import { initialFarm } from '../src/services/mining.js';
import { rankingScore } from '../src/services/rankings.js';
import type { GameDatabase, GameStore } from '../src/types/storage.js';

interface State {
  players: Map<number, Player>;
  items: InventoryItem[];
  messages: Map<string, ProcessedMessage>;
  registrations: number;
  responses: number;
  notifications: Notification[];
}

export class MemoryDatabase implements GameDatabase {
  state: State = { players: new Map(), items: [], messages: new Map(), registrations: 0, responses: 0, notifications: [] };
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
      bonusDay: 0, lastBonusAt: null, nextBonusAt: new Date(0), nextItemId: 1,
      mining: initialFarm(), referrals: 0, stolenKC: 0
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

  async inventoryAll(vkId: number): Promise<InventoryItem[]> {
    return this.state.items.filter(item => item.vkId === vkId)
      .sort((a, b) => a.itemId - b.itemId).slice(0, game.chatInventoryLimit + 1);
  }

  async saveMining(player: Player, farm: MiningFarm, bitcoinDelta: number): Promise<boolean> {
    if (player.bitcoin < Math.max(0, -bitcoinDelta) || player.bitcoin > game.maxAmount - Math.max(0, bitcoinDelta)) {
      return false;
    }
    player.bitcoin += bitcoinDelta;
    player.mining = farm;
    return true;
  }

  async ranking(metric: RankingMetric, player: Player): Promise<Ranking> {
    const ordered = [...this.state.players.values()].sort((a, b) =>
      rankingScore(b, metric) - rankingScore(a, metric) || a.accountId - b.accountId);
    return {
      leaders: ordered.slice(0, game.leaderboardSize).map(value => ({
        _id: value._id, name: value.name, accountId: value.accountId, score: rankingScore(value, metric)
      })),
      place: ordered.findIndex(value => value._id === player._id) + 1
    };
  }

  async saveReferralUrl(vkId: number, url: string): Promise<void> {
    const player = this.state.players.get(vkId);
    if (player === undefined) {
      throw new Error('Missing player');
    }
    player.referralUrl = url;
  }

  async rewardReferral(inviter: Player, newcomer: Player, text: string): Promise<void> {
    if (inviter._id === newcomer._id || inviter.kc > game.maxAmount - game.referralRewardKC
      || inviter.nextItemId >= game.maxAmount || (inviter.referrals ?? 0) >= game.maxAmount) {
      throw new Error('Referral reward limits exceeded');
    }
    const itemId = inviter.nextItemId++;
    inviter.kc += game.referralRewardKC;
    inviter.referrals = (inviter.referrals ?? 0) + 1;
    this.state.items.push({ _id: `${inviter._id}:${itemId}`, vkId: inviter._id, itemId, kind: 'referral_case' });
    this.state.notifications.push({
      _id: `referral:${newcomer._id}`, peerId: inviter._id, text, randomId: ++this.state.responses,
      state: 'pending', nextAttemptAt: new Date(0), attempts: 0
    });
  }

}
