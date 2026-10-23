import { game } from '../config/game.js';
import type { InventoryItem, Player, Reward } from '../types/game.js';

export const labels = {
  battlePass: '🎟️ BattlePass',
  profile: '👨‍🦰 Профиль',
  bonus: '🎁 Бонус',
  rating: '🏆 Рейтинг',
  promo: '🏷 Промо',
  city: '🏙️ Город',
  mining: '⛏️ Майнинг',
  donate: '🍩 Донат',
  boss: '🎩 Босс',
  tasks: '📍 Задания',
  help: '🆘 Помощь',
  inventory: '🎒 Инвентарь',
  menu: '📕 Меню',
  back: '↩️ Назад',
  previous: '◀️',
  next: '▶️'
} as const;

export const texts = {
  welcome: '👋🏻 Добро пожаловать в Kreox Bot!\n\nТут ты сможешь развиваться и влетать в топы по всему боту.\n\nТебя ждет интересный и увлекательный функционал.\n\nУдачи.',
  development: '⚙️ В разработке…',
  emptyInventory: 'Ваш инвентарь пуст.',
  inventoryTitle: '🎒 Ваш инвентарь:',
  caseName: '💼 Кейс «Ждун»',
  error: '⚠️ Не удалось выполнить действие. Попробуйте ещё раз.',
  balanceLimit: '⚠️ Бонус не получен: достигнут предел баланса или инвентаря.',
  registrationLimit: '⚠️ Сейчас регистрация недоступна. Попробуйте позже.'
} as const;

export function formatAmount(amount: number, scale: number, minimumDecimals = 0): string {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(scale) || scale < 1) {
    throw new Error('Invalid amount');
  }
  const digits = String(scale).length - 1;
  if (scale !== 10 ** digits || !Number.isSafeInteger(minimumDecimals) || minimumDecimals < 0 || minimumDecimals > digits) {
    throw new Error('Invalid amount scale');
  }
  const value = BigInt(amount);
  const divisor = BigInt(scale);
  const whole = String(value / divisor).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = String(value % divisor).padStart(digits, '0').replace(/0+$/, '').padEnd(minimumDecimals, '0');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function mention(player: Pick<Player, '_id' | 'name'>): string {
  return `[id${player._id}|${player.name}]`;
}

export function profileText(player: Player): string {
  const percentage = game.totalTasks > 0 ? (player.completedTasks * 100 / game.totalTasks).toFixed(2) : '0.00';
  return [
    `👤Ник: ${mention(player)}`,
    `💸 Баланс: ${formatAmount(player.kc, game.kcScale)} KC`,
    `💶 Евро: ${formatAmount(player.euro, game.euroScale)}`,
    `💠 Биткоин: ${formatAmount(player.bitcoin, game.bitcoinScale)}₿`,
    `👍 Репутация: ${player.reputation}`,
    `🏆 Задания: ${player.completedTasks}/${game.totalTasks} [${percentage}%]`,
    `🆔${player.accountId}`
  ].join('\n');
}

export function bonusText(day: number, reward: Reward): string {
  return [
    `🎁 Бонус ${day}-го дня:`,
    `💰 ${formatAmount(reward.kc, game.kcScale)} KC`,
    `💠 ${formatAmount(reward.bitcoin, game.bitcoinScale, 1)}₿`,
    ...(reward.case ? [texts.caseName] : [])
  ].join('\n\n');
}

export function cooldownText(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  return `⏳ Подожди ещё ${Math.floor(seconds / 3_600)} ч. ${Math.floor(seconds % 3_600 / 60)} мин. ${seconds % 60} сек.`;
}

export function inventoryText(items: readonly InventoryItem[]): string {
  return `${texts.inventoryTitle}\n\n${items.length === 0
    ? texts.emptyInventory
    : items.map(item => `🆔 ${item.itemId} — ${texts.caseName}`).join('\n')}`;
}
