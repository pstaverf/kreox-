import type { BalanceCurrency } from '../types/admin-balance.js';
import type { DiceGame, DiceParticipant } from '../types/dice.js';
import { promoScale } from './promo-rules.js';
import { formatAmount, mention } from './texts.js';

export const diceTexts = {
  empty: 'Костей нет.',
  accepted: '🎲 Ставка принята.',
  left: '🎲 Вы покинули кости.',
  notPlaying: '🎲 Вы и так не играете.',
  alreadyPlaying: '🎲 Вы уже играете в этих костях.',
  full: '🎲 В беседе уже есть 5 активных игр в кости.',
  funds: '🎲 Недостаточно средств для ставки.',
  limit: '🎲 Сумма ставки или банк игры превышает допустимый предел.',
  usage: '🎲 Формат: кости <ставка> [2–5], кости евро <ставка> [2–5] или кости бит <ставка> [2–5].',
  pending: '🎲 Начисление сохранено и будет выполнено автоматически, когда баланс позволит принять сумму.'
} as const;
export function diceMinimumText(currency: BalanceCurrency): string {
  return currency === 'kc' ? '🎲 Ставка от 1.000 KC.' : currency === 'euro' ? '🎲 Ставка от 10 💶.' : '🎲 Ставка от 10₿.';
}
export function diceMoney(amount: number, currency: BalanceCurrency): string {
  const scale = promoScale(currency);
  const whole = formatAmount(Number(BigInt(amount) / BigInt(scale)), 1);
  const fraction = String(BigInt(amount) % BigInt(scale)).padStart(String(scale).length - 1, '0').replace(/0+$/, '');
  const number = fraction.length === 0 ? whole : `${whole},${fraction}`;
  return `${number}${currency === 'kc' ? ' KC' : currency === 'euro' ? ' 💶' : '₿'}`;
}
export function diceMention(player: DiceParticipant): string { return mention({ _id: player.vkId, name: player.name }); }
export function diceNumber(gameId: number): string { return formatAmount(gameId, 1); }
export function diceCard(value: DiceGame, now: Date): string {
  const seconds = Math.max(0, Math.ceil((value.expiresAt.getTime() - now.getTime()) / 1_000));
  return `🎲 Игра в кости #${diceNumber(value.gameId)}\n💰 Ставка: ${diceMoney(value.amount, value.currency)}\n\n👥 Мест: [${value.players.length}/${value.slots}]\n✅ Игроки:\n${value.players.map(diceMention).join('\n')}\n\n⏱️ До отмены игры: ${Math.floor(seconds / 60)} мин. ${seconds % 60} сек.`;
}
export function diceResult(value: DiceGame, scores: readonly number[], winners: readonly DiceParticipant[], each: number): string {
  const lines = value.players.map((player, index) => `${diceMention(player)}: ${scores[index]}`).join('\n');
  const winner = winners[0];
  if (winner === undefined) throw new Error('Missing dice winner');
  const result = winners.length === 1
    ? `💰 Победитель: ${diceMention(winner)}, он забирает весь банк в ${diceMoney(each, value.currency)}`
    : `💰 ${winners.map(diceMention).join(', ')} делят между собой весь банк. Каждый получает: ${diceMoney(each, value.currency)}`;
  return `🎲 Игра в кости #${diceNumber(value.gameId)}:\n\n${lines}\n\n${result}`;
}
export function diceExpired(gameId: number): string { return `Игра в кости #${diceNumber(gameId)} отменена в связи с истечением времени.`; }
export function diceRefund(value: DiceGame): string {
  return `🎲 Игра в кости #${diceNumber(value.gameId)} была завершена по истечению времени.\n\n💰 Ваша ставка в размере ${diceMoney(value.amount, value.currency)} возвращена`;
}
