import { privateCasinoConfig } from '../config/private-casino.js';
import { casinoConfig } from '../config/casino.js';
import { game } from '../config/game.js';
import type { CasinoRandom } from '../types/casino.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { CoinState, PrivateCasinoCommand } from '../types/private-casino.js';
import type { GameStore } from '../types/storage.js';
import { addCasinoCredit } from './casino-credits.js';
import { parseCasinoStake, casinoPercent } from './casino-rules.js';
import { casinoTexts } from './casino-texts.js';
import { safeBankMoney } from './bank-rules.js';
import { directorState } from './director.js';
import { coinActive, coinKey, coinMultiplier, coinPayout, coinSession } from './coin-rules.js';
import { coinLossText, coinPaidText, coinStakeText, coinWinText, privateCasinoTexts } from './private-casino-texts.js';

export async function coinState(store: GameStore, vkId: number): Promise<CoinState | null> {
  const state = await store.casinoGet(coinKey(vkId));
  if (state === null) return null;
  if (state.kind !== 'coin' || state.vkId !== vkId || !safeBankMoney(state.amount) || state.history.length > privateCasinoConfig.coinMultipliers.length
    || state.history.some(side => side !== 'diamond' && side !== 'emerald')
    || (coinActive(state) && state.amount < privateCasinoConfig.coinMinimum)
    || (state.stage === 'staked' && state.history.length !== 0)
    || (state.stage === 'playing' && (state.history.length === 0 || state.history.length >= privateCasinoConfig.coinMultipliers.length))) throw new Error('Invalid coin state');
  return state;
}
export function coinReply(text: string, state: CoinState): Reply {
  return { text, keyboard: { kind: 'coin', token: state.sessionId, step: state.history.length } };
}
async function saveCoin(store: GameStore, state: CoinState, exists: boolean): Promise<void> {
  if (exists) await store.casinoSave(state);
  else await store.casinoInsert(state);
}
export async function openCoin(store: GameStore, player: Player, input: GameInput): Promise<Reply> {
  const previous = await coinState(store, player._id);
  await store.setCoinOpen(player._id, true);
  if (previous !== null && coinActive(previous)) {
    const payout = previous.history.length === 0 ? null : coinPayout(previous.amount, previous.history.length);
    return coinReply(payout === null ? coinStakeText(previous.amount) : coinWinText(previous, coinMultiplier(previous.history.length), payout, player.kc), previous);
  }
  const state: CoinState = { _id: coinKey(player._id), kind: 'coin', version: previous?.version ?? 0, vkId: player._id,
    sessionId: coinSession(input.eventId), stage: 'ready', amount: 0, history: [] };
  await saveCoin(store, state, previous !== null);
  return coinReply(privateCasinoTexts.intro, state);
}
export async function coinStakeInput(store: GameStore, player: Player, input: GameInput): Promise<Reply> {
  const previous = await coinState(store, player._id);
  if (previous === null) throw new Error('Missing open coin state');
  if (previous.stage === 'playing') return coinReply(privateCasinoTexts.cannotChange, previous);
  const parsed = parseCasinoStake(input.text ?? '');
  if (parsed === null) return coinReply(privateCasinoTexts.stakeUsage, previous);
  const old = previous.stage === 'staked' ? previous.amount : 0;
  const available = BigInt(player.kc) + BigInt(old);
  const raw = parsed === 'all' ? available : parsed === 'half' ? available / 2n : BigInt(parsed);
  if (raw < BigInt(privateCasinoConfig.coinMinimum)) return coinReply(privateCasinoTexts.stakeUsage, previous);
  if (raw > BigInt(game.maxAmount)) return coinReply(casinoTexts.limit, previous);
  const amount = Number(raw);
  if (coinPayout(amount, privateCasinoConfig.coinMultipliers.length) === null) return coinReply(casinoTexts.limit, previous);
  const delta = amount - old;
  if (delta !== 0 && !await store.updateBalance(player._id, 'kc', delta > 0 ? 'take' : 'add', Math.abs(delta))) return coinReply(delta > 0 ? casinoTexts.funds : casinoTexts.limit, previous);
  const state: CoinState = { ...previous, sessionId: coinSession(input.eventId), amount, history: [], stage: 'staked' };
  await store.casinoSave(state);
  return coinReply(coinStakeText(amount), state);
}
async function finishCoin(store: GameStore, player: Player, state: CoinState, final: boolean): Promise<Reply> {
  const payout = coinPayout(state.amount, state.history.length);
  if (payout === null) throw new Error('Coin payout exceeded reserved bound');
  const paid = await store.updateBalance(player._id, 'kc', 'add', payout);
  if (!paid) await addCasinoCredit(store, `coin:${state.sessionId}`, player._id, payout);
  state.stage = 'finished';
  await store.casinoSave(state);
  return coinReply(`${coinPaidText(state.amount, payout, final)}${paid ? '' : `\n\n${casinoTexts.creditWaiting}`}`, state);
}
export async function coinAction(store: GameStore, player: Player, command: Extract<PrivateCasinoCommand, { kind: 'coin_flip' | 'coin_cashout' }>, random: CasinoRandom): Promise<Reply> {
  const state = await coinState(store, player._id);
  if (state === null) return { text: privateCasinoTexts.firstStake, keyboard: { kind: 'casino' } };
  if (!coinActive(state)) return coinReply(privateCasinoTexts.firstStake, state);
  if (command.token !== state.sessionId || command.step !== state.history.length) return coinReply(casinoTexts.stale, state);
  if (command.kind === 'coin_cashout') return state.history.length === 0 ? coinReply(privateCasinoTexts.noFlips, state) : finishCoin(store, player, state, false);
  if (command.side !== 'diamond' && command.side !== 'emerald') throw new Error('Invalid coin choice');
  if (state.history.length === 0) {
    const director = await directorState(store, await store.now());
    if (director.dueAt <= await store.now()) return coinReply(casinoTexts.electionPending, state);
    const fee = casinoPercent(state.amount, casinoConfig.directorPercent);
    if (director.holderId !== null) {
      if (director.earnedKC > game.maxAmount - fee) return coinReply(casinoTexts.limit, state);
      director.earnedKC += fee;
    }
    await store.casinoSave(director, director.dueAt);
  }
  const side = random(`coin:${state.sessionId}:${state.history.length}`, 2) === 0 ? 'diamond' : 'emerald';
  state.history.push(side);
  if (side !== command.side) {
    state.stage = 'finished';
    const dealer = await store.dealer();
    if (dealer.holderId !== null) await addCasinoCredit(store, `coin-dealer:${state.sessionId}`, dealer.holderId, casinoPercent(state.amount, casinoConfig.dealerPercent), 'dealer');
    await store.casinoSave(state);
    return coinReply(coinLossText(player.kc), state);
  }
  if (state.history.length === privateCasinoConfig.coinMultipliers.length) return finishCoin(store, player, state, true);
  state.stage = 'playing';
  await store.casinoSave(state);
  const payout = coinPayout(state.amount, state.history.length);
  if (payout === null) throw new Error('Invalid coin payout');
  return coinReply(coinWinText(state, coinMultiplier(state.history.length), payout, player.kc), state);
}
