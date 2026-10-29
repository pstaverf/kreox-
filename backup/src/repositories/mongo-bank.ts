import { isWholeKc, roundKc } from '../services/kc-money.js';
import type { ClientSession, Db } from 'mongodb';
import { bankConfig } from '../config/bank.js';
import { game } from '../config/game.js';
import { isBalanceCurrency } from '../services/admin-balance.js';
import { bankDays, depositValue, earlyDepositValue, isDepositDays, safeBankMoney, transferNet } from '../services/bank-rules.js';
import type { BalanceCurrency } from '../types/admin-balance.js';
import type { BankDraft, Deposit, DepositDays } from '../types/bank.js';
import type { Player } from '../types/game.js';
import { MongoDonateStore } from './mongo-donate.js';

export class MongoBankStore extends MongoDonateStore {
  private readonly bankPlayers;
  private readonly bankDeposits;
  constructor(db: Db, private readonly bankSession: ClientSession) {
    super(db, bankSession);
    this.bankPlayers = db.collection<Player>('players');
    this.bankDeposits = db.collection<Deposit>('deposits');
  }
  async setBankDraft(vkId: number, draft: BankDraft | null): Promise<void> {
    const result = await this.bankPlayers.updateOne({ _id: vkId }, draft === null ? { $unset: { bankDraft: '' } } : { $set: { bankDraft: draft } }, { session: this.bankSession });
    if (result.matchedCount !== 1) throw new Error('Missing bank actor');
  }
  async saveSavings(player: Player, balance: number, since: Date, walletDelta: number): Promise<boolean> {
    if (!isWholeKc(balance) || !Number.isSafeInteger(walletDelta) || Math.abs(walletDelta) % game.kcScale !== 0 || !Number.isFinite(since.getTime())) throw new Error('Invalid savings change');
    const result = await this.bankPlayers.updateOne({
      _id: player._id, kc: { $gte: Math.max(0, -walletDelta), $lte: game.maxAmount - Math.max(0, walletDelta) },
      savingsBalance: player.savingsBalance ?? { $exists: false },
      savingsSince: player.savingsSince ?? { $exists: false },
      $expr: { $eq: ['$kc', { $trunc: '$kc' }] }
    }, { $inc: { kc: walletDelta }, $set: { savingsBalance: balance, savingsSince: since } }, { session: this.bankSession });
    return result.matchedCount === 1;
  }
  async transferMoney(sender: Player, receiver: Player, currency: BalanceCurrency, gross: number, net: number): Promise<boolean> {
    if (currency === 'kc' && gross % game.kcScale !== 0) throw new Error('Fractional KC transfer');
    if (currency === 'kc' && (!isWholeKc(sender.kc) || !isWholeKc(receiver.kc))) return false;
    if (!isBalanceCurrency(currency) || sender._id === receiver._id || !safeBankMoney(gross) || gross <= 0 || net !== transferNet(gross, currency)) throw new Error('Invalid transfer');
    if (!safeBankMoney(sender[currency]) || !safeBankMoney(receiver[currency]) || receiver[currency] > game.maxAmount - net) return false;
    const debit = await this.bankPlayers.updateOne({ _id: sender._id, [currency]: { $gte: gross, $lte: game.maxAmount }, $expr: { $eq: [`$${currency}`, { $trunc: `$${currency}` }] } }, { $inc: { [currency]: -gross } }, { session: this.bankSession });
    if (debit.matchedCount !== 1) return false;
    const credit = await this.bankPlayers.updateOne({ _id: receiver._id, [currency]: { $gte: 0, $lte: game.maxAmount - net }, $expr: { $eq: [`$${currency}`, { $trunc: `$${currency}` }] } }, { $inc: { [currency]: net } }, { session: this.bankSession });
    if (credit.matchedCount !== 1) throw new Error('Transfer conflict');
    return true;
  }
  async claimPension(player: Player, amount: number, now: Date): Promise<boolean> {
    const age = player.registeredAt === undefined ? 0 : bankDays(player.registeredAt, now);
    const rewards: readonly number[] = age > bankConfig.pensionHighDays ? bankConfig.pensionHigh : bankConfig.pensionBasic;
    if (age < bankConfig.pensionMinDays || !rewards.some(value => value * game.kcScale === amount)) throw new Error('Invalid pension');
    const result = await this.bankPlayers.updateOne({
      _id: player._id, registeredAt: { $lte: new Date(now.getTime() - bankConfig.pensionMinDays * bankConfig.dayMs) },
      $or: [{ nextPensionAt: { $exists: false } }, { nextPensionAt: { $lte: now } }],
      kc: { $gte: 0, $lte: game.maxAmount - amount }, $expr: { $eq: ['$kc', { $trunc: '$kc' }] }
    }, { $inc: { kc: amount }, $set: { nextPensionAt: new Date(now.getTime() + bankConfig.dayMs) } }, { session: this.bankSession });
    return result.matchedCount === 1;
  }
  async deposits(vkId: number): Promise<Deposit[]> {
    return this.bankDeposits.find({ vkId, state: 'active' }, { session: this.bankSession }).sort({ depositId: 1 }).limit(bankConfig.maxDeposits + 1).toArray();
  }
  async deposit(vkId: number, depositId: number): Promise<Deposit | null> {
    return this.bankDeposits.findOne({ vkId, depositId, state: 'active' }, { session: this.bankSession });
  }
  async nextDueDeposit(now: Date): Promise<Deposit | null> {
    return this.bankDeposits.find({ state: 'active', nextAttemptAt: { $lte: now }, expiresAt: { $lte: now } }, { session: this.bankSession }).sort({ nextAttemptAt: 1, _id: 1 }).limit(1).next();
  }
  async createDeposit(player: Player, amount: number, days: DepositDays, now: Date): Promise<Deposit | 'funds' | 'limit'> {
    amount = roundKc(amount);
    if (!safeBankMoney(amount) || amount <= 0 || amount > bankConfig.maxDeposit || !isDepositDays(days)) throw new Error('Invalid deposit creation');
    if ((await this.deposits(player._id)).length >= bankConfig.maxDeposits) return 'limit';
    const id = player.nextDepositId ?? 1;
    if (!Number.isSafeInteger(id) || id < 1 || id >= game.maxAmount) return 'limit';
    const debit = await this.bankPlayers.updateOne({
      _id: player._id, kc: { $gte: amount, $lte: game.maxAmount }, nextDepositId: player.nextDepositId ?? { $exists: false },
      $expr: { $eq: ['$kc', { $trunc: '$kc' }] }
    }, { $inc: { kc: -amount }, $set: { nextDepositId: id + 1 }, $unset: { bankDraft: '' } }, { session: this.bankSession });
    if (debit.matchedCount !== 1) return 'funds';
    const expiresAt = new Date(now.getTime() + days * bankConfig.dayMs);
    const deposit: Deposit = { _id: `${player._id}:${id}`, vkId: player._id, depositId: id, amount, days, createdAt: now, expiresAt, nextAttemptAt: expiresAt, state: 'active' };
    if (!(await this.bankDeposits.insertOne(deposit, { session: this.bankSession })).acknowledged) throw new Error('Deposit insert failed');
    return deposit;
  }
  async closeDeposit(player: Player, deposit: Deposit, payout: number, now: Date, early: boolean): Promise<boolean> {
    if (deposit.vkId !== player._id || payout !== (early ? earlyDepositValue(deposit, now) : depositValue(deposit, deposit.expiresAt))) throw new Error('Invalid deposit payout');
    if (!safeBankMoney(player.kc) || player.kc > game.maxAmount - payout) return false;
    const claimed = await this.bankDeposits.updateOne({
      _id: deposit._id, vkId: player._id, state: 'active',
      expiresAt: early ? { $gt: now } : { $lte: now },
      $expr: early ? { $gt: ['$expiresAt', '$$NOW'] } : { $lte: ['$expiresAt', '$$NOW'] }
    }, { $set: { state: early ? 'early' : 'completed' } }, { session: this.bankSession });
    if (claimed.matchedCount !== 1) return false;
    const credited = await this.bankPlayers.updateOne({ _id: player._id, kc: { $gte: 0, $lte: game.maxAmount - payout }, $expr: { $eq: ['$kc', { $trunc: '$kc' }] } }, { $inc: { kc: payout } }, { session: this.bankSession });
    if (credited.matchedCount !== 1) throw new Error('Deposit payout conflict');
    return true;
  }
  async deferDeposit(deposit: Deposit, now: Date): Promise<void> {
    await this.bankDeposits.updateOne({ _id: deposit._id, state: 'active' }, { $set: { nextAttemptAt: new Date(now.getTime() + bankConfig.retryMs) } }, { session: this.bankSession });
  }
}
