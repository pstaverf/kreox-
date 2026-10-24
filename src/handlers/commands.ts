import { parseAdminItems, parseItemPayload } from './items.js';
import { parseAdminBalance } from './admin-balance.js';
import { isPromoCurrency, isPromoName } from '../services/promo-rules.js';
import { game } from '../config/game.js';
import type { Command } from '../types/game.js';
import { isRankingMetric } from '../services/rankings.js';
import { labels } from '../services/texts.js';
import { isRecord } from '../utils/validation.js';

export function parseCommand(text: string | undefined, payload: unknown, isChat = false): Command {
  if (text?.trim() === '/dk') {
    return { kind: 'delete_keyboards' };
  }
  const adminItem = parseAdminItems(text);
  if (adminItem !== null) {
    return adminItem;
  }
  const adminBalance = parseAdminBalance(text);
  if (adminBalance !== null) {
    return adminBalance;
  }
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
  const itemCommand = parseItemPayload(value);
  if (itemCommand !== null) {
    return itemCommand;
  }
  if (isRecord(value)) {
    if (value.command === 'item' && typeof value.itemId === 'number' && Number.isSafeInteger(value.itemId) && value.itemId > 0) {
      return { kind: 'item', itemId: value.itemId };
    }
    if (value.command === 'promo_currency' && isPromoCurrency(value.currency)) {
      return { kind: 'promo_currency', currency: value.currency };
    }
    if (value.command === 'promo_confirm' && typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 200) {
      return { kind: 'promo_confirm', token: value.token };
    }
    if (value.command === 'promo_list' && (value.after === null || isPromoName(value.after))) {
      return { kind: 'promo_list', after: value.after };
    }
    if (value.command === 'promo' || value.command === 'promo_create' || value.command === 'promo_activate' || value.command === 'promo_back') {
      return { kind: value.command };
    }
    if (value.command === 'inventory' && typeof value.page === 'number'
      && Number.isSafeInteger(value.page) && value.page >= 0
      && value.page <= Math.floor(game.maxAmount / game.inventoryPageSize) - 1) {
      return { kind: 'inventory', page: value.page };
    }
    if (value.command === 'ranking' && isRankingMetric(value.metric)) {
      return { kind: 'ranking', metric: value.metric };
    }
    if (value.command === 'mining_confirm' && typeof value.level === 'number'
      && Number.isSafeInteger(value.level) && value.level >= 0 && value.level < game.maxAmount) {
      return { kind: 'mining_confirm', level: value.level };
    }
    if (value.command === 'menu' || value.command === 'mining' || value.command === 'profile') {
      return { kind: value.command };
    }
  }
  const normalized = text?.trim();
  if (isChat) {
    switch (normalized?.toLowerCase()) {
      case 'я': return { kind: 'profile' };
      case 'и':
      case 'инв':
      case 'инвентарь': return { kind: 'inventory', page: 0 };
    }
  }
  switch (normalized) {
    case labels.promo: return { kind: 'promo' };
    case labels.city: return { kind: 'city' };
    case labels.createPromo: return { kind: 'promo_create' };
    case labels.activatePromo: return { kind: 'promo_activate' };
    case labels.myPromos: return { kind: 'promo_list', after: null };
    case 'KC': return { kind: 'promo_currency', currency: 'kc' };
    case '💶': return { kind: 'promo_currency', currency: 'euro' };
    case '💠': return { kind: 'promo_currency', currency: 'bitcoin' };
    case labels.profile:
    case labels.back: return { kind: 'profile' };
    case labels.menu: return { kind: 'menu' };
    case labels.bonus: return { kind: 'bonus' };
    case labels.inventory: return { kind: 'inventory', page: 0 };
    case labels.mining:
    case labels.upgradeBack: return { kind: 'mining' };
    case labels.startMining: return { kind: 'mining_start' };
    case labels.withdrawMining: return { kind: 'mining_withdraw' };
    case labels.upgradeMining: return { kind: 'mining_upgrade' };
    case labels.referral: return { kind: 'referrals' };
    case labels.rating:
    case labels.kc: return { kind: 'ranking', metric: 'kc' };
    case labels.bitcoin: return { kind: 'ranking', metric: 'bitcoin' };
    case labels.euro: return { kind: 'ranking', metric: 'euro' };
    case labels.referrals: return { kind: 'ranking', metric: 'referrals' };
    case labels.reputation: return { kind: 'ranking', metric: 'reputation' };
    case labels.thieves: return { kind: 'ranking', metric: 'stolenKC' };
  }
  const match = /^🆔 ([1-9]\d{0,15})$/.exec(normalized ?? '');
  const itemId = Number(match?.[1]);
  return Number.isSafeInteger(itemId) && itemId > 0 ? { kind: 'item', itemId } : { kind: 'development' };
}

export function parseReferrer(value: unknown, senderId: number): number | undefined {
  if (typeof value !== 'string' || value.length > 40 || !/^kreox_[1-9]\d*$/.test(value)) {
    return undefined;
  }
  const id = Number(value.slice(6));
  return Number.isSafeInteger(id) && id > 0 && id !== senderId ? id : undefined;
}
