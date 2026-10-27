import { parseRouletteTarget } from '../services/roulette-rules.js';
import { game } from '../config/game.js';
import type { CasinoCommand, CasinoLine, CasinoMode } from '../types/casino.js';
import { casinoConfig } from '../config/casino.js';
import { parseCasinoStake } from '../services/casino-rules.js';
import { betMinimum, casinoTexts } from '../services/casino-texts.js';
import { isRecord } from '../utils/validation.js';

function isRouletteShorthand(text: string): boolean {
  const parts = text.trim().split(/\s+/u);
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined || parseRouletteTarget(parts[0]) === null) return false;
  const stake = parseCasinoStake(parts[1]);
  return stake !== null && (typeof stake !== 'number' || stake >= casinoConfig.minimum);
}
function parseLine(text: string): CasinoLine {
  const line = isRouletteShorthand(text) ? `рулетка ${text.trim()}` : text.trim();
  const parts = /^(краш|дрим|рулетка)\s+(\S+)\s+(\S+)$/iu.exec(line);
  const mode: CasinoMode = /^краш(?=\s|$)/iu.test(line) ? 'crash' : /^рулетка(?=\s|$)/iu.test(line) ? 'roulette' : 'dream';
  const usage = mode === 'crash' ? casinoTexts.crashUsage : mode === 'roulette' ? casinoTexts.rouletteUsage : casinoTexts.dreamUsage;
  if (parts?.[2] === undefined || parts[3] === undefined) return { error: usage };
  const amount = parseCasinoStake(parts[3]);
  if (mode === 'roulette') {
    const target = parseRouletteTarget(parts[2]);
    if (target === null || amount === null) return { error: usage };
    return typeof amount === 'number' && amount < casinoConfig.minimum ? { error: betMinimum(mode) } : { mode, amount, target };
  }
  if (mode === 'crash') {
    if (!/^\d{1,4}(?:[.,]\d{1,2})?$/.test(parts[2])) return { error: casinoTexts.crashRange };
    const [whole = '', fraction = ''] = parts[2].replace(',', '.').split('.');
    const target = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (target <= 100 || target > casinoConfig.maxCrash) return { error: casinoTexts.crashRange };
    if (amount === null) return { error: casinoTexts.crashUsage };
    if (typeof amount === 'number' && amount < casinoConfig.minimum) return { error: betMinimum(mode) };
    return { mode, amount, target };
  }
  const target = Number(parts[2]);
  if (!/^\d+$/.test(parts[2]) || !casinoConfig.sectors.some(sector => sector === target) || amount === null) return { error: casinoTexts.dreamUsage };
  return typeof amount === 'number' && amount < casinoConfig.minimum ? { error: betMinimum(mode) } : { mode, amount, target };
}
export function parseCasinoText(text: string | undefined, isChat: boolean): CasinoCommand | null {
  if (!isChat || text === undefined) return null;
  if (text.length > game.maxMessageLength) return null;
  const normalized = text.trim().toLowerCase();
  if (normalized === 'директор') return { kind: 'director_view' };
  if (normalized === 'лог краш' || normalized === 'лог дрим' || normalized === 'лог рулетка') return { kind: 'casino_log', mode: normalized === 'лог краш' ? 'crash' : normalized === 'лог рулетка' ? 'roulette' : 'dream' };
  const lines = text.split(/\r?\n/u).filter(line => line.trim().length > 0);
  if (lines.length === 0 || !lines.some(line => /^(краш|дрим|рулетка)(?=\s|$)/iu.test(line.trim()) || isRouletteShorthand(line))) return null;
  return { kind: 'casino_bets', lines: lines.map(parseLine) };
}
export function parseDirectorPayload(value: unknown): CasinoCommand | null {
  if (!isRecord(value)) return null;
  if (value.command === 'city_director' || value.command === 'director_view' || value.command === 'director_bid') return { kind: value.command };
  if (value.command === 'director_confirm' && typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 200) return { kind: 'director_confirm', token: value.token };
  return null;
}
export function parseChatRanking(text: string | undefined, isChat: boolean) {
  if (!isChat) return null;
  const value = text?.trim().toLowerCase().replace(/\s+/gu, ' ');
  switch (value) {
    case 'топ': return 'kc';
    case 'топ бит': case 'топ биткоин': return 'bitcoin';
    case 'топ вор': case 'топ воров': return 'stolenKC';
    case 'топ реп': return 'reputation';
    case 'топ донат': case 'топ евро': return 'euro';
    case 'топ реф': case 'топ рефералы': return 'referrals';
    case 'топ майнинг': return 'mining';
    default: return null;
  }
}
