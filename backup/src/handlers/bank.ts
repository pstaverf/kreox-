import { isBalanceCurrency } from '../services/admin-balance.js';
import { isDepositDays, parseBankMoney, safeBankMoney } from '../services/bank-rules.js';
import { parsePlayerTarget } from '../services/item-rules.js';
import type { BankCommand } from '../types/bank.js';
import { isPositiveId, isRecord } from '../utils/validation.js';

export function parseBankTransfer(text: string | undefined): BankCommand | null {
  const value = text?.trim() ?? '';
  const command = /^(монеты|донат|евро|бит|биткоин)(?=\s|$)/i.exec(value)?.[1]?.toLowerCase();
  if (command === undefined) return null;
  if (value.length > 256) return { kind: 'bank_transfer_invalid' };
  const match = /^(?:монеты|донат|евро|бит|биткоин)\s+(?:(.+)\s+)?(\S+)$/i.exec(value);
  const currency = command === 'монеты' ? 'kc' : command === 'донат' || command === 'евро' ? 'euro' : 'bitcoin';
  const amount = match?.[2] === undefined ? null : parseBankMoney(match[2], currency);
  const target = match?.[1] === undefined ? null : parsePlayerTarget(match[1]);
  if (amount === null || (match?.[1] !== undefined && target === null)) return { kind: 'bank_transfer_invalid' };
  return { kind: 'bank_transfer', currency, target, amount };
}
export function parseBankPayload(value: unknown): BankCommand | null {
  if (!isRecord(value)) return null;
  switch (value.command) {
    case 'city': case 'bank': case 'bank_savings': case 'bank_deposit_money': case 'bank_withdraw_money': case 'bank_transfer_menu': case 'bank_deposits': case 'bank_deposit_create': case 'bank_pension': return { kind: value.command };
    case 'bank_currency': return isBalanceCurrency(value.currency) ? { kind: 'bank_currency', currency: value.currency } : null;
    case 'bank_deposit_amount': return typeof value.amount === 'number' && safeBankMoney(value.amount) ? { kind: 'bank_deposit_amount', amount: value.amount } : null;
    case 'bank_deposit': case 'bank_deposit_early': return typeof value.depositId === 'number' && isPositiveId(value.depositId) ? { kind: value.command, depositId: value.depositId } : null;
    case 'bank_deposit_term':
      if (isDepositDays(value.days) && typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 200) return { kind: 'bank_deposit_term', days: value.days, token: value.token };
      return null;
    case 'bank_deposit_confirm':
      return typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 200 ? { kind: 'bank_deposit_confirm', token: value.token } : null;
    default: return null;
  }
}
