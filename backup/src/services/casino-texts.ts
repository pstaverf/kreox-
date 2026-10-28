import { casinoConfig } from '../config/casino.js';
import { rouletteHistory, rouletteOutcome, rouletteTargetText } from './roulette-texts.js';
import type { CasinoBet, CasinoMode, CasinoRound, DirectorState } from '../types/casino.js';
import type { Player } from '../types/game.js';
import { formatKc, mention } from './texts.js';

export const casinoTexts = {
  state: 'Государство', directorBid: 'Сделать ставку', directorPrompt: '💰 Введите, сколько вы хотите поставить на выборах мэра.',
  directorMinimum: '⚠ Ставку необходимо поднять минимум на 1.000 KC.',
  stale: '⚠️ Подтверждение устарело. Начните действие заново.',
  electionPending: '⏳ Подводим итоги выборов. Повторите действие после объявления результатов.',
  funds: '💰 Недостаточно средств.', limit: '⚠️ Достигнут безопасный предел суммы. Ставка не принята.',
  private: '⚠️ Игры доступны только в беседах.',
  crashRange: '⛔️ Показатель должен быть больше х1, но не больше х5000!',
  crashUsage: '⛔️ Использование: краш <коэффициент> <ставка>',
  rouletteUsage: '⛔️ Использование: рулетка <число или диапазон> <ставка>',
  doubleUsage: '⛔️ Использование: дабл <сектор> <ставка>',
  dreamUsage: '⛔️ Использование: дрим <сектор> <ставка>',
  winner: '👑 Поздравляем с победой на выборах! В течение этого дня вы будете получать 1% со всех ставок в играх казино в беседах.',
  creditWaiting: '⏳ Выплата сохранена. Достигнут предел баланса; выплата будет повторена автоматически.'
} as const;
export function kc(value: number): string { return `${formatKc(value)} KC`; }
export function modeName(mode: CasinoMode): string { return mode === 'crash' ? 'Краш' : mode === 'roulette' ? 'Рулетка' : mode === 'double' ? 'Дабл' : 'Дрим'; }
export function coefficient(value: number): string { return (value / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
export function chance(amount: number, total: number): string {
  return total === 0 ? '0' : (Number(BigInt(amount) * 10_000n / BigInt(total)) / 100).toFixed(2).replace('.', ',');
}
export function directorText(state: DirectorState, holder: Player | null, personal: number, chat: boolean): string {
  const name = holder === null ? casinoTexts.state : mention(holder);
  return chat ? `👑 Директор: ${name} (заработал: ${kc(state.earnedKC)})`
    : `🤴 Сейчас директор: ${name} (уже заработано: ${kc(state.earnedKC)})\n\n⏳ Мэра выбирают каждый день в 00:00 по МСК! (Всего поставлено: ${kc(state.total)})${personal > 0 ? `\n\n🪙 Ваша ставка: ${kc(personal)} (${chance(personal, state.total)}%)` : ''}`;
}
export function directorConfirmation(amount: number): string { return `💸 Вы точно хотите поставить ${kc(amount)}?`; }
export function directorSuccess(amount: number): string { return `✅ Вы успешно поставили ${kc(amount)} на выборы.`; }
export function electionAnnouncement(total: number, participants: number, winner: Player | null, stake: number): string {
  return `🤴 Выборы директора закончились.\n\n💰 Всего ставок было: ${kc(total)} (ставило: ${participants} чел.)\n😎 Победил: ${winner === null ? casinoTexts.state : mention(winner)} со ставкой ${kc(stake)} (шанс: ${chance(stake, total)}%)`;
}
export function electionRefund(amount: number): string { return `🎰 Выборы директора закончились, вы проиграли.\n\n💰 Возвращено: ${kc(amount)} (50% ставки на выборы директора)`; }
export function betMinimum(mode: CasinoMode): string { return `💰 Минимальная ставка в режиме «${modeName(mode)}» — 1.000 KC.`; }
export function betMaximum(mode: CasinoMode): string { return `💰 Максимальная ставка в режиме «${modeName(mode)}» — 1.000.000 KC`; }
export function betLimit(mode: CasinoMode): string { return `💰 Не более 10 ставок в режиме «${modeName(mode)}».`; }
export function betAccepted(player: Player, mode: CasinoMode, amount: number, target: number): string {
  return `✅ ${mention(player)} — ${kc(amount)} на ${mode === 'crash' ? `x${coefficient(target)}` : mode === 'roulette' ? rouletteTargetText(target) : mode === 'double' ? `x${target} (дабл)` : `сектор ${target}`}`;
}
export function roundClosed(mode: CasinoMode): string { return `🎰 Приём ставок для игры "${modeName(mode)}" закрыт.\n🕒 Итоги раунда через 5 секунд${mode === 'double' ? '...' : '…'}`; }
export function outcome(round: Pick<CasinoRound, 'mode' | 'result' | 'bonus'>): string {
  if (round.mode === 'double') return `x${round.result}`;
  return round.mode === 'roulette' ? rouletteOutcome(round.result) : round.mode === 'crash' ? `x${coefficient(round.result)}` : `${round.bonus === 1 ? '' : `множитель х${round.bonus} - `}сектор №${round.result} - [x${(round.result + 1) * round.bonus}]`;
}
export function roundHeading(round: CasinoRound): string {
  if (round.mode === 'double') return `↔️ Итоги игры "Дабл":\n\n💸 Выпал множитель x${round.result}`;
  if (round.mode === 'roulette') return `🎰 Итоги игры "Рулетка":\n\n🎡 Выпало — ${rouletteOutcome(round.result)}`;
  return round.mode === 'crash' ? `📊 Итоги игры "Краш":\n\n📈 Краш на отметке: ${outcome(round)}`
    : `🎡 Итоги игры "Дрим":\n\n🎡 Выпал сектор #${round.result}${round.bonus === 1 ? '' : ` - множитель ${round.bonus}`} - [x${(round.result + 1) * round.bonus}]`;
}
export function winningBet(bet: CasinoBet, mode: CasinoMode, payout: number): string {
  return `✅ [id${bet.vkId}|${bet.name}] — ${kc(bet.amount)} на ${mode === 'crash' ? coefficient(bet.target) : mode === 'roulette' ? rouletteTargetText(bet.target) : bet.target}\n— Приз: ${kc(payout)}`;
}
export function roundFooter(round: CasinoRound): string {
  return `${round.winners === 0 ? '\n\n❌ Все ставки проиграли!' : ''}${round.losses > 0 ? `\n\n💰 Проиграно: ${kc(round.losses)}` : ''}`;
}
const historyLabels: Record<CasinoMode, string> = { crash: 'коэффициентов', roulette: 'чисел', dream: 'секторов', double: 'множителей' };
export function historyText(mode: CasinoMode, history: CasinoRound['history']): string {
  const entries = history.slice(-casinoConfig.historySize);
  return `Последние ${casinoConfig.historySize} выпавших ${historyLabels[mode]}\n\n${entries.length === 0 ? 'Пока нет завершённых раундов.' : entries.map(item => mode === 'roulette' ? rouletteHistory(item.result) : outcome({ ...item, mode })).join('\n')}`;
}
