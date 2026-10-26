import { game } from '../config/game.js';
import type { AdminBalanceCommand } from '../types/admin-balance.js';
import { isPositiveId } from '../utils/validation.js';

export function parseAdminBalance(text: string | undefined): AdminBalanceCommand | null {
  const normalized = text?.trim() ?? '';
  const wallet = /^!(set|add|take)(donut|bit)(?=\s|$)/i.exec(normalized);
  if (wallet !== null) return parseWalletBalance(normalized, wallet[2]?.toLowerCase() === 'donut' ? 'euro' : 'bitcoin');
  if (!/^!(?:set|add)(?=\s|$)/i.test(normalized)) {
    return null;
  }
  const invalid: AdminBalanceCommand = { kind: 'admin_balance_invalid' };
  if (normalized.length > 256) {
    return invalid;
  }
  const match = /^!(set|add)\s+(?:(?:@id(\d{1,16})|\[id(\d{1,16})\|[^\]\r\n]{1,100}\])\s+)?(\d{1,16})([kк]{1,2})?$/i.exec(normalized);
  if (match === null) {
    return invalid;
  }
  const operation = match[1]?.toLowerCase();
  const whole = match[4];
  if ((operation !== 'set' && operation !== 'add') || whole === undefined) {
    return invalid;
  }
  const rawTarget = match[2] ?? match[3];
  const targetId = rawTarget === undefined ? null : Number(rawTarget);
  if (targetId !== null && !isPositiveId(targetId)) {
    return invalid;
  }
  const amount = BigInt(whole) * (1000n ** BigInt(match[5]?.length ?? 0)) * BigInt(game.kcScale);
  return amount <= BigInt(game.maxAmount) ? { kind: 'admin_balance', operation, targetId, amount: Number(amount) } : invalid;
}

function parseWalletBalance(text: string, currency: 'euro' | 'bitcoin'): AdminBalanceCommand {
  const invalid: AdminBalanceCommand = { kind: 'admin_balance_invalid', currency };
  if (text.length > 256) return invalid;
  const match = /^!(set|add|take)(?:donut|bit)\s+(?:(\d{1,16}|@?id\d{1,16}|\[id\d{1,16}\|[^\]\r\n]{1,100}\])\s+)?(\d{1,16})(?:[.,](\d{1,3}))?([kк])?$/i.exec(text);
  const operation = match?.[1]?.toLowerCase();
  const whole = match?.[3];
  if ((operation !== 'set' && operation !== 'add' && operation !== 'take') || whole === undefined) return invalid;
  const rawTarget = match?.[2];
  const targetMatch = rawTarget === undefined ? undefined : /^(?:@?id(\d+)|\[id(\d+)\|[^\]]+\]|(\d+))$/i.exec(rawTarget);
  const targetId = rawTarget === undefined ? null : Number(targetMatch?.[1] ?? targetMatch?.[2] ?? targetMatch?.[3]);
  if (targetId !== null && !isPositiveId(targetId)) return invalid;
  const digits = currency === 'euro' ? 2 : 8;
  const maxDecimals = currency === 'euro' ? 2 : 3;
  const fraction = match?.[4] ?? '';
  if (fraction.length > maxDecimals) return invalid;
  const scale = currency === 'euro' ? game.euroScale : game.bitcoinScale;
  const amount = (BigInt(whole) * BigInt(scale) + BigInt(fraction.padEnd(digits, '0'))) * (match?.[5] === undefined ? 1n : 1000n);
  return amount <= BigInt(game.maxAmount) ? { kind: 'admin_balance', operation, targetId, amount: Number(amount), currency } : invalid;
}
