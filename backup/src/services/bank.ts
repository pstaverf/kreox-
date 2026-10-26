import { bankConfig } from '../config/bank.js';
import { game } from '../config/game.js';
import type { BalanceCurrency } from '../types/admin-balance.js';
import type { BankCommand, BankDraft } from '../types/bank.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { GameStore } from '../types/storage.js';
import { assertNever, isPositiveId } from '../utils/validation.js';
import { bankDays, depositButtons, earlyDepositValue, parseBankMoney, safeBankMoney, settleSavings, transferNet } from './bank-rules.js';
import { bankTexts, depositEarlyPrompt, depositEarlySuccessText, depositText, pensionSuccessText, pensionWaitText, savingsPrompt, savingsResult, savingsText, transferPrompt, transferReceivedText, transferSuccessText } from './bank-texts.js';
import { finishDeposit } from './bank-deposits.js';
import { parsePlayerTarget } from './item-rules.js';
import { resolveStoredTarget } from './items.js';

const back = (text: string, destination: 'bank' | 'bank_savings' | 'bank_transfer_menu' | 'bank_deposits' = 'bank'): Reply => ({ text, keyboard: { kind: 'bank_back', destination } });
async function depositMenu(store: GameStore, player: Player): Promise<Reply> {
  return { text: bankTexts.deposits, keyboard: { kind: 'bank_deposits', depositIds: (await store.deposits(player._id)).map(deposit => deposit.depositId) } };
}
async function savings(store: GameStore, player: Player, now: Date) {
  const state = settleSavings(player.savingsBalance ?? 0, player.savingsSince ?? now, now);
  if (!await store.saveSavings(player, state.balance, state.since, 0)) throw new Error('Savings update failed');
  return state;
}
async function transfer(store: GameStore, sender: Player, receiver: Player, currency: BalanceCurrency, amount: number, input: GameInput): Promise<Reply> {
  if (!safeBankMoney(amount) || amount <= 0) return back(bankTexts.invalid, 'bank_transfer_menu');
  if (sender._id === receiver._id) return back(bankTexts.self, 'bank_transfer_menu');
  if (sender[currency] < amount) return back(currency === 'kc' ? bankTexts.funds : bankTexts.fundsCurrency, 'bank_transfer_menu');
  const net = transferNet(amount);
  if (!await store.transferMoney(sender, receiver, currency, amount, net)) return back(bankTexts.limit, 'bank_transfer_menu');
  await store.enqueueItemNotification(`transfer:${input.eventId}`, receiver._id, transferReceivedText(sender, net, currency), { kind: 'none' });
  if (!input.isChat) await store.setBankDraft(sender._id, null);
  return { text: transferSuccessText(receiver, net, currency, input.isChat ?? false), keyboard: { kind: input.isChat ? 'none' : 'bank_transfer_menu' } };
}
async function selectDepositAmount(store: GameStore, player: Player, amount: number, token: string): Promise<Reply> {
  if (!safeBankMoney(amount) || amount <= 0) return back(bankTexts.invalid, 'bank_deposits');
  if (amount > bankConfig.maxDeposit) return back(bankTexts.depositMax, 'bank_deposits');
  if (amount > player.kc) return back(bankTexts.funds, 'bank_deposits');
  await store.setBankDraft(player._id, { step: 'deposit_days', amount, token });
  return { text: bankTexts.depositTerm, keyboard: { kind: 'bank_deposit_term', token } };
}
export async function bankAction(store: GameStore, player: Player, command: BankCommand, input: GameInput, resolved: number | null | undefined, random: (maximum: number) => number): Promise<Reply | 'target'> {
  const now = await store.now();
  if (['city', 'bank', 'bank_savings', 'bank_deposit_money', 'bank_withdraw_money', 'bank_transfer_menu', 'bank_currency', 'bank_deposits', 'bank_deposit_create', 'bank_deposit', 'bank_pension'].some(kind => kind === command.kind)) await store.setBankDraft(player._id, null);
  switch (command.kind) {
    case 'city': return { text: bankTexts.city, keyboard: { kind: 'city' } };
    case 'bank': return { text: bankTexts.bank, keyboard: { kind: 'bank' } };
    case 'bank_savings': return { text: savingsText((await savings(store, player, now)).balance), keyboard: { kind: 'bank_savings' } };
    case 'bank_deposit_money': case 'bank_withdraw_money': {
      const state = await savings(store, player, now);
      const direction = command.kind === 'bank_deposit_money' ? 'in' : 'out';
      await store.setBankDraft(player._id, { step: 'savings_amount', direction });
      return back(savingsPrompt(player, state.balance, direction), 'bank_savings');
    }
    case 'bank_transfer_menu': return { text: bankTexts.transfer, keyboard: { kind: 'bank_transfer_menu' } };
    case 'bank_currency':
      await store.setBankDraft(player._id, { step: 'transfer_target', currency: command.currency });
      return back(bankTexts.target, 'bank_transfer_menu');
    case 'bank_transfer_invalid': return back(bankTexts.usage, 'bank_transfer_menu');
    case 'bank_transfer': {
      const target = command.target ?? (input.replySenderId !== undefined && isPositiveId(input.replySenderId) ? { kind: 'vk', id: input.replySenderId } : null);
      if (target === null) return back(bankTexts.usage, 'bank_transfer_menu');
      const receiver = await resolveStoredTarget(store, target, resolved);
      if (receiver === 'target') return 'target';
      return receiver === null ? back(bankTexts.missing, 'bank_transfer_menu') : transfer(store, player, receiver, command.currency, command.amount, input);
    }
    case 'bank_pension': {
      const age = player.registeredAt === undefined ? 0 : bankDays(player.registeredAt, now);
      if (age < bankConfig.pensionMinDays) return back(bankTexts.young);
      if (player.nextPensionAt !== undefined && player.nextPensionAt > now) return back(pensionWaitText(player.nextPensionAt.getTime() - now.getTime()));
      const rewards = age > bankConfig.pensionHighDays ? bankConfig.pensionHigh : bankConfig.pensionBasic;
      const reward = rewards[random(rewards.length)];
      if (reward === undefined) throw new Error('Invalid pension roll');
      return back(await store.claimPension(player, reward * game.kcScale, now) ? pensionSuccessText(reward * game.kcScale) : bankTexts.limit);
    }
    case 'bank_deposits': return depositMenu(store, player);
    case 'bank_deposit_create':
      if ((await store.deposits(player._id)).length >= bankConfig.maxDeposits) return back(bankTexts.depositLimit, 'bank_deposits');
      await store.setBankDraft(player._id, { step: 'deposit_amount' });
      return { text: bankTexts.depositAmount, keyboard: { kind: 'bank_deposit_amount', amounts: depositButtons(player.kc) } };
    case 'bank_deposit_amount': return selectDepositAmount(store, player, command.amount, input.eventId);
    case 'bank_deposit_term': {
      const draft = player.bankDraft;
      if (draft?.step !== 'deposit_days' || draft.token !== command.token) return back(bankTexts.stale, 'bank_deposits');
      const created = await store.createDeposit(player, draft.amount, command.days, now);
      if (created === 'funds' || created === 'limit') return back(created === 'funds' ? bankTexts.funds : bankTexts.depositLimit, 'bank_deposits');
      return depositMenu(store, player);
    }
    case 'bank_deposit': case 'bank_deposit_early': {
      const deposit = await store.deposit(player._id, command.depositId);
      if (deposit === null) return back(bankTexts.unavailable, 'bank_deposits');
      if (deposit.expiresAt <= now) return back(await finishDeposit(store, deposit, now) ? bankTexts.ended : bankTexts.limit, 'bank_deposits');
      if (command.kind === 'bank_deposit') return { text: depositText(deposit, now), keyboard: { kind: 'bank_deposit_early', depositId: deposit.depositId } };
      const payout = earlyDepositValue(deposit, now);
      await store.setBankDraft(player._id, { step: 'deposit_early', depositId: deposit.depositId, token: input.eventId });
      return { text: depositEarlyPrompt(deposit, payout), keyboard: { kind: 'bank_deposit_confirm', token: input.eventId } };
    }
    case 'bank_deposit_confirm': {
      const draft = player.bankDraft;
      if (draft?.step !== 'deposit_early' || draft.token !== command.token) return back(bankTexts.stale, 'bank_deposits');
      const deposit = await store.deposit(player._id, draft.depositId);
      if (deposit === null) return back(bankTexts.unavailable, 'bank_deposits');
      if (deposit.expiresAt <= now) return back(await finishDeposit(store, deposit, now) ? bankTexts.ended : bankTexts.limit, 'bank_deposits');
      const payout = earlyDepositValue(deposit, now);
      const balance = player.kc + payout;
      if (!await store.closeDeposit(player, deposit, payout, now, true)) return back(bankTexts.limit, 'bank_deposits');
      await store.setBankDraft(player._id, null);
      return back(depositEarlySuccessText(deposit, payout, balance), 'bank_deposits');
    }
    default: return assertNever(command);
  }
}
export async function bankText(store: GameStore, player: Player, draft: BankDraft, input: GameInput, resolved: number | null | undefined): Promise<Reply | 'target'> {
  const text = input.text?.trim() ?? '';
  if (/^(отмена|отменить)$/i.test(text)) { await store.setBankDraft(player._id, null); return back(bankTexts.cancelled); }
  switch (draft.step) {
    case 'savings_amount': {
      const amount = parseBankMoney(text, 'kc');
      if (amount === null) return back(bankTexts.invalid, 'bank_savings');
      const now = await store.now();
      const state = settleSavings(player.savingsBalance ?? 0, player.savingsSince ?? now, now);
      if ((draft.direction === 'in' && player.kc < amount) || (draft.direction === 'out' && state.balance < amount)) return back(bankTexts.funds, 'bank_savings');
      const delta = draft.direction === 'in' ? -amount : amount;
      const wallet = player.kc + delta;
      const balance = state.balance - delta;
      if (!safeBankMoney(wallet) || !safeBankMoney(balance)) return back(bankTexts.limit, 'bank_savings');
      if (!await store.saveSavings(player, balance, now, delta)) return back(bankTexts.limit, 'bank_savings');
      await store.setBankDraft(player._id, null);
      return { text: savingsResult(wallet, balance), keyboard: { kind: 'bank_savings' } };
    }
    case 'transfer_target': {
      const target = parsePlayerTarget(text);
      if (target === null) return back(bankTexts.missing, 'bank_transfer_menu');
      const receiver = await resolveStoredTarget(store, target, resolved);
      if (receiver === 'target') return 'target';
      if (receiver === null || receiver._id === player._id) return back(receiver === null ? bankTexts.missing : bankTexts.self, 'bank_transfer_menu');
      await store.setBankDraft(player._id, { step: 'transfer_amount', targetId: receiver._id, currency: draft.currency });
      return back(transferPrompt(player, receiver, draft.currency), 'bank_transfer_menu');
    }
    case 'transfer_amount': {
      const amount = parseBankMoney(text, draft.currency);
      if (amount === null) return back(bankTexts.invalid, 'bank_transfer_menu');
      const receiver = await store.player(draft.targetId);
      return receiver === null ? back(bankTexts.missing, 'bank_transfer_menu') : transfer(store, player, receiver, draft.currency, amount, input);
    }
    case 'deposit_amount': {
      const amount = parseBankMoney(text, 'kc');
      return amount === null ? back(bankTexts.invalid, 'bank_deposits') : selectDepositAmount(store, player, amount, input.eventId);
    }
    case 'deposit_days': case 'deposit_early': return back(bankTexts.stale, 'bank_deposits');
    default: return assertNever(draft);
  }
}
