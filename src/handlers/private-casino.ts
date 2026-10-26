import { privateCasinoConfig } from '../config/private-casino.js';
import type { PrivateCasinoCommand } from '../types/private-casino.js';
import { isRecord } from '../utils/validation.js';

export function parsePrivateCasinoPayload(value: unknown): PrivateCasinoCommand | null {
  if (!isRecord(value)) return null;
  if (value.command === 'casino' || value.command === 'casino_chats' || value.command === 'jackpot' || value.command === 'jackpot_join' || value.command === 'coin') return { kind: value.command };
  if (typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 200 || typeof value.step !== 'number'
    || !Number.isSafeInteger(value.step) || value.step < 0 || value.step > privateCasinoConfig.coinMultipliers.length) return null;
  if (value.command === 'coin_cashout') return { kind: 'coin_cashout', token: value.token, step: value.step };
  if (value.command === 'coin_flip' && (value.side === 'diamond' || value.side === 'emerald')) return { kind: 'coin_flip', side: value.side, token: value.token, step: value.step };
  return null;
}
