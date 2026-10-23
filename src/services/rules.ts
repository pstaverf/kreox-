import { game } from '../config/game.js';
import type { Player, Reward } from '../types/game.js';

export function bonusDay(player: Pick<Player, 'lastBonusAt' | 'bonusDay'>, now: Date): number {
  if (player.lastBonusAt === null || now.getTime() - player.lastBonusAt.getTime() >= game.bonusResetMs) {
    return 1;
  }
  return player.bonusDay % game.rewards.length + 1;
}

export function rewardForDay(day: number): Reward {
  const reward = game.rewards[day - 1];
  if (!Number.isSafeInteger(day) || reward === undefined) {
    throw new Error('Invalid bonus day');
  }
  return reward;
}

export function availableAccountIds(taken: readonly number[]): number[] {
  const occupied = new Set(taken);
  return Array.from(
    { length: game.randomAccountMax - game.randomAccountMin + 1 },
    (_, index) => index + game.randomAccountMin
  ).filter(id => !occupied.has(id));
}

export function normalizeName(name: string): string {
  const safe = name.replace(/[\[\]|@*\r\n\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 80);
  return safe || 'Игрок';
}
