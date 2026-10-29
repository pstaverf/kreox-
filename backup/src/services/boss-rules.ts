import { createHash } from 'node:crypto';
import { bossConfig } from '../config/boss.js';
import { game } from '../config/game.js';
import type { BossCommand } from '../types/boss.js';
import type { CasinoRandom } from '../types/casino.js';
import type { Command } from '../types/game.js';
export function isBossCommand(command: Command): command is BossCommand { return command.kind.startsWith('boss'); }
export function trustedPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 1000 && url.protocol === 'https:' && url.hostname === 'cdn.kleymorf.xyz' && !url.username && !url.password && !url.port && !url.hash;
  } catch { return false; }
}
export function validBossName(name: string): boolean { return name.trim() === name && name.length > 0 && Buffer.byteLength(JSON.stringify(name), 'utf8') <= bossConfig.maxNameBytes + 2 && !/[\r\n\[\]|<>]/u.test(name); }
export function validBossColor(color: string): boolean { return color.length <= 16 && /\p{Extended_Pictographic}/u.test(color) && !/[^\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]/u.test(color); }
export function bossToken(eventId: string): string { return createHash('sha256').update(eventId).digest('hex').slice(0, 32); }
export function bossPower(level: number): number {
  const value = 1n + BigInt(level) * BigInt(bossConfig.damagePerLevel);
  if (!Number.isSafeInteger(level) || level < 0 || value > BigInt(game.maxAmount)) throw new Error('Invalid boss damage level');
  return Number(value);
}
export function upgradeCost(level: number, quantity: number): number | null {
  if (!Number.isSafeInteger(level) || level < 0 || ![1, 10, 100, 1000].includes(quantity)) throw new Error('Invalid boss upgrade');
  const count = BigInt(quantity);
  const next = BigInt(level) + count;
  if (1n + next * 3n > BigInt(game.maxAmount)) return null;
  const cost = count * (2n * BigInt(bossConfig.baseUpgrade) + BigInt(bossConfig.upgradeGrowth) * (2n * BigInt(level) + count - 1n)) / 2n * BigInt(game.kcScale);
  return cost > BigInt(game.maxAmount) ? null : Number(cost);
}
export function bossBoard(random: CasinoRandom, key: string, previous = -1): string[] {
  const pool: string[] = [...bossConfig.emojis];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const target = random(`${key}:emoji:${index}`, index + 1);
    const left = pool[index];
    const right = pool[target];
    if (left === undefined || right === undefined) throw new Error('Invalid boss board random');
    pool[index] = right;
    pool[target] = left;
  }
  const board = pool.slice(0, 16);
  let sword = random(`${key}:sword`, previous < 0 ? 16 : 15);
  if (previous >= 0 && sword >= previous) sword += 1;
  board[sword] = '⚔️';
  if (board.length !== 16 || board.filter(value => value === '⚔️').length !== 1) throw new Error('Invalid boss board');
  return board;
}
export function bossCaseKind(color: string, name: string): `boss_case:${string}` { return `boss_case:${color}:${name}`; }
export function bossCaseDetails(kind: string): { color: string; name: string } | null {
  const match = /^boss_case:([^:]+):(.+)$/u.exec(kind);
  return match?.[1] !== undefined && match[2] !== undefined && validBossColor(match[1]) && validBossName(match[2]) ? { color: match[1], name: match[2] } : null;
}
