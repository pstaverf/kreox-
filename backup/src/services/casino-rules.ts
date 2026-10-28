import { doubleConfig } from '../config/double.js';
import { roundKc, roundKcRatio } from './kc-money.js';
import type { BalanceCurrency } from '../types/admin-balance.js';
import { rouletteConfig } from '../config/roulette.js';
import { rouletteMultiplier } from './roulette-rules.js';
import { parseBankMoney, safeBankMoney } from './bank-rules.js';
import { assertNever } from '../utils/validation.js';
import { randomBytes } from 'node:crypto';
import { casinoConfig } from '../config/casino.js';
import { game } from '../config/game.js';
import type { CasinoMode, CasinoRandom, CasinoRound, CasinoStake } from '../types/casino.js';

export function nextElection(now: Date): Date {
  return new Date((Math.floor((now.getTime() + casinoConfig.moscowOffsetMs) / casinoConfig.dayMs) + 1) * casinoConfig.dayMs - casinoConfig.moscowOffsetMs);
}
export function casinoRandom(_purpose: string, maximum: number): number {
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > game.maxAmount) throw new Error('Invalid random bound');
  for (let attempt = 0; attempt < 128; attempt += 1) {
    let value = 0n;
    for (const byte of randomBytes(7)) value = (value << 8n) | BigInt(byte);
    value &= (1n << 53n) - 1n;
    if (value < BigInt(maximum)) return Number(value);
    if (maximum < 2 ** 52) {
      const ceiling = (1n << 53n) / BigInt(maximum) * BigInt(maximum);
      if (value < ceiling) return Number(value % BigInt(maximum));
    }
  }
  throw new Error('Random rejection limit');
}
export function cachedCasinoRandom(random: CasinoRandom): CasinoRandom {
  const values = new Map<string, number>();
  return (purpose, maximum) => {
    const key = `${purpose}:${maximum}`;
    const value = values.get(key) ?? random(purpose, maximum);
    if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) throw new Error('Invalid casino randomness');
    values.set(key, value);
    return value;
  };
}
export function selectOutcome(mode: CasinoMode, random: CasinoRandom, key: string): { result: number; bonus: number } {
  if (mode === 'double') {
    let ticket = random(`${key}:double`, doubleConfig.tickets);
    for (const [index, weight] of doubleConfig.weights.entries()) {
      if (ticket < weight) {
        const result = doubleConfig.sectors[index];
        if (result === undefined) throw new Error('Invalid double sector');
        return { result, bonus: 1 };
      }
      ticket -= weight;
    }
    throw new Error('Invalid double ticket');
  }
  if (mode === 'roulette') return { result: random(`${key}:roulette`, rouletteConfig.numbers), bonus: 1 };
  if (mode === 'crash') {
    const roll = random(`${key}:crash`, casinoConfig.crashRandomSize) + 1;
    return { result: Math.max(casinoConfig.crashPrecision, Math.min(casinoConfig.maxCrash, Number(BigInt(casinoConfig.crashReturnPercent) * BigInt(casinoConfig.crashRandomSize) / BigInt(roll)))), bonus: 1 };
  }
  let ticket = random(`${key}:sector`, 52);
  for (const [index, weight] of casinoConfig.weights.entries()) {
    if (ticket < weight) {
      const result = casinoConfig.sectors[index];
      if (result === undefined) throw new Error('Invalid dream sector');
      const bonus = random(`${key}:bonus`, 1000);
      return { result, bonus: bonus === 0 ? 7 : bonus <= 10 ? 2 : 1 };
    }
    ticket -= weight;
  }
  throw new Error('Invalid dream ticket');
}
export function betPayout(mode: CasinoMode, amount: number, target: number, bonus: number): number | null {
  const value = mode === 'crash' ? BigInt(amount) * BigInt(target) / BigInt(casinoConfig.crashPrecision) : mode === 'roulette' ? BigInt(amount) * BigInt(rouletteMultiplier(target)) : mode === 'double' ? BigInt(amount) * BigInt(target) : BigInt(amount) * BigInt(target + 1) * BigInt(bonus);
  return value <= BigInt(game.maxAmount) ? roundKc(Number(value)) : null;
}
export function roundKey(peerId: number, mode: CasinoMode): string { return `round:${peerId}:${mode}`; }
export function closeKey(round: CasinoRound): string { return `${round.roundId}:closed`; }

export function casinoPercent(amount: number, percent: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > game.maxAmount || !Number.isSafeInteger(percent) || percent < 0 || percent > 100) throw new Error('Invalid casino percentage');
  return roundKcRatio(BigInt(amount) * BigInt(percent), 100n);
}

export function parseCasinoStake(text: string): CasinoStake | null {
  switch (text.trim().toLowerCase()) {
    case 'пол': return 'half';
    case 'все': case 'всё': case 'вб': return 'all';
    default: return parseBankMoney(text, 'kc');
  }
}
export function resolveCasinoStake(stake: CasinoStake, wallet: number, currency: BalanceCurrency = 'kc'): number {
  if (!safeBankMoney(wallet)) throw new Error('Invalid casino wallet');
  if (typeof stake === 'number') {
    if (!safeBankMoney(stake)) throw new Error('Invalid casino stake');
    return currency === 'kc' ? roundKc(stake) : stake;
  }
  switch (stake) {
    case 'half': return currency === 'kc' ? roundKcRatio(BigInt(wallet), 2n) : Number(BigInt(wallet) / 2n);
    case 'all': return currency === 'kc' ? roundKc(wallet) : wallet;
    default: return assertNever(stake);
  }
}
