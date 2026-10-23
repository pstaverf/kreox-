import { game } from '../config/game.js';
import type { Command } from '../types/game.js';
import { labels } from '../services/texts.js';
import { isRecord } from '../utils/validation.js';

export function parseCommand(text: string | undefined, payload: unknown): Command {
  let value: unknown = payload;
  if (typeof payload === 'string') {
    if (Buffer.byteLength(payload, 'utf8') > 255) {
      return { kind: 'development' };
    }
    try {
      value = JSON.parse(payload);
    } catch {
      return { kind: 'development' };
    }
  }
  if (isRecord(value) && value.command === 'inventory' && typeof value.page === 'number'
    && Number.isSafeInteger(value.page) && value.page >= 0
    && value.page <= Math.floor(game.maxAmount / game.inventoryPageSize) - 1) {
    return { kind: 'inventory', page: value.page };
  }
  switch (text?.trim()) {
    case labels.profile:
    case labels.back:
      return { kind: 'profile' };
    case labels.menu:
      return { kind: 'menu' };
    case labels.bonus:
      return { kind: 'bonus' };
    case labels.inventory:
      return { kind: 'inventory', page: 0 };
  }
  const match = /^🆔 ([1-9]\d{0,15})$/.exec(text?.trim() ?? '');
  const itemId = Number(match?.[1]);
  if (Number.isSafeInteger(itemId) && itemId > 0) {
    return { kind: 'item', itemId };
  }
  return { kind: 'development' };
}
