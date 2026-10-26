import { game } from '../config/game.js';
import { itemConfig } from '../config/items.js';
import type { Command } from '../types/game.js';
import type { AdminItemCommand, CaseRewards, ItemCommand, ItemKind, ItemOffer, PlayerTarget } from '../types/items.js';
import { isPositiveId } from '../utils/validation.js';

export function isItemKind(value: unknown): value is ItemKind {
  return value === 'zhdun_case' || value === 'referral_case' || value === 'croupier';
}
export function isAdminItemCommand(command: Command): command is AdminItemCommand {
  return command.kind === 'admin_item' || command.kind === 'admin_itemlist' || command.kind === 'admin_item_invalid';
}
export function isItemCommand(command: Command): command is ItemCommand {
  switch (command.kind) {
    case 'item_detail': case 'item_use': case 'item_custom': case 'item_gift': case 'item_sell':
    case 'item_open': case 'item_confirm': case 'item_open_confirm': case 'item_buy': return true;
    default: return false;
  }
}
export function validItemQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= itemConfig.maxBatch;
}
export function parsePlayerTarget(text: string): PlayerTarget | null {
  const value = text.trim();
  if (/^\d{1,16}$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id >= 0 ? { kind: 'number', id } : null;
  }
  const match = /^(?:@?id(\d{1,16})|\[id(\d{1,16})\|[^\]\r\n]{1,100}\])$/i.exec(value);
  if (match !== null) {
    const id = Number(match[1] ?? match[2]);
    return isPositiveId(id) ? { kind: 'vk', id } : null;
  }
  const screen = /^(?:@|https:\/\/(?:www\.)?vk\.com\/)([a-zA-Z][a-zA-Z0-9_.]{0,63})\/?$/.exec(value)?.[1];
  return screen === undefined ? null : { kind: 'screen', name: screen };
}
export function parseItemPrice(text: string): number | null {
  const match = /^(\d{1,16})([kк]{1,2})?$/i.exec(text.trim());
  const whole = match?.[1];
  if (whole === undefined) {
    return null;
  }
  const suffix = match?.[2]?.length ?? 0;
  const amount = BigInt(whole) * 1000n ** BigInt(suffix) * BigInt(game.kcScale);
  return amount <= BigInt(game.maxAmount) ? Number(amount) : null;
}
export function caseRewards(quantity: number, roll: () => number): CaseRewards {
  if (!validItemQuantity(quantity)) {
    throw new Error('Invalid case quantity');
  }
  const result: CaseRewards = { kc: 0, euro: 0, counts: itemConfig.drops.map(() => 0) };
  for (let i = 0; i < quantity; i += 1) {
    const value = roll();
    if (!Number.isSafeInteger(value) || value < 0 || value >= 100) {
      throw new Error('Invalid case roll');
    }
    let edge = 0;
    for (const [index, drop] of itemConfig.drops.entries()) {
      edge += drop.weight;
      if (value < edge) {
        result[drop.currency] += drop.amount;
        result.counts[index] = (result.counts[index] ?? 0) + 1;
        break;
      }
    }
  }
  return result;
}
export function validateOffer(offer: ItemOffer): void {
  if (!offer._id || offer._id.length > 200 || !isPositiveId(offer.sellerId) || !isPositiveId(offer.buyerId)
    || offer.sellerId === offer.buyerId || !isItemKind(offer.itemKind) || !validItemQuantity(offer.quantity)
    || !Number.isSafeInteger(offer.price) || offer.price < 0 || offer.price > game.maxAmount
    || !(offer.expiresAt instanceof Date) || !Number.isFinite(offer.expiresAt.getTime())
    || !['pending', 'completed', 'expired'].includes(offer.state)) {
    throw new Error('Invalid item offer');
  }
}
