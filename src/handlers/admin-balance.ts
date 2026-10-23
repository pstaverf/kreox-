import { game } from '../config/game.js';
import type { AdminBalanceCommand } from '../types/admin-balance.js';
import { isPositiveId } from '../utils/validation.js';

export function parseAdminBalance(text: string | undefined): AdminBalanceCommand | null {
  const normalized = text?.trim() ?? '';
  if (!/^!(?:set|add)(?=\s|$)/i.test(normalized)) {
    return null;
  }
  const invalid: AdminBalanceCommand = { kind: 'admin_balance_invalid' };
  if (normalized.length > 256) {
    return invalid;
  }
  const match = /^!(set|add)\s+(?:(?:@id(\d{1,16})|\[id(\d{1,16})\|[^\]\r\n]{1,100}\])\s+)?(\d{1,16})([kк])?$/i.exec(normalized);
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
  const amount = BigInt(whole) * (match[5] === undefined ? 1n : 1000n) * BigInt(game.kcScale);
  return amount <= BigInt(game.maxAmount) ? { kind: 'admin_balance', operation, targetId, amount: Number(amount) } : invalid;
}
