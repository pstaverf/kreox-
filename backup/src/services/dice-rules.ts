import { roundKcRatio } from './kc-money.js';
import { diceConfig } from '../config/dice.js';
import { game } from '../config/game.js';
import type { BalanceCurrency } from '../types/admin-balance.js';
import type { DiceChat, DiceCommand, DiceGame } from '../types/dice.js';
import type { Command } from '../types/game.js';
import { isBalanceCurrency } from './admin-balance.js';
import { safeBankMoney } from './bank-rules.js';
import { promoScale } from './promo-rules.js';

export function isDiceCommand(command: Command): command is DiceCommand {
  return command.kind === 'dice_list' || command.kind === 'dice_invalid' || command.kind === 'dice_create' || command.kind === 'dice_join' || command.kind === 'dice_leave';
}
export function diceChatKey(peerId: number): string { return `dice-chat:${peerId}`; }
export function diceMinimum(currency: BalanceCurrency): number { return diceConfig.minimum[currency] * promoScale(currency); }
export function validDiceStake(currency: BalanceCurrency, amount: number, slots: number): boolean {
  return isBalanceCurrency(currency) && safeBankMoney(amount) && amount >= diceMinimum(currency)
    && Number.isSafeInteger(slots) && slots >= diceConfig.minPlayers && slots <= diceConfig.maxPlayers
    && BigInt(amount) * BigInt(slots) <= BigInt(game.maxAmount);
}
export function diceDistribution(amount: number, count: number, winners: number, currency: BalanceCurrency = 'kc'): { each: number; commission: number } {
  if (!safeBankMoney(amount) || amount <= 0 || !Number.isSafeInteger(count) || count < 2 || count > diceConfig.maxPlayers
    || !Number.isSafeInteger(winners) || winners < 1 || winners > count) throw new Error('Invalid dice distribution');
  const rawPot = BigInt(amount) * BigInt(count);
  const pot = currency === 'kc' ? BigInt(roundKcRatio(rawPot)) : rawPot;
  if (rawPot > BigInt(game.maxAmount)) throw new Error('Dice pot limit');
  const fee = winners === 1 ? diceConfig.winnerFee : diceConfig.tieFee;
  const numerator = pot * BigInt(diceConfig.feeScale - fee);
  const denominator = BigInt(diceConfig.feeScale) * BigInt(winners);
  const rounded = currency === 'kc' ? BigInt(roundKcRatio(numerator, denominator)) : numerator / denominator;
  const maximum = currency === 'kc' ? pot / BigInt(winners) / BigInt(game.kcScale) * BigInt(game.kcScale) : pot / BigInt(winners);
  const each = rounded > maximum ? maximum : rounded;
  return { each: Number(each), commission: Number(pot - each * BigInt(winners)) };
}
export function refreshDiceDeadline(chat: DiceChat): void {
  chat.dueAt = new Date(Math.min(8_640_000_000_000_000, ...chat.games.map(value => value.expiresAt.getTime())));
}
export function validateDiceChat(chat: DiceChat): void {
  if (chat._id !== diceChatKey(chat.peerId) || !Number.isSafeInteger(chat.peerId) || chat.peerId <= 2_000_000_000
    || !Number.isSafeInteger(chat.lastGame) || chat.lastGame < 0 || chat.lastGame > game.maxAmount || chat.games.length > diceConfig.maxGames
    || new Set(chat.games.map(value => value.gameId)).size !== chat.games.length) throw new Error('Invalid dice chat');
  for (const value of chat.games) validateDiceGame(value, chat.lastGame);
}
function validateDiceGame(value: DiceGame, lastGame: number): void {
  if (!Number.isSafeInteger(value.gameId) || value.gameId < 1 || value.gameId > lastGame || !validDiceStake(value.currency, value.amount, value.slots)
    || !Number.isFinite(value.expiresAt.getTime()) || value.players.length < 1 || value.players.length >= value.slots
    || new Set(value.players.map(player => player.vkId)).size !== value.players.length
    || value.players.some(player => !Number.isSafeInteger(player.vkId) || player.vkId < 1 || !/^[a-f0-9]{64}$/.test(player.entryId))) throw new Error('Invalid dice game');
}
