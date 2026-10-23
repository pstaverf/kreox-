import { game } from '../config/game.js';
import type { InventoryItem, MiningFarm, Player, Ranking, RankingMetric, Reward } from '../types/game.js';

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
  next: '▶️',
  referral: '👤 Реф',
  startMining: '💡 Включить',
  withdrawMining: '💠 Снять',
  upgradeMining: '⏫ Улучшить',
  confirm: 'Подтвердить',
  upgradeBack: 'Назад',
  kc: '💰 KC',
  bitcoin: '💠 Биткоин',
  euro: '💶 Евро',
  referrals: '👤 Рефералы',
  reputation: '👍 Репутация',
  thieves: '🥷 Воры'
} as const;

export const texts = {
  keyboardsDeleted: 'Done.',
  welcome: '👋🏻 Добро пожаловать в Kreox Bot!\n\nТут ты сможешь развиваться и влетать в топы по всему боту.\n\nТебя ждет интересный и увлекательный функционал.\n\nУдачи.',
  development: '⚙️ В разработке…',
  emptyInventory: 'Ваш инвентарь пуст.',
  inventoryTitle: '🎒 Ваш инвентарь:',
  caseName: '💼 Кейс «Ждун»',
  referralCaseName: '👬 Кейс «Реферальный»',
  miningStarted: '✅ Ферма запущена на 6 часов.',
  miningAlreadyStarted: 'Ферма уже включена!',
  miningEmpty: '⚠️ Баланс Вашей фермы пуст.',
  miningInsufficient: '⚠️ Недостаточно биткоинов для улучшения фермы.',
  miningStaleOffer: '⚠️ Это улучшение уже применено или устарело. Нажмите «⏫ Улучшить» ещё раз.',
  miningLimit: '⚠️ Достигнут предел баланса или уровня фермы.',
  inventoryTooLarge: '⚠️ Инвентарь не помещается в одно сообщение. Откройте его в личных сообщениях бота.',
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
    : items.map(item => `🆔 ${item.itemId} — ${item.kind === 'zhdun_case' ? texts.caseName : texts.referralCaseName}`).join('\n')}`;
}


export function formatMining(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Invalid mining amount');
  }
  const thousandths = BigInt(amount) / BigInt(game.mining.precision);
  return `${thousandths / 1000n},${String(thousandths % 1000n).padStart(3, '0')}`;
}

export function durationText(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 3_600)} ч. ${Math.floor(seconds % 3_600 / 60)} мин. ${seconds % 60} сек.`;
}

export function miningText(farm: MiningFarm, now: Date): string {
  const remaining = farm.activeUntil.getTime() - now.getTime();
  return [
    '📼 Ваша майнинг-ферма:',
    `💡 Статус: ${remaining > 0 ? 'Включена' : 'Выключена'}`,
    `⛏️ Добыча: ${formatMining(farm.rate)}₿/час`,
    `💠 Баланс: ${formatMining(farm.balance)}₿`,
    ...(remaining > 0 ? [`⏳ Осталось ${durationText(remaining)}`] : [])
  ].join('\n');
}

export function miningOfferText(cost: number): string {
  return `💡 Улучшение фермы стоит ${formatMining(cost)}₿.`;
}

export function miningUpgradedText(farm: MiningFarm, increase: number): string {
  return `✅ Ферма прокачана! Теперь она дает ${formatMining(farm.rate)}₿/ч (+${formatMining(increase).replace(',', '.')})`
    + `\n⬆ Следующее улучшение стоит ${formatMining(farm.upgradeCost)}₿.`;
}

export function referralText(url: string, count: number): string {
  return `👬 Приглашайте друзей и получайте награды!\n\n🔗 Ссылка для приглашения: ${url}\nВы уже пригласили игроков: ${count}`;
}

export function referralRewardText(newcomer: Player): string {
  return `👬 ${mention(newcomer)} перешел по вашей реферальной ссылке.\n\n✅ Вы получили:\n\n`
    + `💰 ${formatAmount(game.referralRewardKC, game.kcScale)} KC\n${texts.referralCaseName} (1 шт.)`;
}

const rankingTitles = {
  kc: '💰 Топ игроков по балансу:',
  bitcoin: '💠 Топ игроков по биткоинам:',
  mining: '⛏️ Топ игроков по майнингу:',
  euro: '💶 Топ игроков по еврам:',
  referrals: '👥 Топ игроков по приглашенным:',
  reputation: '👍 Топ игроков по репутации:',
  stolenKC: '🥷 Топ воров:'
} satisfies Record<RankingMetric, string>;

export function rankEmoji(place: number): string {
  return String(place).split('').map(digit => `${digit}️⃣`).join('');
}

function rankingValue(score: number, metric: RankingMetric): string {
  switch (metric) {
    case 'kc':
    case 'stolenKC': return `${formatAmount(score, game.kcScale)} KC`;
    case 'bitcoin': return `${formatAmount(score, game.bitcoinScale)}₿`;
    case 'mining': return `${formatMining(score)}₿/час`;
    case 'euro': return `${formatAmount(score, game.euroScale)} 💶`;
    case 'referrals': return `${formatAmount(score, 1)} рефералов.`;
    case 'reputation': return formatAmount(score, 1);
  }
}

export function rankingText(metric: RankingMetric, ranking: Ranking, player: Player, score: number): string {
  const rows = ranking.leaders.map((leader, index) =>
    `${rankEmoji(index + 1)} ${mention(leader)} — ${rankingValue(leader.score, metric)}`);
  return `${rankingTitles[metric]}\n\n${rows.join('\n')}\n—————————————————\n`
    + `➡${rankEmoji(ranking.place)} ${mention(player)} — ${rankingValue(score, metric)}`;
}

export function miningWithdrawalText(amount: number): string {
  return `✅ Вы сняли ${formatAmount(amount, game.bitcoinScale)}₿.`;
}
