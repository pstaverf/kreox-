import { randomInt } from 'node:crypto';
import { game } from '../config/game.js';
import type { MiningFarm } from '../types/game.js';

export function initialFarm(): MiningFarm {
  return {
    rate: game.mining.initialRate,
    balance: 0,
    remainder: 0,
    level: 0,
    upgradeCost: game.mining.prices[0],
    updatedAt: new Date(0),
    activeUntil: new Date(0)
  };
}

export function settleFarm(farm: MiningFarm, now: Date): MiningFarm {
  if ([farm.rate, farm.balance, farm.remainder, farm.level, farm.upgradeCost].some(value =>
    !Number.isSafeInteger(value) || value < 0 || value > game.maxAmount)
    || farm.rate === 0 || farm.upgradeCost === 0 || farm.remainder >= game.mining.hourMs
    || !Number.isFinite(now.getTime()) || !Number.isFinite(farm.updatedAt.getTime())
    || !Number.isFinite(farm.activeUntil.getTime())) {
    throw new Error('Invalid mining state');
  }
  const end = Math.min(now.getTime(), farm.activeUntil.getTime());
  const elapsed = Math.max(0, end - farm.updatedAt.getTime());
  const numerator = BigInt(farm.rate) * BigInt(elapsed) + BigInt(farm.remainder);
  const amount = BigInt(farm.balance) + numerator / BigInt(game.mining.hourMs);
  const capped = amount >= BigInt(game.maxAmount);
  return {
    ...farm,
    balance: capped ? game.maxAmount : Number(amount),
    remainder: capped ? 0 : Number(numerator % BigInt(game.mining.hourMs)),
    updatedAt: new Date(Math.max(now.getTime(), farm.updatedAt.getTime()))
  };
}

export function nextUpgradeCost(level: number, current: number): number | null {
  if (!Number.isSafeInteger(level) || level < 0 || !Number.isSafeInteger(current) || current <= 0) {
    throw new Error('Invalid upgrade cost');
  }
  const listed = game.mining.prices[level + 1];
  if (listed !== undefined) {
    return listed;
  }
  const numerator = BigInt(current) * BigInt(game.mining.growthNumerator);
  const unit = BigInt(game.mining.growthDenominator) * BigInt(game.mining.precision);
  const cost = ((numerator + unit - 1n) / unit) * BigInt(game.mining.precision);
  return cost <= BigInt(game.maxAmount) ? Number(cost) : null;
}

export function randomMiningIncrease(): number {
  return randomInt(game.mining.minIncrease / game.mining.precision,
    game.mining.maxIncrease / game.mining.precision + 1) * game.mining.precision;
}
