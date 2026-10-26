import { privateCasinoConfig } from '../config/private-casino.js';
import type { Player } from '../types/game.js';
import type { CoinSide, CoinState } from '../types/private-casino.js';
import { coefficient, kc } from './casino-texts.js';
import { mention } from './texts.js';

export const privateCasinoTexts = {
  chats: '💬 Беседы', jackpot: '🎰 Джекпот', coin: '🪙 Монетка', join: '☑️ Участвовать', cashout: 'Забрать выигрыш',
  private: '⚠️ Этот раздел доступен только в личных сообщениях.',
  active: '⚠️ У вас идёт активная игра в режиме «Монетка»!',
  firstStake: '⚠️ Сначала введите ставку!', noFlips: '⚠️ Вы еще не подкидывали монетку.',
  cannotChange: '⚠️ После первого броска изменить ставку нельзя.',
  stakeUsage: `⚠️ Введите ставку от ${kc(privateCasinoConfig.coinMinimum)}.`,
  already: '⚠️ Вы уже участвуете!', registered: '✅ Вы зарегистрированы.',
  settling: '⏳ Подводим итоги джекпота. Попробуйте немного позже.',
  intro: '🪙 Режим «Монетка».\n\n💎 Введите ставку, а затем выберите одну сторону: изумруд либо алмаз.\n\n🟢 Если вы угадаете сторону, которая выпадет на монетке — ваш выигрыш умножится! Вы можете продолжить для большего множителя или же забрать выигрыш и уйти.'
} as const;
export function casinoLobbyText(player: Player, holder: Player | null, earned: number): string {
  return `${mention(player)}, казино:\n\n🤑 Крупье: ${holder === null ? 'Государство' : mention(holder)} (заработал: ${kc(earned)})`;
}
export function jackpotText(amount: number, participants: number): string { return `🎰 Накоплено: ${kc(amount)}\n\n💰 Участников: ${participants}`; }
export function jackpotAnnouncement(winner: Player, amount: number): string { return `🎰 ${mention(winner)} получает джекпот: ${kc(amount)}`; }
export function jackpotWinnerText(amount: number): string { return `🎰 ДЖЕКПОТ! Вы стали победителем джекпота\n\n💰 Ваш выигрыш составил ${kc(amount)}`; }
export function coinSymbol(side: CoinSide): string { return side === 'diamond' ? '💎' : '🟢'; }
export function coinStakeText(amount: number): string { return `💰 Ставка ${kc(amount)} сделана. Выбирайте монетку или измените ставку!`; }
export function coinWinText(state: CoinState, multiplier: number, payout: number, balance: number): string {
  return `✅ Вы угадали!\n\n🪙 На монетке выпадало: ${state.history.map(coinSymbol).join('')}\n\n💰 Множитель: x${coefficient(multiplier)} (вы получите ${kc(payout)}, если заберете сейчас!)\n\n💸 Баланс: ${kc(balance)}`;
}
export function coinLossText(balance: number): string { return `❌ Вы не угадали. Вся ставка потеряна.\n\n💸 Баланс: ${kc(balance)}`; }
export function coinPaidText(amount: number, payout: number, final: boolean): string {
  return `${final ? '✅ Вы дошли до конца!' : '✅ Вы забрали выигрыш!'}\n\n💰 Ваш чистый выигрыш составил: ${kc(payout - amount)}`;
}
