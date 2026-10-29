import type { BossRun } from '../types/boss.js';
import type { Player, Ranking } from '../types/game.js';
import { formatAmount, formatKc, mention, rankEmoji } from './texts.js';
export const bossTexts = {
  usage: '⛔️ Использование: !cboss <health> «<name>» <color> [photo]',
  alive: '🎩 Босс уже призван. Сначала победите его.',
  subscribed: '🔔 Вы успешно подписались на уведомления.',
  unsubscribed: '🔕 Вы успешно отписались от уведомлений.',
  fight: '⚔️ Нажимайте на мечи, чтобы атаковать босса!',
  miss: '😶 Вы промахнулись...',
  funds: '💰 Недостаточно средств.',
  limit: '⚠️ Достигнут безопасный предел прокачки.',
  help: '🆘 Помощь:'
} as const;
export function bossAbsent(player: Player): string { return `🎩 ${mention(player)}, босс ещё не призван.\n🔔 Следи за уведомлениями!`; }
export function bossSummoned(run: BossRun): string { return `🎩 Босс «${run.name}» со здоровьем ${formatAmount(run.initialHealth, 1)} успешно призван!`; }
export function bossAnnouncement(run: BossRun): string { return `🎩 Босс «${run.name}» был призван.\n⚔️ Скорее начинай атаковать его чтобы выбить награду!`; }
export function bossMenu(run: BossRun, damage: number): string { return `${run.color} Босс: ${run.name}\n\n❤ Здоровье: ${formatAmount(run.health, 1)}/${formatAmount(run.initialHealth, 1)}\n⚔ Урон: ${formatAmount(damage, 1)}`; }
export function gymText(power: number): string { return `📋 Ваши параметры:\n\n🗡 Урон: ${formatAmount(power, 1)} ед.\n\n🛡 Что вы хотите прокачать?`; }
export function upgradeText(power: number, cost: number, balance: number, success: boolean): string {
  return `${success ? `🗡 Урон прокачан! Теперь ваш урон: ${formatAmount(power, 1)}. Хотите прокачать дальше?` : '🗡 Вы хотите повысить урон на 3 ед.?'}\n💰 Это обойдется вам в ${formatKc(cost)} KC ${success ? '(за х1).' : '(прокачки х10, х100 и х1000 выйдут дороже из-за роста).'}\n💸 Баланс: ${formatKc(balance)} KC`;
}
export function bossHit(damage: number, critical: boolean, reward: string | null, dead: boolean): string {
  const first = `🗡 Вы нанесли боссу ${formatAmount(damage, 1)} ед. урона${critical ? '... это КРИТИЧЕСКИЙ удар!' : '.'}`;
  const next = reward === null ? dead ? '🎩 Босс повержен!' : '⚔️ Продолжайте атаковать босса: с него может что-то выпасть...' : `🤩 Ваша атака заставила босса выронить награду:\n${reward}`;
  return `${first}\n\n${next}${dead && reward !== null ? '\n🎩 Босс повержен!' : ''}`;
}
export function bossLeaders(ranking: Ranking, player: Player, damage: number): string {
  const lines = ranking.leaders.map((leader, index) => `${rankEmoji(index + 1)} [id${leader._id}|${leader.name}] — ${formatAmount(leader.score, 1)} урона`);
  return `🏆 Лучшие игроки по урону:\n\n${lines.length === 0 ? '' : `${lines.join('\n')}\n`}—————————————————\n➡${rankEmoji(ranking.place)} ${mention(player)} — ${formatAmount(damage, 1)} урона`;
}
