import { casinoConfig } from '../config/casino.js';
import { accountCapacity, game } from '../config/game.js';
import type { CasinoCommand, CasinoRandom, DirectorState } from '../types/casino.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { GameStore } from '../types/storage.js';
import { parseBankMoney, safeBankMoney } from './bank-rules.js';
import { casinoTexts, directorConfirmation, directorSuccess, directorText, electionAnnouncement } from './casino-texts.js';
import { nextElection } from './casino-rules.js';
import { addCasinoCredit } from './casino-credits.js';

export async function directorState(store: GameStore, now: Date): Promise<DirectorState> {
  const existing = await store.casinoGet('director');
  if (existing !== null) {
    if (existing.kind !== 'director' || !safeBankMoney(existing.earnedKC) || !safeBankMoney(existing.total)) throw new Error('Invalid director state');
    return existing;
  }
  const dueAt = nextElection(now);
  const state: DirectorState = { _id: 'director', kind: 'director', version: 0, holderId: null, earnedKC: 0, dueAt, electionId: dueAt.toISOString(), total: 0, participants: 0 };
  await store.casinoInsert(state);
  return state;
}
export async function directorAction(store: GameStore, player: Player, command: Extract<CasinoCommand, { kind: 'director_view' | 'director_bid' }> | Extract<CasinoCommand, { kind: 'director_confirm' }>, input: GameInput): Promise<Reply> {
  const state = await directorState(store, await store.now());
  if (command.kind === 'director_view') {
    if (!input.isChat) await store.setDirectorDraft(player._id, null);
    const bid = await store.casinoGet(`bid:${state.electionId}:${player._id}`);
    const holder = state.holderId === null ? null : await store.player(state.holderId);
    return { text: directorText(state, holder, bid?.kind === 'bid' ? bid.amount : 0, input.isChat ?? false), keyboard: { kind: input.isChat ? 'none' : 'director' } };
  }
  if (input.isChat) return { text: casinoTexts.private, keyboard: { kind: 'none' } };
  if (command.kind === 'director_bid') {
    await store.setDirectorDraft(player._id, { step: 'amount' });
    return { text: casinoTexts.directorPrompt, keyboard: { kind: 'director_back' } };
  }
  const draft = player.directorDraft;
  if (draft?.step !== 'confirm' || draft.token !== command.token || draft.electionId !== state.electionId) return { text: casinoTexts.stale, keyboard: { kind: 'director_back' } };
  if (state.dueAt <= await store.now()) return { text: casinoTexts.electionPending, keyboard: { kind: 'director_back' } };
  const old = await store.casinoGet(`bid:${state.electionId}:${player._id}`);
  if (old !== null && old.kind !== 'bid') throw new Error('Invalid director bid');
  if (!safeBankMoney(draft.amount) || draft.amount < casinoConfig.minimum) throw new Error('Invalid confirmed director bid');
  if (state.total > game.maxAmount - draft.amount || (old?.amount ?? 0) > game.maxAmount - draft.amount) return { text: casinoTexts.limit, keyboard: { kind: 'director_back' } };
  if (!await store.updateBalance(player._id, 'kc', 'take', draft.amount)) return { text: casinoTexts.funds, keyboard: { kind: 'director_back' } };
  if (old === null) {
    await store.casinoInsert({ _id: `bid:${state.electionId}:${player._id}`, kind: 'bid', version: 0, electionId: state.electionId, vkId: player._id, amount: draft.amount, settled: false });
    state.participants += 1;
  } else {
    old.amount += draft.amount;
    await store.casinoSave(old);
  }
  state.total += draft.amount;
  await store.casinoSave(state, state.dueAt);
  await store.setDirectorDraft(player._id, null);
  return { text: directorSuccess(draft.amount), keyboard: { kind: 'main' } };
}
export async function directorTextInput(store: GameStore, player: Player, input: GameInput): Promise<Reply> {
  const amount = parseBankMoney(input.text ?? '', 'kc');
  if (amount === null || amount < casinoConfig.minimum) return { text: casinoTexts.directorMinimum, keyboard: { kind: 'director_back' } };
  if (amount > player.kc) return { text: casinoTexts.funds, keyboard: { kind: 'director_back' } };
  const state = await directorState(store, await store.now());
  if (state.dueAt <= await store.now()) return { text: casinoTexts.electionPending, keyboard: { kind: 'director_back' } };
  await store.setDirectorDraft(player._id, { step: 'confirm', amount, token: input.eventId, electionId: state.electionId });
  return { text: directorConfirmation(amount), keyboard: { kind: 'director_confirm', token: input.eventId } };
}
export async function startDueElection(store: GameStore, now: Date, random: CasinoRandom): Promise<boolean> {
  const state = await directorState(store, now);
  if (state.dueAt > now) return false;
  const bids = await store.casinoList({ kind: 'bid', electionId: state.electionId, settled: false }, accountCapacity);
  let remaining = state.total > 0 ? random(`election:${state.electionId}`, state.total) : 0;
  let winnerId: number | null = null;
  let winnerStake = 0;
  let sum = 0;
  for (const bid of bids) {
    if (bid.kind !== 'bid') throw new Error('Invalid election participant');
    sum += bid.amount;
    if (winnerId === null && remaining < bid.amount) { winnerId = bid.vkId; winnerStake = bid.amount; }
    else if (winnerId === null) remaining -= bid.amount;
  }
  if (sum !== state.total || bids.length !== state.participants || (state.total > 0 && winnerId === null)) throw new Error('Inconsistent election pool');
  if (state.holderId !== null && state.earnedKC > 0) await addCasinoCredit(store, `director:${state.electionId}`, state.holderId, state.earnedKC);
  const winner = winnerId === null ? null : await store.player(winnerId);
  await store.casinoInsert({ _id: `election:${state.electionId}`, kind: 'election', version: 0, electionId: state.electionId, winnerId, winnerStake, total: state.total, participants: state.participants,
    announcement: electionAnnouncement(state.total, state.participants, winner, winnerStake), stage: 'refunds', afterChat: '', dueAt: now });
  state.holderId = winnerId;
  state.earnedKC = 0;
  state.total = 0;
  state.participants = 0;
  state.dueAt = new Date(state.dueAt.getTime() + casinoConfig.dayMs);
  state.electionId = state.dueAt.toISOString();
  await store.casinoSave(state);
  return true;
}
