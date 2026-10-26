import { bankConfig } from '../config/bank.js';
import { game } from '../config/game.js';
import type { BalanceCurrency } from '../types/admin-balance.js';
import type { Deposit } from '../types/bank.js';
import type { Player } from '../types/game.js';
import { depositValue } from './bank-rules.js';
import { durationText, formatAmount, formatMining, mention } from './texts.js';

export const bankLabels = {
  director: '👑 Директор', bank: '🏦 Банк', casino: '🎰 Казино', savings: '💲 Накопительный счет',
  pension: '👵 Пенсия', transfer: '💳 Перевод', deposits: '🏧 Депозит', add: '💳 Пополнить', withdraw: '💰 Снять',
  create: '➕ Создать депозит', early: 'Снять досрочно', confirm: 'Подтвердить', back: 'Назад'
} as const;
export const bankTexts = {
  city: '🏙️ Город:', bank: '🏛️ Банк:', transfer: '💸 Выберите желаемую валюту для отправки.',
  target: '👤 Введите ссылку на игрока.\n💡 Например @kreox_owner',
  missing: '⚠️ Игрок не найден или ещё не зарегистрирован в боте.',
  self: '⚠️ Нельзя переводить деньги самому себе.',
  usage: '⚠️ Формат: монеты / евро / донат / бит / биткоин <игрок> <сумма>. Вместо игрока можно ответить на его сообщение.',
  invalid: '⚠️ Введите положительную сумму. Можно использовать к и кк.',
  funds: '⚠ Недостаточно KC!', fundsCurrency: '⚠️ Недостаточно средств!',
  limit: '⚠️ Достигнут предел баланса. Операция не выполнена.',
  young: '🍼 Ты ещё слишком мал для пенсии!',
  private: '⚠️ Откройте город и банк в личных сообщениях бота.',
  deposits: '🏧 Меню депозитов:', depositAmount: '💡 Введите сумму депозита.\n\n3 дня — +2%\n10 дней — +4%',
  depositMax: '⚠️ Максимальный депозит 10.000.000 KC', depositLimit: '⚠️ Можно открыть не более 5 депозитов.',
  depositTerm: '🗓 Теперь укажите количество дней.', unavailable: '⚠️ Депозит недоступен или уже закрыт.',
  ended: '🏧 Срок депозита истёк. Средства возвращаются автоматически.',
  stale: '⚠️ Подтверждение устарело. Начните действие заново.', cancelled: 'Действие отменено.'
} as const;
export function bankMoney(amount: number, currency: BalanceCurrency): string {
  return currency === 'kc' ? `${formatAmount(amount, game.kcScale)} KC` : currency === 'euro' ? `${formatAmount(amount, game.euroScale)}💶` : `${formatMining(amount)}₿`;
}
export function savingsText(amount: number): string { return `💲 Накопительный счет:\n\n💰 У вас: ${formatAmount(amount, game.kcScale)} KC`; }
export function savingsPrompt(player: Player, savings: number, direction: 'in' | 'out'): string {
  return direction === 'in' ? `💰 Введите количество денег, которое вы хотите положить (у вас: ${formatAmount(player.kc, game.kcScale)} KC).`
    : `💰 Введите количество денег, которое вы хотите снять (на счету: ${formatAmount(savings, game.kcScale)} KC).`;
}
export function savingsResult(wallet: number, savings: number): string {
  return `💱 Транзакция совершена.\n\n💰 На руках: ${formatAmount(wallet, game.kcScale)} KC\n💳 На счету: ${formatAmount(savings, game.kcScale)} KC`;
}
export function transferPrompt(player: Player, receiver: Player, currency: BalanceCurrency): string {
  const name = currency === 'kc' ? 'KC' : currency === 'euro' ? 'евро' : 'биткоинов';
  const balance = currency === 'euro' ? `${formatAmount(player.euro, game.euroScale)} 💶` : bankMoney(player[currency], currency);
  return `💡 Теперь введите количество ${name}, сколько вы хотите передать игроку ${mention(receiver)} (у вас: ${balance})`;
}
export function depositDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: bankConfig.timeZone, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
export function depositText(deposit: Deposit, now: Date): string {
  return `💳 Ваш депозит:\n\n🆔 ID: ${deposit.depositId}\n💰 Вложено: ${bankMoney(deposit.amount, 'kc')} (сейчас: ${bankMoney(depositValue(deposit, now), 'kc')})\n⌛️ Создан: ${depositDate(deposit.createdAt)}\n⏳ Депозит открыт до ${depositDate(deposit.expiresAt)} (+${bankConfig.depositRates[deposit.days]}% за ${deposit.days} дня)`;
}
export function depositEndText(deposit: Deposit, payout: number): string {
  return `🏧 Ваш депозит ID: ${deposit.depositId} был окончен.\n\nБаланс до: ${bankMoney(deposit.amount, 'kc')}\nБаланс после: ${bankMoney(payout, 'kc')}\nПроцент: ${bankConfig.depositRates[deposit.days]}%\n💰 Вы заработали ${bankMoney(payout - deposit.amount, 'kc')}`;
}

export function transferReceivedText(sender: Player, net: number, currency: BalanceCurrency): string {
  return `${mention(sender)} передал вам ${bankMoney(net, currency)}`;
}
export function transferSuccessText(receiver: Player, net: number, currency: BalanceCurrency, isChat: boolean): string {
  return `${isChat ? '' : '✅ '}Вы успешно передали ${bankMoney(net, currency)} игроку ${mention(receiver)}.`;
}
export function pensionWaitText(remaining: number): string {
  return `⏳ Подождите ${durationText(remaining)} до следующей пенсии.`;
}
export function pensionSuccessText(amount: number): string {
  return `✅ Ваша пенсия составила ${bankMoney(amount, 'kc')}`;
}
export function depositEarlyPrompt(deposit: Deposit, payout: number): string {
  return `💳 Вы точно хотите снять депозит с ID: ${deposit.depositId}? Вы получите ${bankMoney(payout, 'kc')} (-10% за досрочное снятие депозита).`;
}
export function depositEarlySuccessText(deposit: Deposit, payout: number, wallet: number): string {
  return `✅ Вы сняли депозит с ID: ${deposit.depositId} и получили ${bankMoney(payout, 'kc')} (-10% за досрочное снятие депозита)\n\n💸 Баланс: ${bankMoney(wallet, 'kc')}`;
}
