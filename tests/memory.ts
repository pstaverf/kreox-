import type { CaseRewards, ItemDraft, ItemKind, ItemOffer, ItemResult, PurchaseResult } from '../src/types/items.js';
import type { KeyboardSpec } from '../src/types/game.js';
import { isItemKind, validItemQuantity, validateOffer } from '../src/services/item-rules.js';
import type { BalanceOperation } from '../src/types/admin-balance.js';
import { validBalanceChange } from '../src/services/admin-balance.js';
import type { Promo, PromoActivation, PromoCreation, PromoDraft } from '../src/types/promo.js';
import { promoRedemptionId, promoTotal, validatePromo } from '../src/services/promo-rules.js';
import { accountCapacity, game } from '../src/config/game.js';
import type { GameInput, InventoryItem, InventoryStack, MiningFarm, Notification, Player, PreparedReply, Ranking, RankingMetric, ProcessedMessage, Reply, Reward } from '../src/types/game.js';
import { initialFarm } from '../src/services/mining.js';
import { rankingScore } from '../src/services/rankings.js';
import type { GameDatabase, GameStore } from '../src/types/storage.js';

interface State {
  offers: Map<string, ItemOffer>;
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
  state: State = { offers: new Map(), promos: new Map(), redemptions: new Set(), players: new Map(), items: [], messages: new Map(), registrations: 0, responses: 0, notifications: [] };
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

