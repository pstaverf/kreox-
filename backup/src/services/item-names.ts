import { itemConfig } from '../config/items.js';
import type { ItemKind } from '../types/items.js';
import { bossCaseDetails } from './boss-rules.js';
export function itemName(kind: ItemKind): string {
  const boss = bossCaseDetails(kind);
  if (boss !== null) return `${boss.color} Босс-кейс (${boss.name})`;
  const entry = itemConfig.catalog.find(item => item.kind === kind);
  if (entry === undefined) throw new Error('Unknown item kind');
  return entry.name;
}
