import { mailingConfig } from '../src/config/mailing.js';
import type { MailingCampaign } from '../src/types/mailing.js';
import { rouletteConfig } from '../src/config/roulette.js';
import type { CasinoQuery, CasinoRecord, DirectorDraft } from '../src/types/casino.js';
import { bankConfig } from '../src/config/bank.js';
import { bankDays, depositValue, earlyDepositValue, isDepositDays, safeBankMoney, transferNet } from '../src/services/bank-rules.js';
import type { BankDraft, Deposit, DepositDays } from '../src/types/bank.js';
import { donateConfig } from '../src/config/donate.js';
import { validDonateMoney, validNickname } from '../src/services/donate-rules.js';
import type { DealerPurchase, DealerState, DonateDraft, DonatePurchase } from '../src/types/donate.js';
import type { CaseRewards, ItemDraft, ItemKind, ItemOffer, ItemResult, PurchaseResult } from '../src/types/items.js';
import type { KeyboardSpec } from '../src/types/game.js';
import { isItemKind, validItemQuantity, validateOffer } from '../src/services/item-rules.js';
import type { BalanceCurrency, BalanceOperation } from '../src/types/admin-balance.js';
import { isBalanceCurrency, validBalanceChange } from '../src/services/admin-balance.js';
import type { Promo, PromoActivation, PromoCreation, PromoDraft } from '../src/types/promo.js';
import { promoRedemptionId, promoTotal, validatePromo } from '../src/services/promo-rules.js';
import { accountCapacity, game } from '../src/config/game.js';
import type { GameInput, InventoryItem, InventoryStack, MiningFarm, Notification, Player, PreparedReply, Ranking, RankingMetric, ProcessedMessage, Reply, Reward } from '../src/types/game.js';
import { initialFarm } from '../src/services/mining.js';
import { rankingScore } from '../src/services/rankings.js';
import { DuplicateWriteError, type GameDatabase, type GameStore } from '../src/types/storage.js';

interface State {
  mailingAudience: Map<number, Date>;
  mailingCampaigns: Map<string, MailingCampaign>;
  casino: Map<string, CasinoRecord>;
  deposits: Map<string, Deposit>;
  dealer: DealerState;
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
  state: State = { mailingAudience: new Map(), mailingCampaigns: new Map(), casino: new Map(), deposits: new Map(), dealer: { _id: 'casino', holderId: null, earnedKC: 0, nextChangeAt: new Date(0) }, offers: new Map(), promos: new Map(), redemptions: new Set(), players: new Map(), items: [], messages: new Map(), registrations: 0, responses: 0, notifications: [] };
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
  private queuedNotifications = false;
  notificationsQueued(): boolean { return this.queuedNotifications; }
  constructor(private readonly state: State, private readonly database: MemoryDatabase) {}