  async playerByAccountId(accountId: number): Promise<Player | null> {
    return [...this.state.players.values()].find(player => player.accountId === accountId) ?? null;
  }
  async ownedItem(vkId: number, itemId: number): Promise<InventoryItem | null> {
    return this.state.items.find(item => item.vkId === vkId && item.itemId === itemId) ?? null;
  }
  private available(vkId: number, kind: ItemKind, now: Date): InventoryItem[] {
    if (!isItemKind(kind)) {
      throw new Error('Invalid item kind');
    }
    return this.state.items.filter(item => item.vkId === vkId && item.kind === kind
      && (item.reservedUntil === undefined || item.reservedUntil <= now)).sort((a, b) => a.itemId - b.itemId);
  }
  async itemCount(vkId: number, kind: ItemKind, now: Date): Promise<number> {
    return this.available(vkId, kind, now).length;
  }
  async setItemDraft(vkId: number, draft: ItemDraft | null): Promise<void> {
    const player = this.state.players.get(vkId);
    if (player === undefined) {
      throw new Error('Missing item actor');
    }
    if (draft === null) {
      delete player.itemDraft;
    } else {
      player.itemDraft = draft;
    }
  }
  async grantItems(vkId: number, kind: ItemKind, quantity: number): Promise<boolean> {
    if (!isItemKind(kind) || !validItemQuantity(quantity)) {
      throw new Error('Invalid item grant');
    }
    const player = this.state.players.get(vkId);
    if (player === undefined || !Number.isSafeInteger(player.nextItemId) || player.nextItemId < 1 || player.nextItemId > game.maxAmount - quantity) {
      return false;
    }
    for (let index = 0; index < quantity; index += 1) {
      const itemId = player.nextItemId++;
      this.state.items.push({ _id: `${vkId}:${itemId}`, vkId, kind, itemId });
    }
    return true;
  }
  private deleteUnits(units: InventoryItem[]): void {
    const ids = new Set(units.map(item => item._id));
    this.state.items = this.state.items.filter(item => !ids.has(item._id));
  }
  async removeItems(vkId: number, kind: ItemKind, quantity: number, now: Date): Promise<boolean> {
    if (!validItemQuantity(quantity)) {
      throw new Error('Invalid item quantity');
    }
    const units = this.available(vkId, kind, now).slice(0, quantity);
    if (units.length !== quantity) {
      return false;
    }
    this.deleteUnits(units);
    return true;
  }
  async openItems(player: Player, kind: ItemKind, quantity: number, rewards: CaseRewards, now: Date): Promise<ItemResult> {
    if (!validItemQuantity(quantity)) {
      throw new Error('Invalid item quantity');
    }
    if (this.available(player._id, kind, now).length < quantity) {
      return 'items';
    }
    if (player.kc < 0 || player.euro < 0 || player.kc > game.maxAmount - rewards.kc || player.euro > game.maxAmount - rewards.euro) {
      return 'limit';
    }
    await this.removeItems(player._id, kind, quantity, now);
    player.kc += rewards.kc;
    player.euro += rewards.euro;
    return 'ok';
  }
  async giftItems(sender: Player, receiver: Player, kind: ItemKind, quantity: number, now: Date): Promise<ItemResult> {
    if (sender._id === receiver._id || !validItemQuantity(quantity)) {
      throw new Error('Invalid gift');
    }
    const units = this.available(sender._id, kind, now).slice(0, quantity);
    if (units.length !== quantity) {
      return 'items';
    }
    if (!await this.grantItems(receiver._id, kind, quantity)) {
      return 'limit';
    }
    this.deleteUnits(units);
    return 'ok';
  }
  async reserveOffer(offer: ItemOffer, now: Date): Promise<boolean> {
    validateOffer(offer);
    const units = this.available(offer.sellerId, offer.itemKind, now).slice(0, offer.quantity);
    if (units.length !== offer.quantity) {
      return false;
    }
    for (const unit of units) {
      unit.offerId = offer._id;
      unit.reservedUntil = offer.expiresAt;
    }
    this.state.offers.set(offer._id, offer);
    return true;
  }
  async itemOffer(id: string): Promise<ItemOffer | null> {
    return this.state.offers.get(id) ?? null;
  }
  async purchaseOffer(offer: ItemOffer, buyer: Player, seller: Player, now: Date): Promise<PurchaseResult> {
    validateOffer(offer);
    if (offer.buyerId !== buyer._id || offer.sellerId !== seller._id || offer.state !== 'pending') {
      return 'invalid';
    }
    if (offer.expiresAt <= now) {
      offer.state = 'expired';
      return 'expired';
    }
    const units = this.state.items.filter(item => item.vkId === seller._id && item.kind === offer.itemKind
      && item.offerId === offer._id && item.reservedUntil !== undefined && item.reservedUntil > now).slice(0, offer.quantity);
    if (units.length !== offer.quantity) {
      return 'items';
    }
    if (seller.kc < 0 || seller.kc > game.maxAmount - offer.price || buyer.nextItemId > game.maxAmount - offer.quantity) {
      return 'limit';
    }
    if (buyer.kc < offer.price) {
      return 'funds';
    }
    if (!await this.grantItems(buyer._id, offer.itemKind, offer.quantity)) {
      return 'limit';
    }
    buyer.kc -= offer.price;
    seller.kc += offer.price;
    offer.state = 'completed';
    this.deleteUnits(units);
    return 'ok';
  }
  async enqueueItemNotification(id: string, peerId: number, text: string, keyboard: KeyboardSpec): Promise<void> {
    if (this.state.notifications.some(value => value._id === id)) {
      throw new Error('Duplicate notification');
    }
    this.state.notifications.push({ _id: id, peerId, text, keyboard, randomId: ++this.state.responses,
      state: 'pending', nextAttemptAt: new Date(0), attempts: 0 });
  }

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

  async inventory(vkId: number, page: number): Promise<InventoryStack[]> {
    const offset = page * game.inventoryPageSize;
    return this.inventoryStacks(vkId).slice(offset, offset + game.inventoryPageSize + 1);
  }

  async inventoryAll(vkId: number): Promise<InventoryStack[]> {
    return this.inventoryStacks(vkId).slice(0, game.chatInventoryLimit + 1);
  }

  private inventoryStacks(vkId: number): InventoryStack[] {
    const stacks = new Map<ItemKind, InventoryStack>();
    for (const item of this.state.items) {
      if (item.vkId !== vkId) {
        continue;
      }
      const stack = stacks.get(item.kind);
      if (stack === undefined) {
        stacks.set(item.kind, { itemId: item.itemId, kind: item.kind, quantity: 1 });
      } else {
        stack.itemId = Math.min(stack.itemId, item.itemId);
        stack.quantity += 1;
      }
    }
    return [...stacks.values()].sort((left, right) => left.itemId - right.itemId);
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
