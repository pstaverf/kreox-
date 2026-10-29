import { createHash } from 'node:crypto';
import { adminIds } from '../config/admin.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { GiveawayCommand, GiveawayState } from '../types/giveaway.js';
import type { GameStore } from '../types/storage.js';
import { giveawayClaimKey, giveawayKey, validGiveawayCount, validGiveawayPeer, validGiveawayReward, validateGiveaway } from './giveaway-rules.js';
import { giveawayCancelled, giveawayClaimed, giveawayStarted, giveawayTexts } from './giveaway-texts.js';

const reply = (text = ''): Reply => ({ text, keyboard: { kind: 'none' } });
async function currentGiveaway(store: GameStore, peerId: number): Promise<GiveawayState | null> {
  const state = await store.casinoGet(giveawayKey(peerId));
  if (state === null) return null;
  if (state.kind !== 'giveaway') throw new Error('Invalid giveaway record');
  validateGiveaway(state);
  return state;
}
export async function prepareGiveawayClaim(store: GameStore, input: GameInput, command: Extract<GiveawayCommand, { kind: 'giveaway_claim' | 'giveaway_cancel' }>): Promise<Reply | GiveawayState> {
  if (!input.isChat || !validGiveawayPeer(input.peerId)) return reply();
  if (command.peerId !== input.peerId) return reply(giveawayTexts.old);
  const state = await currentGiveaway(store, input.peerId);
  if (state === null || state.token !== command.token) return reply(giveawayTexts.old);
  if (state.stage !== 'active') return reply(giveawayTexts.ended);
  if (command.kind === 'giveaway_claim') {
    const claim = await store.casinoGet(giveawayClaimKey(input.peerId, command.token, input.vkId));
    if (claim !== null) {
      if (claim.kind !== 'giveaway_claim' || claim.vkId !== input.vkId) throw new Error('Invalid giveaway claim record');
      return reply(giveawayTexts.already);
    }
  }
  return state;
}
export async function giveawayAdminAction(store: GameStore, input: GameInput, command: GiveawayCommand): Promise<Reply> {
  if (command.kind === 'giveaway_claim') throw new Error('Giveaway claim requires a player');
  if (!adminIds.has(input.vkId)) throw new Error('Administrator access is required');
  if (!input.isChat || !validGiveawayPeer(input.peerId)) return reply();
  if (command.kind === 'force_invalid') return reply(giveawayTexts.usage);
  if (command.kind === 'giveaway_cancel') {
    const state = await prepareGiveawayClaim(store, input, command);
    if ('text' in state) return state;
    state.stage = 'cancelled';
    await store.casinoSave(state);
    return reply(giveawayCancelled(state));
  }
  if (!validGiveawayCount(command.count) || !validGiveawayReward(command.reward)) return reply(giveawayTexts.usage);
  const previous = await currentGiveaway(store, input.peerId);
  const state: GiveawayState = { _id: giveawayKey(input.peerId), kind: 'giveaway', version: previous?.version ?? 0, peerId: input.peerId,
    token: createHash('sha256').update(input.eventId).digest('hex'), reward: command.reward, count: command.count, remaining: command.count, stage: 'active' };
  if (previous === null) await store.casinoInsert(state);
  else await store.casinoSave(state);
  return { text: giveawayStarted(state), keyboard: { kind: 'giveaway', peerId: input.peerId, token: state.token } };
}
export async function claimGiveaway(store: GameStore, input: GameInput, player: Player, command: Extract<GiveawayCommand, { kind: 'giveaway_claim' | 'giveaway_cancel' }>, prepared?: GiveawayState): Promise<Reply> {
  if (command.kind !== 'giveaway_claim' || input.vkId !== player._id) throw new Error('Invalid giveaway claimant');
  const state = prepared ?? await prepareGiveawayClaim(store, input, command);
  if ('text' in state) return state;
  validateGiveaway(state);
  if (!input.isChat || !validGiveawayPeer(input.peerId)) return reply();
  if (state.peerId !== input.peerId || command.peerId !== input.peerId || state.token !== command.token) return reply(giveawayTexts.old);
  if (state.stage !== 'active') return reply(giveawayTexts.ended);
  const reward = state.reward;
  const paid = reward.kind === 'currency' ? await store.updateBalance(input.vkId, reward.currency, 'add', reward.amount)
    : await store.grantItems(input.vkId, reward.itemKind, reward.quantity);
  if (!paid) return reply(giveawayTexts.limit);
  await store.casinoInsert({ _id: giveawayClaimKey(command.peerId, command.token, input.vkId), kind: 'giveaway_claim', version: 0, vkId: input.vkId });
  state.remaining -= 1;
  if (state.remaining === 0) state.stage = 'finished';
  await store.casinoSave(state);
  return reply(giveawayClaimed(state, player));
}
