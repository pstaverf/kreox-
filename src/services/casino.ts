import { casinoConfig } from '../config/casino.js';
import { game } from '../config/game.js';
import type { CasinoCommand, CasinoLine, CasinoRandom, CasinoRound } from '../types/casino.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { GameStore } from '../types/storage.js';
import { safeBankMoney } from './bank-rules.js';
import { betAccepted, betLimit, betMinimum, casinoTexts, historyText } from './casino-texts.js';
import { betPayout, casinoPercent, resolveCasinoStake, roundKey, selectOutcome } from './casino-rules.js';
import { directorAction, directorState } from './director.js';

export function messageParts(text: string): string[] {
  const parts: string[] = [];
  let buffer = '';
  for (const line of text.split('\n')) {
    if (line.length > game.maxMessageLength) throw new Error('Unbounded casino line');
    const next = buffer.length === 0 ? line : `${buffer}\n${line}`;
    if (next.length > game.maxMessageLength) { parts.push(buffer); buffer = line; }
    else buffer = next;
  }
  if (buffer.length > 0) parts.push(buffer);
  return parts;
}
async function acceptBet(store: GameStore, player: Player, line: CasinoLine, input: GameInput, index: number, random: CasinoRandom): Promise<string> {
  if ('error' in line) return line.error;
  const peerId = input.peerId;
  if (peerId === undefined || !Number.isSafeInteger(peerId) || peerId <= 2_000_000_000) throw new Error('Missing casino chat');
  const current = typeof line.amount === 'number' ? player : await store.player(player._id);
  if (current === null) throw new Error('Missing casino actor');
  const amount = resolveCasinoStake(line.amount, current.kc);
  if (!safeBankMoney(amount) || !Number.isSafeInteger(line.target)
    || (line.mode === 'crash' ? line.target <= 100 || line.target > casinoConfig.maxCrash : !casinoConfig.sectors.some(sector => sector === line.target))) throw new Error('Invalid typed casino bet');
  if (amount < casinoConfig.minimum) return betMinimum(line.mode);
  const now = await store.now();
  const director = await directorState(store, now);
  if (director.dueAt <= now) return casinoTexts.electionPending;
  const existing = await store.casinoGet(roundKey(peerId, line.mode));
  if (existing !== null && existing.kind !== 'round') throw new Error('Invalid active round');
  if (existing !== null && existing.stage !== 'finished' && (existing.stage !== 'open' || existing.closesAt <= now)) return casinoTexts.closed;
  const active = existing !== null && existing.stage !== 'finished';
  const roundId = active ? existing.roundId : `game:${input.eventId}:${index}`;
  if ((await store.casinoList({ kind: 'bet', roundId, vkId: player._id }, casinoConfig.maxBets)).length >= casinoConfig.maxBets) return betLimit(line.mode);
  const liability = betPayout(line.mode, amount, line.target, line.mode === 'dream' ? 7 : 1);
  if (liability === null) return casinoTexts.limit;
  const fee = casinoPercent(amount, casinoConfig.directorPercent);
  if (director.holderId !== null && director.earnedKC > game.maxAmount - fee) return casinoTexts.limit;
  if (active && (existing.total > game.maxAmount - amount || existing.liability > game.maxAmount - liability)) return casinoTexts.limit;
  if (!await store.updateBalance(player._id, 'kc', 'take', amount)) return casinoTexts.funds;
  if (director.holderId !== null) director.earnedKC += fee;
  await store.casinoSave(director, director.dueAt);
  const selected = active ? { result: existing.result, bonus: existing.bonus } : selectOutcome(line.mode, random, roundId);
  const closesAt = active ? new Date(existing.closesAt.getTime() + casinoConfig.extensionMs) : new Date(now.getTime() + casinoConfig.acceptanceMs);
  const round: CasinoRound = active ? { ...existing, closesAt, dueAt: closesAt, total: existing.total + amount, liability: existing.liability + liability }
    : { _id: roundKey(peerId, line.mode), kind: 'round', version: existing?.version ?? 0, peerId, mode: line.mode, roundId, stage: 'open', dueAt: closesAt, closesAt,
      ...selected, total: amount, liability, losses: 0, winners: 0, buffer: '', pages: 0, nextPage: 0, dealerId: null, history: existing?.history ?? [] };
  if (existing === null) await store.casinoInsert(round);
  else await store.casinoSave(round, active ? existing.closesAt : undefined);
  await store.casinoInsert({ _id: `bet:${input.eventId}:${index}`, kind: 'bet', version: 0, roundId, vkId: player._id, name: player.name, amount, target: line.target, settled: false });
  return betAccepted(player, line.mode, amount, line.target);
}
export async function casinoAction(store: GameStore, player: Player, command: CasinoCommand, input: GameInput, random: CasinoRandom): Promise<Reply> {
  if (command.kind === 'city_director') return directorAction(store, player, { kind: 'director_view' }, input);
  if (command.kind === 'director_view' || command.kind === 'director_bid' || command.kind === 'director_confirm') return directorAction(store, player, command, input);
  if (!input.isChat) return { text: casinoTexts.private, keyboard: { kind: 'none' } };
  if (command.kind === 'casino_log') {
    if (input.peerId === undefined) throw new Error('Missing history chat');
    const round = await store.casinoGet(roundKey(input.peerId, command.mode));
    if (round !== null && round.kind !== 'round') throw new Error('Invalid history');
    return { text: historyText(command.mode, round?.history ?? []), keyboard: { kind: 'none' } };
  }
  const replies: string[] = [];
  for (const [index, line] of command.lines.entries()) replies.push(await acceptBet(store, player, line, input, index, random));
  const parts = messageParts(replies.join('\n'));
  if (parts.length > 1) {
    if (input.peerId === undefined) throw new Error('Missing delivery peer');
    await store.casinoInsert({ _id: `delivery:${input.eventId}`, kind: 'delivery', version: 0, peerId: input.peerId, texts: parts, index: 0, stage: 'pending', dueAt: new Date(0) });
    return { text: '', keyboard: { kind: 'none' } };
  }
  return { text: parts[0] ?? casinoTexts.crashUsage, keyboard: { kind: 'none' } };
}
