import type { BalanceOperation } from '../src/types/admin-balance.js';
import { validBalanceChange } from '../src/services/admin-balance.js';
import type { Promo, PromoActivation, PromoCreation, PromoDraft } from '../src/types/promo.js';
import { promoRedemptionId, promoTotal, validatePromo } from '../src/services/promo-rules.js';
import { accountCapacity, game } from '../src/config/game.js';
import type { GameInput, InventoryItem, MiningFarm, Notification, Player, PreparedReply, Ranking, RankingMetric, ProcessedMessage, Reply, Reward } from '../src/types/game.js';
import { initialFarm } from '../src/services/mining.js';
import { rankingScore } from '../src/services/rankings.js';
import type { GameDatabase, GameStore } from '../src/types/storage.js';

interface State {
  promos: Map<string, Promo>;
  redemptions: Set<string>;
  players: Map<number, Player>;
  items: InventoryItem[];
  messages: Map<string, ProcessedMessage>;
  registrations: number;
  responses: number;
  notifications: Notification[];
}

export class MemoryDatabase implements GameDatabase {
  state: State = { promos: new Map(), redemptions: new Set(), players: new Map(), items: [], messages: new Map(), registrations: 0, responses: 0, notifications: [] };
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

  async setPromoDraft(vkId: number, draft: PromoDraft | null): Promise<void> {
    const player = this.state.players.get(vkId);
    if (player === undefined) {
      throw new Error('Promo owner was not found');
    }
    if (draft === null) {
      delete player.promoDraft;
    } else {
      player.promoDraft = draft;
    }
  }

  async promo(name: string): Promise<Promo | null> {
    const value = this.state.promos.get(name) ?? null;
    if (value !== null) {
      validatePromo(value);
    }
    return value;
  }

  async promos(vkId: number, after: string | null): Promise<Promo[]> {
    return [...this.state.promos.values()].filter(value => value.ownerId === vkId && (after === null || value._id > after))
      .sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0).slice(0, game.promo.pageSize + 1);
  }

  async createPromo(player: Player, promo: Promo): Promise<PromoCreation> {
    validatePromo(promo);
    const total = promoTotal(promo.amount, promo.quantity);
    if (promo.ownerId !== player._id || promo.remaining !== promo.quantity || total === null) {
      throw new Error('Invalid promo funding');
    }
    if (this.state.promos.has(promo._id)) {
      return 'exists';
    }
    if (player[promo.currency] < total || player[promo.currency] > game.maxAmount) {
      return 'funds';
    }
    player[promo.currency] -= total;
    this.state.promos.set(promo._id, promo);
    return 'created';
  }

  async activatePromo(player: Player, promo: Promo): Promise<PromoActivation> {
    validatePromo(promo);
    if (promo.ownerId === player._id) {
      return 'own';
    }
    const id = promoRedemptionId(promo._id, player._id);
    if (this.state.redemptions.has(id)) {
      return 'already';
    }
    if (promo.remaining === 0) {
      return 'empty';
    }
    if (player[promo.currency] < 0 || player[promo.currency] > game.maxAmount - promo.amount) {
      return 'balance_limit';
    }
    player[promo.currency] += promo.amount;
    promo.remaining -= 1;
    this.state.redemptions.add(id);
    return 'redeemed';
  }

  async updateKC(vkId: number, operation: BalanceOperation, amount: number): Promise<boolean> {
    if (!validBalanceChange(operation, amount)) {
      throw new Error('Invalid balance change');
    }
    const player = this.state.players.get(vkId);
    if (player === undefined || (operation === 'add' && (!Number.isSafeInteger(player.kc)
      || player.kc < 0 || player.kc > game.maxAmount - amount))) {
      return false;
    }
    player.kc = operation === 'set' ? amount : player.kc + amount;
    return true;
  }

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
