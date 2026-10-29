import { game } from '../config/game.js';
import { parseBankMoney } from '../services/bank-rules.js';
import { validGiveawayCount, validGiveawayPeer, validGiveawayReward, validGiveawayToken } from '../services/giveaway-rules.js';
import type { BalanceCurrency } from '../types/admin-balance.js';
import type { GiveawayCommand, GiveawayReward } from '../types/giveaway.js';
import type { ItemKind } from '../types/items.js';
import { isRecord } from '../utils/validation.js';

export function parseForce(text: string | undefined): GiveawayCommand | null {
  if (text === undefined || !/^\/force(?=\s|$)/iu.test(text.trimStart())) return null;
  const invalid: GiveawayCommand = { kind: 'force_invalid' };
  if (text.length > game.maxMessageLength) return invalid;
  const parts = text.trim().toLowerCase().split(/\s+/u);
  if (parts[1] !== 'раздача' || parts.length < 5) return invalid;
  const countText = parts.at(-2) ?? '';
  const amountText = parts.at(-1) ?? '';
  const count = /^\d{1,16}$/.test(countText) ? Number(countText) : 0;
  if (!validGiveawayCount(count)) return invalid;
  const name = parts.slice(2, -2).join(' ');
  const currency: BalanceCurrency | null = name === 'монеты' ? 'kc' : name === 'евро' ? 'euro' : name === 'биткоин' ? 'bitcoin' : null;
  let reward: GiveawayReward;
  if (currency !== null) {
    const amount = parseBankMoney(amountText, currency);
    if (amount === null) return invalid;
    reward = { kind: 'currency', currency, amount };
  } else {
    const itemKind: ItemKind | null = name === 'кейс реферальный' ? 'referral_case' : name === 'кейс ждун' ? 'zhdun_case'
      : name === 'крупье' || name === 'крупьер' ? 'croupier' : null;
    if (itemKind === null || !/^\d{1,4}$/.test(amountText)) return invalid;
    reward = { kind: 'item', itemKind, quantity: Number(amountText) };
  }
  return validGiveawayReward(reward) ? { kind: 'force_giveaway', count, reward } : invalid;
}
export function parseGiveawayPayload(value: unknown): GiveawayCommand | null {
  if (!isRecord(value) || (value.command !== 'giveaway_claim' && value.command !== 'giveaway_cancel')
    || typeof value.peerId !== 'number' || !validGiveawayPeer(value.peerId) || !validGiveawayToken(value.token)) return null;
  return { kind: value.command, peerId: value.peerId, token: value.token };
}
