import { game } from '../config/game.js';
import { diceConfig } from '../config/dice.js';
import { parseBankMoney } from '../services/bank-rules.js';
import { diceMinimum } from '../services/dice-rules.js';
import type { BalanceCurrency } from '../types/admin-balance.js';
import type { DiceCommand } from '../types/dice.js';
import { isRecord } from '../utils/validation.js';

export function parseDiceText(text: string | undefined, isChat: boolean): DiceCommand | null {
  if (!isChat || text === undefined || text.length > game.maxMessageLength || !/^кости(?:\s|$)/iu.test(text.trim())) return null;
  const parts = text.trim().toLowerCase().split(/\s+/u).slice(1);
  if (parts.length === 0) return { kind: 'dice_list' };
  let currency: BalanceCurrency = 'kc';
  if (parts[0] === 'донат' || parts[0] === 'евро') { currency = 'euro'; parts.shift(); }
  else if (parts[0] === 'бит' || parts[0] === 'биткоин') { currency = 'bitcoin'; parts.shift(); }
  const amount = parseBankMoney(parts[0] ?? '', currency);
  const slotsText = parts[1] ?? String(diceConfig.minPlayers);
  const slots = /^\d$/.test(slotsText) ? Number(slotsText) : 0;
  if (parts.length > 2 || amount === null || slots < diceConfig.minPlayers || slots > diceConfig.maxPlayers) {
    return { kind: 'dice_invalid', currency, minimum: amount === null && /^(?:0+(?:[.,]0+)?)$/.test(parts[0] ?? '') };
  }
  if (amount < diceMinimum(currency)) return { kind: 'dice_invalid', currency, minimum: true };
  return { kind: 'dice_create', currency, amount, slots };
}
export function parseDicePayload(value: unknown): DiceCommand | null {
  if (!isRecord(value) || (value.command !== 'dice_join' && value.command !== 'dice_leave')) return null;
  if (typeof value.peerId !== 'number' || !Number.isSafeInteger(value.peerId) || value.peerId <= 2_000_000_000
    || typeof value.gameId !== 'number' || !Number.isSafeInteger(value.gameId) || value.gameId < 1) return null;
  return { kind: value.command, peerId: value.peerId, gameId: value.gameId };
}
