import { game } from '../config/game.js';
import { itemConfig } from '../config/items.js';
import type { ItemKind } from '../types/items.js';
export type CaseDrop = { currency: 'kc' | 'euro' | 'bitcoin'; amount: number; weight: number } | { itemKind: 'aristocrat_case'; weight: number };
function money(currency: 'kc' | 'euro' | 'bitcoin', values: number[], weight: number): CaseDrop[] {
  const scale = currency === 'kc' ? game.kcScale : currency === 'euro' ? game.euroScale : game.bitcoinScale;
  return values.map(amount => ({ currency, amount: amount * scale, weight }));
}
export function caseDrops(kind: ItemKind): readonly CaseDrop[] {
  if (kind.startsWith('boss_case:')) return [
    ...money('kc', [250, 500, 1000, 1500, 2000], 140),
    ...money('euro', [1, 2, 3, 4, 5], 18),
    ...money('bitcoin', [5, 10, 15, 20], 50),
    { itemKind: 'aristocrat_case', weight: 10 }
  ];
  if (kind === 'aristocrat_case') return [
    ...money('kc', [25000, 50000, 100000, 150000, 200000], 140),
    ...money('euro', [10, 20, 30, 40, 50], 20),
    ...money('bitcoin', [50, 100, 150, 200], 50)
  ];
  return itemConfig.drops;
}
