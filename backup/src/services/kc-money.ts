import { game } from '../config/game.js';

export const maxWholeKc = Number(BigInt(game.maxAmount) / BigInt(game.kcScale) * BigInt(game.kcScale));

export function roundKcRatio(numerator: bigint, denominator = 1n): number {
  if (numerator < 0n || denominator <= 0n) throw new Error('Invalid KC calculation');
  const unit = denominator * BigInt(game.kcScale);
  const rounded = (numerator * 2n + unit) / (unit * 2n) * BigInt(game.kcScale);
  return Number(rounded > BigInt(maxWholeKc) ? BigInt(maxWholeKc) : rounded);
}

export function roundKc(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > game.maxAmount) throw new Error('Invalid KC amount');
  return roundKcRatio(BigInt(amount));
}

export function isWholeKc(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= maxWholeKc && amount % game.kcScale === 0;
}
