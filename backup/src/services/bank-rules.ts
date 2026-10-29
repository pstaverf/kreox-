import { roundKc, roundKcRatio } from './kc-money.js';
import { bankConfig } from '../config/bank.js';
import { game } from '../config/game.js';
import type { BalanceCurrency } from '../types/admin-balance.js';
import type { BankCommand, Deposit, DepositDays } from '../types/bank.js';
import type { Command } from '../types/game.js';

export function isBankCommand(command: Command): command is BankCommand {
  return command.kind === 'city' || command.kind === 'bank' || command.kind.startsWith('bank_');
}
export function isDepositDays(value: unknown): value is DepositDays { return value === 3 || value === 10; }
export function safeBankMoney(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value <= game.maxAmount; }
export function bankDays(registeredAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - registeredAt.getTime()) / bankConfig.dayMs));
}
export function transferNet(gross: number, currency: BalanceCurrency = 'kc'): number {
  if (!safeBankMoney(gross) || gross <= 0) throw new Error('Invalid transfer amount');
  return currency === 'kc' ? roundKc(gross) - roundKcRatio(BigInt(gross) * BigInt(bankConfig.transferPercent), 100n)
    : Number(BigInt(gross) * BigInt(100 - bankConfig.transferPercent) / 100n);
}
export function parseBankMoney(text: string, currency: BalanceCurrency): number | null {
  const value = text.trim();
  if (value.length > 64) return null;
  if (currency === 'kc') {
    const match = /^(\d{1,16}|\d{1,3}(?:\.\d{3}){1,5})(?:,(\d{1,2}))?([kк]{1,2})?$/i.exec(value);
    if (match?.[1] === undefined) return null;
    const result = (BigInt(match[1].replaceAll('.', '')) * BigInt(game.kcScale) + BigInt((match[2] ?? '').padEnd(2, '0'))) * 1000n ** BigInt(match[3]?.length ?? 0);
    if (result <= 0n || result > BigInt(game.maxAmount)) return null;
    const rounded = roundKc(Number(result));
    return rounded > 0 ? rounded : null;
  }
  const match = /^(\d{1,16})(?:[.,](\d{1,3}))?([kк]{1,2})?$/i.exec(value);
  if (match?.[1] === undefined) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > (currency === 'euro' ? 2 : 3)) return null;
  const scale = currency === 'euro' ? game.euroScale : game.bitcoinScale;
  const result = (BigInt(match[1]) * BigInt(scale) + BigInt(fraction.padEnd(String(scale).length - 1, '0'))) * 1000n ** BigInt(match[3]?.length ?? 0);
  return result > 0n && result <= BigInt(game.maxAmount) ? Number(result) : null;
}
export function settleSavings(balance: number, since: Date, now: Date): { balance: number; since: Date } {
  if (!safeBankMoney(balance) || !Number.isFinite(since.getTime()) || !Number.isFinite(now.getTime())) throw new Error('Invalid savings state');
  const weeks = Math.max(0, Math.floor((now.getTime() - since.getTime()) / bankConfig.weekMs));
  let value = BigInt(roundKc(balance));
  for (let week = 0; week < weeks; week += 1) {
    const next = BigInt(roundKcRatio(value * BigInt(100 + bankConfig.savingsPercent), 100n));
    if (next === value) break;
    if (next >= BigInt(game.maxAmount)) { value = BigInt(roundKc(game.maxAmount)); break; }
    value = next;
  }
  return { balance: Number(value), since: new Date(since.getTime() + weeks * bankConfig.weekMs) };
}
export function depositValue(deposit: Deposit, now: Date): number {
  if (!isDepositDays(deposit.days) || !safeBankMoney(deposit.amount) || deposit.amount <= 0 || deposit.amount > bankConfig.maxDeposit
    || !Number.isFinite(deposit.createdAt.getTime()) || deposit.expiresAt.getTime() - deposit.createdAt.getTime() !== deposit.days * bankConfig.dayMs) throw new Error('Invalid deposit');
  const duration = deposit.days * bankConfig.dayMs;
  const elapsed = Math.min(duration, Math.max(0, now.getTime() - deposit.createdAt.getTime()));
  return roundKcRatio(BigInt(deposit.amount) * (100n * BigInt(duration) + BigInt(bankConfig.depositRates[deposit.days]) * BigInt(elapsed)), 100n * BigInt(duration));
}
export function earlyDepositValue(deposit: Deposit, now: Date): number {
  const value = depositValue(deposit, now);
  return value - roundKcRatio(BigInt(value) * BigInt(bankConfig.earlyPenaltyPercent), 100n);
}
export function depositButtons(wallet: number): number[] {
  if (!safeBankMoney(wallet)) throw new Error('Invalid wallet');
  return bankConfig.depositPercents.map(percent => roundKcRatio(BigInt(wallet) * BigInt(percent), 100n));
}
