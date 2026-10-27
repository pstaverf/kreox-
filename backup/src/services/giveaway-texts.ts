import { itemConfig } from '../config/items.js';
import type { Player } from '../types/game.js';
import type { GiveawayReward, GiveawayState } from '../types/giveaway.js';
import { assertNever } from '../utils/validation.js';
import { promoScale } from './promo-rules.js';
import { formatAmount, mention } from './texts.js';

export const giveawayTexts = {
  usage: '⚠️ Формат: /force Раздача монеты|евро|биткоин <игроков> <награда> или /force Раздача кейс реферальный|кейс ждун|крупьер <игроков> <количество 1–1000>. Награда указана для каждого игрока.',
  collect: 'Получить',
  cancel: 'Отмена',
  instruction: 'Нажмите на кнопку, чтобы забрать награду.',
  already: '⚠️ Вы уже получали награды с этой раздачи!',
  old: '⚠ Нельзя принимать участие в старых раздачах.',
  ended: '⚠ Раздача закончилась.',
  finished: 'Раздача завершена!',
  limit: '⚠️ Награда не получена: достигнут предел баланса или инвентаря. Активация не потрачена.'
} as const;
export function giveawayAmount(reward: Extract<GiveawayReward, { kind: 'currency' }>): string {
  const scale = BigInt(promoScale(reward.currency));
  const value = BigInt(reward.amount);
  const whole = formatAmount(Number(value / scale), 1);
  const fraction = String(value % scale).padStart(String(scale).length - 1, '0').replace(/0+$/, '');
  return fraction.length === 0 ? whole : `${whole},${fraction}`;
}
function itemReward(reward: Extract<GiveawayReward, { kind: 'item' }>): string {
  const item = itemConfig.catalog.find(value => value.kind === reward.itemKind);
  if (item === undefined) throw new Error('Invalid giveaway item');
  return `${item.name} х${formatAmount(reward.quantity, 1)}`;
}
export function giveawayRewardText(reward: GiveawayReward): string {
  if (reward.kind === 'item') return itemReward(reward);
  const amount = giveawayAmount(reward);
  switch (reward.currency) {
    case 'kc': return `${amount} KC`;
    case 'euro': return `${amount}💶`;
    case 'bitcoin': return `${amount}₿`;
    default: return assertNever(reward.currency);
  }
}
export function giveawayRewardLine(reward: GiveawayReward): string {
  if (reward.kind === 'item') return itemReward(reward);
  const amount = giveawayAmount(reward);
  switch (reward.currency) {
    case 'kc': return `💰 ${amount} KC`;
    case 'euro': return `💶 ${amount} евро`;
    case 'bitcoin': return `₿ ${amount} биткоинов`;
    default: return assertNever(reward.currency);
  }
}
export function giveawayStarted(state: GiveawayState): string {
  const reward = state.reward.kind === 'item' ? `Вы запустили раздачу на предмет ${giveawayRewardText(state.reward)}`
    : `🌟 Вы запустили раздачу на ${giveawayRewardText(state.reward)}`;
  return `${reward} на ${formatAmount(state.count, 1)} игроков!\n\n${giveawayTexts.instruction}`;
}
export function giveawayClaimed(state: GiveawayState, player: Player): string {
  const footer = state.remaining === 0 ? giveawayTexts.finished : `Осталось ${formatAmount(state.remaining, 1)} возможностей получить награды!`;
  return `✅ ${mention(player)}, вы приняли участие в раздаче! Ваши награды:\n\n${giveawayRewardLine(state.reward)}\n\n${footer}`;
}
export function giveawayCancelled(state: GiveawayState): string {
  return `⭐️ Раздача отменена!\n\n${formatAmount(state.count - state.remaining, 1)} игроков успело получить ${giveawayRewardText(state.reward)}.`;
}
