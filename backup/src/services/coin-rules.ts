import { roundKcRatio } from './kc-money.js';
import { createHash } from 'node:crypto';
import { privateCasinoConfig } from '../config/private-casino.js';
import { game } from '../config/game.js';
import { safeBankMoney } from './bank-rules.js';
import type { CoinState } from '../types/private-casino.js';

export function coinMultiplier(step: number): number {
  const value = privateCasinoConfig.coinMultipliers[step - 1];
  if (value === undefined || !Number.isSafeInteger(step)) throw new Error('Invalid coin step');
  return value;
}
export function coinPayout(amount: number, step: number): number | null {
  if (!safeBankMoney(amount)) throw new Error('Invalid coin amount');
  const value = BigInt(amount) * BigInt(coinMultiplier(step)) / BigInt(privateCasinoConfig.multiplierScale);
  return value > BigInt(game.maxAmount) ? null : roundKcRatio(BigInt(amount) * BigInt(coinMultiplier(step)), BigInt(privateCasinoConfig.multiplierScale));
}
export function coinActive(state: CoinState): boolean { return state.stage === 'staked' || state.stage === 'playing'; }
export function coinKey(vkId: number): string { return `coin:${vkId}`; }
export function coinSession(eventId: string): string { return createHash('sha256').update(eventId).digest('hex'); }
