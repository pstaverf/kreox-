import { privateCasinoConfig } from '../config/private-casino.js';
import { casinoConfig } from '../config/casino.js';
import { accountCapacity, game } from '../config/game.js';
import type { CasinoRandom } from '../types/casino.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { JackpotState } from '../types/private-casino.js';
import type { GameDatabase, GameStore } from '../types/storage.js';
import { DuplicateWriteError } from '../types/storage.js';
import { addCasinoCredit } from './casino-credits.js';
import { cachedCasinoRandom, casinoRandom } from './casino-rules.js';
import { casinoTexts } from './casino-texts.js';
import { jackpotAnnouncement, jackpotText, jackpotWinnerText, privateCasinoTexts } from './private-casino-texts.js';

export function nextJackpot(now: Date): Date {
  const day = Math.floor((now.getTime() + casinoConfig.moscowOffsetMs) / casinoConfig.dayMs) * casinoConfig.dayMs;
  const at = day + (privateCasinoConfig.jackpotHour * 60 + privateCasinoConfig.jackpotMinute) * 60_000 - casinoConfig.moscowOffsetMs;
  return new Date(at > now.getTime() ? at : at + casinoConfig.dayMs);
}
function seed(dueAt: Date, random: CasinoRandom): number {
  return (privateCasinoConfig.jackpotSeedMin + random(`jackpot:seed:${dueAt.toISOString()}`, privateCasinoConfig.jackpotSeedMax - privateCasinoConfig.jackpotSeedMin + 1)) * game.kcScale;
}
export async function jackpotState(store: GameStore, now: Date, random: CasinoRandom): Promise<JackpotState> {
  const existing = await store.casinoGet('jackpot');
  if (existing !== null) {
    if (existing.kind !== 'jackpot' || !Number.isSafeInteger(existing.amount) || existing.amount < 0 || existing.amount > game.maxAmount
      || !Number.isSafeInteger(existing.participants) || existing.participants < 0 || existing.participants > accountCapacity) throw new Error('Invalid jackpot state');
    return existing;
  }
  const dueAt = nextJackpot(now);
  const state: JackpotState = { _id: 'jackpot', kind: 'jackpot', version: 0, roundId: dueAt.toISOString(), dueAt, amount: seed(dueAt, random), participants: 0 };
  await store.casinoInsert(state);
  return state;
}
export async function jackpotAction(store: GameStore, player: Player, join: boolean, input: GameInput, random: CasinoRandom): Promise<Reply> {
  const now = await store.now();
  const state = await jackpotState(store, now, random);
  const reply = (text: string): Reply => ({ text, keyboard: { kind: 'jackpot' } });
  if (!join) return reply(jackpotText(state.amount, state.participants));
  if (state.dueAt <= now) return reply(privateCasinoTexts.settling);
  const id = `jackpot-entry:${state.roundId}:${player._id}`;
  if (await store.casinoGet(id) !== null) return reply(privateCasinoTexts.already);
  const growth = random(`jackpot:join:${input.eventId}:chance`, 2) === 0 ? 0
    : (privateCasinoConfig.jackpotGrowthMin + random(`jackpot:join:${input.eventId}:amount`, privateCasinoConfig.jackpotGrowthMax - privateCasinoConfig.jackpotGrowthMin + 1)) * game.kcScale;
  if (state.amount > game.maxAmount - growth || state.participants >= accountCapacity) return reply(casinoTexts.limit);
  await store.casinoInsert({ _id: id, kind: 'jackpot_entry', version: 0, roundId: state.roundId, vkId: player._id });
  state.amount += growth;
  state.participants += 1;
  await store.casinoSave(state, state.dueAt);
  return reply(privateCasinoTexts.registered);
}
async function drawJackpot(store: GameStore, now: Date, random: CasinoRandom): Promise<boolean> {
  const state = await jackpotState(store, now, random);
  if (state.dueAt > now) return false;
  const entries = await store.casinoList({ kind: 'jackpot_entries', roundId: state.roundId, after: '' }, accountCapacity);
  if (entries.length !== state.participants) throw new Error('Inconsistent jackpot participants');
  if (entries.length > 0) {
    const winner = entries[random(`jackpot:winner:${state.roundId}`, entries.length)];
    if (winner?.kind !== 'jackpot_entry') throw new Error('Invalid jackpot winner');
    const player = await store.player(winner.vkId);
    if (player === null) throw new Error('Missing jackpot winner');
    await addCasinoCredit(store, `jackpot:${state.roundId}`, player._id, state.amount, 'wallet', jackpotWinnerText(state.amount));
    await store.casinoInsert({ _id: `jackpot-draw:${state.roundId}`, kind: 'jackpot_draw', version: 0, roundId: state.roundId,
      winnerId: player._id, announcement: jackpotAnnouncement(player, state.amount), stage: 'broadcast', afterEntry: '', dueAt: now });
  }
  const dueAt = nextJackpot(now);
  state.dueAt = dueAt;
  state.roundId = dueAt.toISOString();
  state.amount = seed(dueAt, random);
  state.participants = 0;
  await store.casinoSave(state);
  return true;
}
async function broadcastJackpot(store: GameStore, now: Date): Promise<boolean> {
  const draw = (await store.casinoList({ kind: 'jackpot_draw', dueAt: now }, 1))[0];
  if (draw === undefined) return false;
  if (draw.kind !== 'jackpot_draw') throw new Error('Invalid jackpot announcement');
  const entries = await store.casinoList({ kind: 'jackpot_entries', roundId: draw.roundId, after: draw.afterEntry }, privateCasinoConfig.workerBatch);
  for (const entry of entries) {
    if (entry.kind !== 'jackpot_entry') throw new Error('Invalid jackpot recipient');
    if (entry.vkId !== draw.winnerId) await store.enqueueMailing(`jackpot-result:${draw.roundId}:${entry.vkId}`, entry.vkId, draw.announcement);
    draw.afterEntry = entry._id;
  }
  if (entries.length === 0) draw.stage = 'finished';
  await store.casinoSave(draw);
  return true;
}
export async function settleJackpot(database: GameDatabase, random: CasinoRandom = casinoRandom): Promise<number> {
  const stable = cachedCasinoRandom(random);
  let work = 0;
  for (let index = 0; index < privateCasinoConfig.workerBatch; index += 1) {
    try {
      const progressed = await database.transaction(async store => {
        const now = await store.now();
        return await drawJackpot(store, now, stable) || await broadcastJackpot(store, now);
      });
      if (!progressed) break;
      work += 1;
    } catch (error: unknown) {
      if (error instanceof DuplicateWriteError) continue;
      throw error;
    }
  }
  return work;
}
