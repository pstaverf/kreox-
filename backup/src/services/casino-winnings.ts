import { casinoConfig } from '../config/casino.js';
import { game } from '../config/game.js';
import type { CasinoBet, CasinoRound } from '../types/casino.js';
import type { GameStore } from '../types/storage.js';
import { safeBankMoney } from './bank-rules.js';
import { addCasinoCredit } from './casino-credits.js';
import { betPayout } from './casino-rules.js';

export async function settleWinningGroup(store: GameStore, round: CasinoRound, selected: CasinoBet): Promise<{ amount: number; payout: number; count: number }> {
  const pending = await store.casinoList({ kind: 'bet', roundId: round.roundId, vkId: selected.vkId, settled: false }, casinoConfig.maxBets);
  const group: { bet: CasinoBet; payout: number }[] = [];
  let amount = 0n;
  let totalPayout = 0n;
  for (const bet of pending) {
    if (bet.kind !== 'bet' || bet.roundId !== round.roundId || bet.vkId !== selected.vkId || !safeBankMoney(bet.amount) || bet.amount <= 0) throw new Error('Invalid casino winning group');
    if (bet.target !== selected.target) continue;
    const payout = betPayout(round.mode, bet.amount, bet.target, round.bonus);
    if (payout === null) throw new Error('Casino payout exceeded reserved bound');
    amount += BigInt(bet.amount);
    totalPayout += BigInt(payout);
    group.push({ bet, payout });
  }
  if (!group.some(value => value.bet._id === selected._id) || amount > BigInt(game.maxAmount) || totalPayout > BigInt(game.maxAmount)) throw new Error('Invalid casino group total');
  for (const value of group) {
    await addCasinoCredit(store, value.bet._id, value.bet.vkId, value.payout);
    value.bet.settled = true;
    await store.casinoSave(value.bet);
  }
  return { amount: Number(amount), payout: Number(totalPayout), count: group.length };
}
