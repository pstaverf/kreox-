import { game } from '../config/game.js';
import { validBossName, validBossColor, trustedPhotoUrl } from '../services/boss-rules.js';
import type { BossCommand } from '../types/boss.js';
import { isRecord } from '../utils/validation.js';
export function parseBossText(text: string | undefined): BossCommand | null {
  if (text === undefined || !/^!cboss(?=\s|$)/iu.test(text.trim())) return null;
  if (text.length > game.maxMessageLength) return { kind: 'boss_invalid' };
  const value = text.trim().replace(/([^\s])(https:\/\/)/gu, '$1 $2');
  const match = /^!cboss\s+(\d{1,16})([kк]{1,2})?\s+(?:«([^»\r\n]+)»|"([^"\r\n]+)"|(\S+))\s+(\S+)(?:\s+(\S+))?$/iu.exec(value);
  if (match?.[1] === undefined || match[6] === undefined) return { kind: 'boss_invalid' };
  const health = BigInt(match[1]) * 1000n ** BigInt(match[2]?.length ?? 0);
  const name = match[3] ?? match[4] ?? match[5] ?? '';
  const color = match[6];
  const photo = match[7] ?? null;
  if (health <= 0n || health > BigInt(game.maxAmount) || !validBossName(name) || !validBossColor(color) || (photo !== null && !trustedPhotoUrl(photo))) return { kind: 'boss_invalid' };
  return { kind: 'boss_create', health: Number(health), name, color, photo };
}
export function parseBossPayload(value: unknown): BossCommand | null {
  if (!isRecord(value)) return null;
  switch (value.command) {
    case 'boss': case 'boss_subscribe': case 'boss_leaders': case 'boss_gym': case 'boss_damage': case 'boss_fight': return { kind: value.command };
    case 'boss_attack':
      return typeof value.token === 'string' && /^[a-f0-9]{32}$/u.test(value.token) && Number.isInteger(value.slot) && typeof value.slot === 'number' && value.slot >= 0 && value.slot < 16 ? { kind: 'boss_attack', token: value.token, slot: value.slot } : null;
    case 'boss_upgrade':
      return typeof value.token === 'string' && /^[a-f0-9]{32}$/u.test(value.token) && typeof value.quantity === 'number' && [1, 10, 100, 1000].includes(value.quantity) ? { kind: 'boss_upgrade', token: value.token, quantity: value.quantity } : null;
    default: return null;
  }
}
