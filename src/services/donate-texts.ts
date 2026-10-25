import { donateConfig } from '../config/donate.js';
import { game } from '../config/game.js';
import type { DealerState } from '../types/donate.js';
import type { Player } from '../types/game.js';
import { formatAmount, mention } from './texts.js';

export const donateLabels = { nickname: '👤 Ник', thief: '🥷 Вор', dealer: '🤵‍♂️ Крупье', confirm: '✅ Подтвердить', cancel: '💢 Отмена' } as const;
export const donateTexts = {
  title: '💶 Донат:',
  length: '⚠️ Допустимая длина 4-20 символов.',
  unsafe: '⚠️ Ник не должен содержать упоминания, переносы строк или управляющие символы.',
  cancelled: 'Действие отменено.',
  stale: '⚠️ Подтверждение устарело. Начните действие заново.',
  funds: '⚠️ Недостаточно евро для покупки.',
  limit: '⚠️ Достигнут предел баланса. Действие не выполнено.',
  self: '⚠️ Вы итак являетесь крупье.',
  noVictim: '⚠️ В этой беседе нет других зарегистрированных игроков.',
  private: '⚠️ Откройте донат в личных сообщениях бота.'
} as const;
export function moscowDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: donateConfig.timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).replace(', ', ' ');
}
export function nicknamePrompt(player: Player): string {
  return `👤 Введите новый ник. Смена ника стоит ${formatAmount(donateConfig.nicknameCost, game.euroScale)} 💶 (у вас: ${formatAmount(player.euro, game.euroScale)} 💶).`;
}
export function thiefPrompt(player: Player): string {
  return `${mention(player)}, команда "вор" дает Вам возможность случайно красть деньги у других игроков. Вы можете купить подписку на 30 дней: это будет стоить вам ${formatAmount(donateConfig.subscriptionCost, game.euroScale)} 💶\n\n😔 Подписка на команду "вор" неактивна.`;
}
export function subscriptionText(until: Date, purchased: boolean): string {
  return `${purchased ? '✅ Подписка на команду «вор» была приобретена.' : '✅ Подписка на команду «вор» активна.'}\n📆 Подписка активна до ${moscowDate(until)}`;
}
export function dealerMention(player: Player | null): string {
  return player === null ? 'Государство' : mention(player);
}
export function dealerPrompt(player: Player | null, state: DealerState): string {
  return `🤴 Крупье получает 1% от всех проигрышей в казино.\n\n💰 Крупье: ${dealerMention(player)} (заработал уже ${formatAmount(state.earnedKC, game.kcScale)} KC)\n\nСтать крупье можно за ${formatAmount(donateConfig.dealerCost, game.euroScale)} 💶.`;
}
