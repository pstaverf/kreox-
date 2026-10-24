import { isItemKind, parsePlayerTarget } from '../services/item-rules.js';
import type { AdminItemCommand, ItemCommand } from '../types/items.js';
import { isRecord } from '../utils/validation.js';

export function parseAdminItems(text: string | undefined): AdminItemCommand | null {
  const value = text?.trim() ?? '';
  if (/^!itemlist$/i.test(value)) {
    return { kind: 'admin_itemlist' };
  }
  if (!/^!(?:giveitem|takeitem|itemlist)(?=\s|$)/i.test(value)) {
    return null;
  }
  const match = value.length <= 256 ? /^!(giveitem|takeitem)\s+(.+)\s+([12])$/i.exec(value) : null;
  const target = match?.[2] === undefined ? null : parsePlayerTarget(match[2]);
  if (match === null || target === null || target.kind === 'screen') {
    return { kind: 'admin_item_invalid' };
  }
  return { kind: 'admin_item', operation: match[1]?.toLowerCase() === 'giveitem' ? 'give' : 'take', target, catalogId: Number(match[3]) };
}
export function parseItemPayload(value: unknown): ItemCommand | null {
  if (!isRecord(value)) {
    return null;
  }
  if (isItemKind(value.itemKind)) {
    switch (value.command) {
      case 'item_detail': case 'item_use': case 'item_custom': case 'item_gift': case 'item_sell':
        return { kind: value.command, itemKind: value.itemKind };
      case 'item_open':
        if (value.quantity === 1 || value.quantity === 5 || value.quantity === 10) {
          return { kind: 'item_open', itemKind: value.itemKind, quantity: value.quantity };
        }
    }
  }
  if ((value.command === 'item_confirm' || value.command === 'item_open_confirm') && typeof value.token === 'string'
    && value.token.length > 0 && value.token.length <= 200) {
    return { kind: value.command, token: value.token };
  }
  if (value.command === 'item_buy' && typeof value.offerId === 'string' && value.offerId.length > 0 && value.offerId.length <= 200) {
    return { kind: 'item_buy', offerId: value.offerId };
  }
  return null;
}
