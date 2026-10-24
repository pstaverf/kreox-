import { parseBankPayload, parseBankTransfer } from './bank.js';
import { parseAdminItems, parseItemPayload } from './items.js';
import { parseAdminBalance } from './admin-balance.js';
import { isPromoCurrency, isPromoName } from '../services/promo-rules.js';
import { game } from '../config/game.js';
import type { Command } from '../types/game.js';
import { isRankingMetric } from '../services/rankings.js';
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
  const bankTransfer = parseBankTransfer(text);
  if (bankTransfer !== null) return bankTransfer;
  const normalizedText = text?.trim().toLowerCase();
  if (normalizedText === 'купитькрупье' || normalizedText === 'купить крупье') return { kind: 'dealer_buy' };
  if (isChat && normalizedText === 'вор') return { kind: 'theft' };
  if (isChat && normalizedText === 'крупье') return { kind: 'dealer_view' };
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
  const bankCommand = parseBankPayload(value);
  if (bankCommand !== null) return bankCommand;
  const itemCommand = parseItemPayload(value);
  if (itemCommand !== null) {
    return itemCommand;
  }
  if (isRecord(value)) {
    if ((value.command === 'donate_confirm' || value.command === 'donate_cancel') && typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 200) return { kind: value.command, token: value.token };
    if (value.command === 'donate' || value.command === 'donate_nick' || value.command === 'donate_thief' || value.command === 'donate_dealer') return { kind: value.command };
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
    if (value.command === 'menu' || value.command === 'mining' || value.command === 'profile'
      || value.command === 'bonus' || value.command === 'mining_start' || value.command === 'mining_withdraw'
      || value.command === 'mining_upgrade' || value.command === 'referrals' || value.command === 'development') {
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
  return { kind: 'development' };
}

export function parseReferrer(value: unknown, senderId: number): number | undefined {
  if (typeof value !== 'string' || value.length > 40 || !/^kreox_[1-9]\d*$/.test(value)) {
    return undefined;
  }
  const id = Number(value.slice(6));
  return Number.isSafeInteger(id) && id > 0 && id !== senderId ? id : undefined;
}
