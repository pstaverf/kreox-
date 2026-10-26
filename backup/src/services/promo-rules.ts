import { game } from '../config/game.js';
import type { Command } from '../types/game.js';
import { isPositiveId } from '../utils/validation.js';
import type { Promo, PromoCommand, PromoCurrency } from '../types/promo.js';

export function isPromoCurrency(value: unknown): value is PromoCurrency {
  return value === 'kc' || value === 'euro' || value === 'bitcoin';
}

export function isPromoName(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || !value.isWellFormed() || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
    return false;
  }
  const length = Array.from(value).length;
  return length >= game.promo.minNameLength && length <= game.promo.maxNameLength;
}

export function promoScale(currency: PromoCurrency): number {
  switch (currency) {
    case 'kc': return game.kcScale;
    case 'euro': return game.euroScale;
    case 'bitcoin': return game.bitcoinScale;
  }
}

export function parsePromoInteger(text: string): number | null {
  if (!/^(?:\d{1,16}|[1-9]\d{0,2}(?:\.\d{3}){1,5})$/.test(text)) {
    return null;
  }
  const value = Number(text.replaceAll('.', ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function promoTotal(amount: number, quantity: number): number | null {
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(quantity) || quantity < game.promo.minQuantity) {
    return null;
  }
  const value = BigInt(amount) * BigInt(quantity);
  return value <= BigInt(game.maxAmount) ? Number(value) : null;
}

export function validPromoReward(currency: PromoCurrency, amount: number): boolean {
  if (!isPromoCurrency(currency)) {
    return false;
  }
  const scale = promoScale(currency);
  return Number.isSafeInteger(amount) && amount <= game.maxAmount && amount % scale === 0
    && amount >= game.promo.minimum[currency] * scale;
}

export function promoRedemptionId(name: string, vkId: number): string {
  return `${Buffer.from(name, 'utf8').toString('hex')}:${vkId}`;
}

export function isPromoCommand(command: Command): command is PromoCommand {
  switch (command.kind) {
    case 'promo':
    case 'promo_create':
    case 'promo_activate':
    case 'promo_back':
    case 'promo_currency':
    case 'promo_confirm':
    case 'promo_list': return true;
    default: return false;
  }
}

export function validatePromo(promo: Promo): void {
  if (!isPromoName(promo._id) || !isPositiveId(promo.ownerId) || !validPromoReward(promo.currency, promo.amount)
    || promoTotal(promo.amount, promo.quantity) === null || !Number.isSafeInteger(promo.remaining)
    || promo.remaining < 0 || promo.remaining > promo.quantity) {
    throw new Error('Invalid promo record');
  }
}
