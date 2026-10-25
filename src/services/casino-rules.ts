import { randomBytes } from 'node:crypto';
import { casinoConfig } from '../config/casino.js';
import { game } from '../config/game.js';
import type { CasinoMode, CasinoRandom, CasinoRound } from '../types/casino.js';

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
  const value = mode === 'crash' ? BigInt(amount) * BigInt(target) / BigInt(casinoConfig.crashPrecision) : BigInt(amount) * BigInt(target + 1) * BigInt(bonus);
  return value <= BigInt(game.maxAmount) ? Number(value) : null;
}
export function roundKey(peerId: number, mode: CasinoMode): string { return `round:${peerId}:${mode}`; }
export function closeKey(round: CasinoRound): string { return `${round.roundId}:closed`; }

export function casinoPercent(amount: number, percent: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > game.maxAmount || !Number.isSafeInteger(percent) || percent < 0 || percent > 100) throw new Error('Invalid casino percentage');
  return Number(BigInt(amount) * BigInt(percent) / 100n);
}
