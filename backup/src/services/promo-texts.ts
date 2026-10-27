import { game } from '../config/game.js';
import type { Promo, PromoCurrency } from '../types/promo.js';
import { formatAmount } from './texts.js';
import { promoScale } from './promo-rules.js';

export const promoTexts = {
  menu: '🎁 Меню промокодов:',
  currency: '💰 Выберите валюту своего промокода.',
  name: '💡 Теперь введите название.',
  nameLength: '⚠️ Введите 5-20 символов.',
  nameInvalid: '⚠️ Введите название одной строкой без управляющих символов.',
  quantity: '🔢 Введите количество.\n\n💡 Мин. количество промокодов: 5',
  confirm: '☑️ Подтвердите создание промокода.',
  created: '✅ Промокод создан',
  activate: '🎁 Введите название промокода для активации.',
  notFound: '⚠️ Такого промокода не существует!',
  exists: '⚠️ Промокод с таким названием уже существует!',
  funds: '⚠️ Недостаточно средств для создания промокода.',
  stale: '⚠️ Подтверждение устарело. Создайте промокод заново.',
  already: '⚠️ Вы уже активировали этот промокод!',
  empty: '⚠️ Активации этого промокода закончились!',
  own: '⚠️ Нельзя активировать свой промокод!',
  balanceLimit: '⚠️ Достигнут предел баланса. Промокод не активирован.',
  limit: '⚠️ Сумма или количество слишком велики.',
  emptyList: 'У Вас пока нет промокодов.',
  private: '⚠️ Откройте промокоды в личных сообщениях бота.'
} as const;

export function promoAmountPrompt(currency: PromoCurrency): string {
  const minimum = game.promo.minimum[currency];
  const amount = currency === 'kc' ? `${formatAmount(minimum, 1)} KC` : currency === 'euro' ? `${minimum} 💶` : `${minimum}₿`;
  return `🔢 Введите сумму 1-го промо.\n\n💡 Мин. сумма: ${amount}`;
}

export function promoRewardText(currency: PromoCurrency, amount: number): string {
  const value = formatAmount(amount, promoScale(currency));
  switch (currency) {
    case 'kc': return `💰 ${value} KC`;
    case 'euro': return `💶 ${value}`;
    case 'bitcoin': return `💠 ${value}₿`;
  }
}

export function promoActivatedText(promo: Promo): string {
  return `🎁 Активация промокода успешна! Ваши награды:\n\n${promoRewardText(promo.currency, promo.amount)}`;
}

export function promoListText(promos: readonly Promo[]): string {
  return '🎁 Ваши промокоды:\n\n' + (promos.length === 0 ? promoTexts.emptyList : promos.map(promo =>
    `${promo._id} — ${promo.remaining} активаций, награды:\n${promoRewardText(promo.currency, promo.amount)}`
  ).join('\n\n'));
}
