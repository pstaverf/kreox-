import { rouletteConfig } from '../config/roulette.js';
import { validRouletteNumber } from './roulette-rules.js';

export function rouletteColor(number: number): string {
  if (!validRouletteNumber(number)) throw new Error('Invalid roulette color number');
  return number === 0 ? '🟢' : rouletteConfig.red.includes(number) ? '🔴' : '⚫';
}
export function rouletteTargetText(target: number): string {
  if (validRouletteNumber(target)) return String(target);
  const group = rouletteConfig.groups.find(group => group.target === target);
  if (group === undefined) throw new Error('Invalid roulette display target');
  return group.label;
}
export function rouletteOutcome(number: number): string { return `${number}${rouletteColor(number)}`; }
export function rouletteHistory(number: number): string { return `${rouletteColor(number)} ${number}`; }