  async setDirectorDraft(vkId: number, draft: DirectorDraft | null): Promise<void> {
    const player = this.state.players.get(vkId);
    if (player === undefined) throw new Error('Missing director actor');
    if (draft === null) delete player.directorDraft;
    else player.directorDraft = draft;
  }
  async casinoGet(id: string): Promise<CasinoRecord | null> {
    return structuredClone(this.state.casino.get(id) ?? null);
  }
  async casinoList(query: CasinoQuery, limit: number): Promise<CasinoRecord[]> {
    return structuredClone([...this.state.casino.values()].filter(record => {
      switch (query.kind) {
        case 'dice_chat': return record.kind === 'dice_chat' && record.dueAt <= query.dueAt;
        case 'dice_credit': return record.kind === 'dice_credit' && record.stage === 'pending' && record.dueAt <= query.dueAt;
        case 'jackpot_entries': return record.kind === 'jackpot_entry' && record.roundId === query.roundId && record._id > query.after;
        case 'jackpot_draw': return record.kind === 'jackpot_draw' && record.stage === 'broadcast' && record.dueAt <= query.dueAt;
        case 'roulette_photo': return record.kind === 'round' && record.mode === 'roulette' && record.stage !== 'finished' && record._id > query.after;
        case 'round': return record.kind === 'round' && record.stage !== 'finished' && record.dueAt <= query.dueAt;
        case 'credit': return record.kind === 'credit' && record.stage === 'pending' && record.dueAt <= query.dueAt;
        case 'delivery': return record.kind === 'delivery' && record.stage === 'pending' && record.dueAt <= query.dueAt;
        case 'election': return record.kind === 'election' && record.stage !== 'finished' && record.dueAt <= query.dueAt;
        case 'bet': return record.kind === 'bet' && record.roundId === query.roundId && (query.vkId === undefined || query.vkId === record.vkId) && (query.settled === undefined || query.settled === record.settled);
        case 'bid': return record.kind === 'bid' && record.electionId === query.electionId && (query.settled === undefined || query.settled === record.settled);
        case 'chat': return record.kind === 'chat' && record.active && record._id > query.after;
      }
    }).sort((a, b) => {
      if (query.kind !== 'roulette_photo' && query.kind !== 'jackpot_entries' && 'dueAt' in a && 'dueAt' in b && a.dueAt.getTime() !== b.dueAt.getTime()) return a.dueAt.getTime() - b.dueAt.getTime();
      return a._id.localeCompare(b._id);
    }).slice(0, limit));
  }
  async casinoInsert(record: CasinoRecord): Promise<void> {
    if (this.state.casino.has(record._id) || record.version !== 0) throw new Error('Duplicate casino insert');
    this.state.casino.set(record._id, structuredClone(record));
  }
  async casinoSave(record: CasinoRecord, notAfter?: Date): Promise<void> {
    if (notAfter !== undefined && this.database.time >= notAfter) throw new DuplicateWriteError();
    if (this.state.casino.get(record._id)?.version !== record.version) throw new DuplicateWriteError();
    record.version += 1;
    this.state.casino.set(record._id, structuredClone(record));
  }
  async casinoNotificationDone(id: string): Promise<boolean> {
    const notice = this.state.notifications.find(entry => entry._id === id);
    return notice !== undefined && (notice.state === 'sent' || notice.state === 'failed');
  }
  async casinoDealerIncome(vkId: number, amount: number): Promise<boolean> {
    if (this.state.dealer.holderId !== vkId || this.state.dealer.earnedKC > game.maxAmount - amount) return false;
    this.state.dealer.earnedKC += amount;
    return true;
  }
  async setBankDraft(vkId: number, draft: BankDraft | null): Promise<void> {
    const player = this.state.players.get(vkId);
    if (player === undefined) throw new Error('Missing bank actor');
    if (draft === null) delete player.bankDraft;
    else player.bankDraft = draft;
  }
  async saveSavings(player: Player, balance: number, since: Date, walletDelta: number): Promise<boolean> {
    if (!safeBankMoney(balance) || !Number.isSafeInteger(walletDelta) || !Number.isFinite(since.getTime())) throw new Error('Invalid savings change');
    const wallet = player.kc + walletDelta;
    if (!safeBankMoney(wallet)) return false;
    player.kc = wallet;
    player.savingsBalance = balance;
    player.savingsSince = since;
    return true;
  }
  async transferMoney(sender: Player, receiver: Player, currency: BalanceCurrency, gross: number, net: number): Promise<boolean> {
    if (!isBalanceCurrency(currency) || sender._id === receiver._id || net !== transferNet(gross)) throw new Error('Invalid transfer');
    if (!safeBankMoney(sender[currency]) || !safeBankMoney(receiver[currency]) || sender[currency] < gross || receiver[currency] > game.maxAmount - net) return false;
    sender[currency] -= gross;
    receiver[currency] += net;
    return true;
  }
  async claimPension(player: Player, amount: number, now: Date): Promise<boolean> {
    const age = player.registeredAt === undefined ? 0 : bankDays(player.registeredAt, now);
    const rewards: readonly number[] = age > bankConfig.pensionHighDays ? bankConfig.pensionHigh : bankConfig.pensionBasic;
    if (age < bankConfig.pensionMinDays || !rewards.some(value => value * game.kcScale === amount)) throw new Error('Invalid pension');
    if (!safeBankMoney(player.kc) || player.kc > game.maxAmount - amount || (player.nextPensionAt !== undefined && player.nextPensionAt > now)) return false;
    player.kc += amount;
    player.nextPensionAt = new Date(now.getTime() + bankConfig.dayMs);
    return true;
  }
  async deposits(vkId: number): Promise<Deposit[]> {
    return [...this.state.deposits.values()].filter(deposit => deposit.vkId === vkId && deposit.state === 'active').sort((a, b) => a.depositId - b.depositId).slice(0, bankConfig.maxDeposits + 1);
  }
  async deposit(vkId: number, depositId: number): Promise<Deposit | null> {
    return [...this.state.deposits.values()].find(deposit => deposit.vkId === vkId && deposit.depositId === depositId && deposit.state === 'active') ?? null;
  }
  async nextDueDeposit(now: Date): Promise<Deposit | null> {
    return [...this.state.deposits.values()].filter(deposit => deposit.state === 'active' && deposit.nextAttemptAt <= now && deposit.expiresAt <= now).sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || a._id.localeCompare(b._id))[0] ?? null;
  }
  async createDeposit(player: Player, amount: number, days: DepositDays, now: Date): Promise<Deposit | 'funds' | 'limit'> {
    if (!safeBankMoney(amount) || amount <= 0 || amount > bankConfig.maxDeposit || !isDepositDays(days)) throw new Error('Invalid deposit creation');
    if ((await this.deposits(player._id)).length >= bankConfig.maxDeposits) return 'limit';
    const id = player.nextDepositId ?? 1;
    if (!Number.isSafeInteger(id) || id < 1 || id >= game.maxAmount) return 'limit';
    if (!safeBankMoney(player.kc) || player.kc < amount) return 'funds';
    player.kc -= amount;
    player.nextDepositId = id + 1;
    delete player.bankDraft;
    const expiresAt = new Date(now.getTime() + days * bankConfig.dayMs);
    const deposit: Deposit = { _id: `${player._id}:${id}`, vkId: player._id, depositId: id, amount, days, createdAt: now, expiresAt, nextAttemptAt: expiresAt, state: 'active' };
    this.state.deposits.set(deposit._id, deposit);
    return deposit;
  }
  async closeDeposit(player: Player, deposit: Deposit, payout: number, now: Date, early: boolean): Promise<boolean> {
    if (deposit.vkId !== player._id || payout !== (early ? earlyDepositValue(deposit, now) : depositValue(deposit, deposit.expiresAt))) throw new Error('Invalid deposit payout');
    if (deposit.state !== 'active' || !safeBankMoney(player.kc) || player.kc > game.maxAmount - payout || (early ? deposit.expiresAt <= now : deposit.expiresAt > now)) return false;
    player.kc += payout;
    deposit.state = early ? 'early' : 'completed';
    return true;
  }
  async deferDeposit(deposit: Deposit, now: Date): Promise<void> {
    if (deposit.state === 'active') deposit.nextAttemptAt = new Date(now.getTime() + bankConfig.retryMs);
  }

  async setDonateDraft(vkId: number, draft: DonateDraft | null): Promise<void> {
    const player = this.state.players.get(vkId);
    if (player === undefined) throw new Error('Missing donate actor');
    if (draft === null) delete player.donateDraft;
    else player.donateDraft = draft;
  }
  async changeNickname(player: Player, nickname: string): Promise<DonatePurchase> {
    if (!validNickname(nickname)) throw new Error('Invalid nickname');
    if (!validDonateMoney(player.euro)) return 'limit';
    if (player.euro < donateConfig.nicknameCost) return 'funds';
    player.euro -= donateConfig.nicknameCost;
    player.name = nickname;
    delete player.donateDraft;
    return 'ok';
  }
  async buyThief(player: Player, now: Date): Promise<DonatePurchase | 'active'> {
    if (player.thiefUntil !== undefined && player.thiefUntil > now) return 'active';
    if (!validDonateMoney(player.euro)) return 'limit';
    if (player.euro < donateConfig.subscriptionCost) return 'funds';
    player.euro -= donateConfig.subscriptionCost;
    player.thiefUntil = new Date(now.getTime() + donateConfig.subscriptionMs);
    delete player.donateDraft;
    return 'ok';
  }
  async theftTargetCount(actorId: number, memberIds: readonly number[]): Promise<number> {
    return [...this.state.players.values()].filter(player => player._id !== actorId && memberIds.includes(player._id)).length;
  }
  async theftTarget(actorId: number, memberIds: readonly number[], offset: number): Promise<Player | null> {
    return [...this.state.players.values()].filter(player => player._id !== actorId && memberIds.includes(player._id)).sort((a, b) => a._id - b._id)[offset] ?? null;
  }
  async steal(actor: Player, victim: Player, amount: number, now: Date): Promise<boolean> {
    if (actor._id === victim._id || !Number.isSafeInteger(amount) || amount < 0 || amount % game.kcScale !== 0) throw new Error('Invalid theft');
    if (!validDonateMoney(actor.kc) || !validDonateMoney(actor.stolenKC ?? 0) || !validDonateMoney(victim.kc)) return false;
    if (actor.thiefUntil === undefined || actor.thiefUntil <= now || (actor.nextTheftAt !== undefined && actor.nextTheftAt > now)
      || actor.kc > game.maxAmount - amount || (actor.stolenKC ?? 0) > game.maxAmount - amount || victim.kc < amount) return false;
    actor.kc += amount;
    actor.stolenKC = (actor.stolenKC ?? 0) + amount;
    victim.kc -= amount;
    actor.nextTheftAt = new Date(now.getTime() + donateConfig.theftCooldownMs);
    return true;
  }
  async dealer(): Promise<DealerState> { return structuredClone(this.state.dealer); }
  async hasCroupier(vkId: number): Promise<boolean> {
    return this.state.items.some(item => item.vkId === vkId && item.kind === 'croupier');
  }
  async buyDealer(player: Player, previous: Player | null, state: DealerState, now: Date): Promise<DealerPurchase> {
    if (state.holderId === player._id) return 'self';
    if (state.holderId === null && previous !== null) return 'limit';
    if (!validDonateMoney(player.euro) || !validDonateMoney(state.earnedKC) || (previous !== null && !validDonateMoney(previous.kc))) return 'limit';
    if (state.nextChangeAt > now && !await this.hasCroupier(player._id)) return 'cooldown';
    if (state.holderId !== null && (previous === null || previous._id !== state.holderId || previous.kc > game.maxAmount - state.earnedKC)) return 'limit';
    if (player.euro < donateConfig.dealerCost) return 'funds';
    player.euro -= donateConfig.dealerCost;
    if (previous !== null) previous.kc += state.earnedKC;
    this.state.dealer = { _id: 'casino', holderId: player._id, earnedKC: 0, nextChangeAt: new Date(now.getTime() + donateConfig.dealerCooldownMs) };
    delete player.donateDraft;
    return 'ok';
  }

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
  async hasReservedItems(vkId: number, kind: ItemKind, now: Date): Promise<boolean> {
    if (!isItemKind(kind)) {
      throw new Error('Invalid item kind');
    }
    return this.state.items.some(item => item.vkId === vkId && item.kind === kind
      && item.reservedUntil !== undefined && item.reservedUntil > now);
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
    if (kind === 'croupier') throw new Error('Not a case');
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
  async joinMailing(vkId: number, now = this.database.time): Promise<void> {
    if (!this.state.mailingAudience.has(vkId)) this.state.mailingAudience.set(vkId, new Date(now));
  }
  async createMailing(campaign: MailingCampaign): Promise<void> {
    if (this.state.mailingCampaigns.has(campaign._id)) throw new Error('Duplicate mailing');
    this.state.mailingCampaigns.set(campaign._id, structuredClone(campaign));
  }
  async pendingMailing(): Promise<MailingCampaign | null> {
    return structuredClone([...this.state.mailingCampaigns.values()].filter(campaign => campaign.state === 'pending')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a._id.localeCompare(b._id))[0] ?? null);
  }
  async mailingRecipients(after: number, until: Date): Promise<number[]> {
    return [...this.state.mailingAudience].filter(([vkId, joinedAt]) => vkId > after && joinedAt <= until)
      .map(([vkId]) => vkId).sort((a, b) => a - b).slice(0, mailingConfig.batchSize);
  }
  async saveMailing(campaign: MailingCampaign): Promise<void> {
    if (this.state.mailingCampaigns.get(campaign._id)?.version !== campaign.version) throw new Error('Mailing version mismatch');
    this.state.mailingCampaigns.set(campaign._id, { ...structuredClone(campaign), version: campaign.version + 1 });
  }
  async enqueueMailing(id: string, vkId: number, text: string): Promise<void> {
    if (this.state.notifications.some(notification => notification._id === id)) throw new Error('Duplicate mailing notification');
    this.state.notifications.push({ _id: id, peerId: vkId, text, randomId: ++this.state.responses, priority: 1,
      state: 'pending', nextAttemptAt: new Date(0), attempts: 0 });
    this.queuedNotifications = true;
  }
  async enqueueItemNotification(id: string, peerId: number, text: string, keyboard: KeyboardSpec, roulettePhoto?: number): Promise<void> {
    if (roulettePhoto !== undefined && (!Number.isSafeInteger(roulettePhoto) || roulettePhoto < 0 || roulettePhoto >= rouletteConfig.numbers)) throw new Error('Invalid roulette photo');
    if (this.state.notifications.some(value => value._id === id)) {
      throw new Error('Duplicate notification');
    }
    this.state.notifications.push({ _id: id, peerId, text, keyboard, ...(roulettePhoto === undefined ? {} : { roulettePhoto }), randomId: ++this.state.responses,
      state: 'pending', nextAttemptAt: new Date(0), attempts: 0 });
    this.queuedNotifications = true;
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

  async setCoinOpen(vkId: number, open: boolean): Promise<void> {
    const player = this.state.players.get(vkId);
    if (player === undefined) throw new Error('Missing coin player');
    if (open) player.coinOpen = true;
    else delete player.coinOpen;
  }

  async updateKC(vkId: number, operation: BalanceOperation, amount: number): Promise<boolean> {
    return this.updateBalance(vkId, 'kc', operation, amount);
  }

  async updateBalance(vkId: number, currency: BalanceCurrency, operation: BalanceOperation, amount: number): Promise<boolean> {
    if (!isBalanceCurrency(currency) || !validBalanceChange(operation, amount)) throw new Error('Invalid balance change');
    const player = this.state.players.get(vkId);
    if (player === undefined) return false;
    const balance = player[currency];
    if (operation !== 'set' && (!Number.isSafeInteger(balance) || balance < 0 || balance > game.maxAmount
      || (operation === 'add' && balance > game.maxAmount - amount) || (operation === 'take' && balance < amount))) return false;
    player[currency] = operation === 'set' ? amount : balance + (operation === 'take' ? -amount : amount);
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
      mining: initialFarm(), referrals: 0, stolenKC: 0, registeredAt: new Date(this.database.time)
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
    this.queuedNotifications = true;
  }

}
