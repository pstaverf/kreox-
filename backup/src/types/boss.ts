import type { Ranking } from './game.js';
export type BossCommand =
  | { kind: 'boss' }
  | { kind: 'boss_subscribe' }
  | { kind: 'boss_leaders' }
  | { kind: 'boss_gym' }
  | { kind: 'boss_damage' }
  | { kind: 'boss_fight' }
  | { kind: 'boss_invalid' }
  | { kind: 'boss_create'; health: number; name: string; color: string; photo: string | null }
  | { kind: 'boss_attack'; token: string; slot: number }
  | { kind: 'boss_upgrade'; token: string; quantity: number };
export type BossKeyboard =
  | { kind: 'boss_none' | 'boss_notice' | 'boss_menu' | 'boss_gym' }
  | { kind: 'boss_upgrade'; token: string }
  | { kind: 'boss_fight'; token: string; emojis: string[] };
export interface BossCurrent { _id: string; kind: 'boss_current'; version: number; runId: string }
export interface BossRun {
  _id: string; kind: 'boss_run'; version: number;
  name: string; color: string; photo: string | null; health: number; initialHealth: number; createdAt: Date;
}
export interface BossPlayer {
  _id: string; kind: 'boss_player'; version: number; vkId: number; subscribed: boolean; subscribedAt?: Date; level: number;
  upgradeToken?: string;
  fight?: { runId: string; token: string; emojis: string[] };
}
export interface BossDamage { _id: string; kind: 'boss_damage'; version: number; runId: string; vkId: number; name: string; accountId: number; damage: number }
export interface BossBroadcast { _id: string; kind: 'boss_broadcast'; version: number; runId: string; after: number; stage: 'pending' | 'finished'; dueAt: Date }
export type BossRecord = BossCurrent | BossRun | BossPlayer | BossDamage | BossBroadcast;
export interface BossStore { bossRanking(runId: string, vkId: number): Promise<Ranking> }
