import { rouletteConfig } from '../config/roulette.js';

export function validRouletteNumber(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value < rouletteConfig.numbers; }
export function parseRouletteTarget(text: string): number | null {
  const value = text.trim().toLowerCase().replaceAll('ё', 'е');
  if (/^\d{1,2}$/.test(value)) {
    const target = Number(value);
    return validRouletteNumber(target) ? target : null;
  }
  return rouletteConfig.groups.find(group => group.label === value)?.target ?? null;
}
export function rouletteMultiplier(target: number): number {
  if (validRouletteNumber(target)) return rouletteConfig.straightMultiplier;
  const group = rouletteConfig.groups.find(group => group.target === target);
  if (group === undefined) throw new Error('Invalid roulette target');
  return group.multiplier;
}
export function validRouletteTarget(target: number): boolean { return validRouletteNumber(target) || rouletteConfig.groups.some(group => group.target === target); }
export function rouletteWins(target: number, result: number): boolean {
  if (!validRouletteNumber(result)) throw new Error('Invalid roulette outcome');
  if (validRouletteNumber(target)) return result === target;
  const group = rouletteConfig.groups.find(group => group.target === target);
  if (group === undefined) throw new Error('Invalid roulette target');
  return group.numbers.includes(result);
}
