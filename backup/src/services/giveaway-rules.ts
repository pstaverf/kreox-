import { game } from '../config/game.js';
import type { Command } from '../types/game.js';
import type { GiveawayCommand, GiveawayReward, GiveawayState } from '../types/giveaway.js';
import { isBalanceCurrency } from './admin-balance.js';
import { isItemKind, validItemQuantity } from './item-rules.js';

export function isGiveawayCommand(command: Command): command is GiveawayCommand {
  return command.kind === 'force_invalid' || command.kind === 'force_giveaway' || command.kind === 'giveaway_claim' || command.kind === 'giveaway_cancel';
}
export function isGiveawayAdminCommand(command: Command): boolean {
  return command.kind === 'force_invalid' || command.kind === 'force_giveaway' || command.kind === 'giveaway_cancel';
}
export function giveawayKey(peerId: number): string { return `giveaway:${peerId}`; }
export function giveawayClaimKey(peerId: number, token: string, vkId: number): string { return `giveaway-claim:${peerId}:${token}:${vkId}`; }
export function validGiveawayCount(value: number): boolean { return Number.isSafeInteger(value) && value >= 1 && value <= game.maxAmount; }
export function validGiveawayReward(reward: GiveawayReward): boolean {
  return reward.kind === 'currency' ? isBalanceCurrency(reward.currency) && validGiveawayCount(reward.amount)
    : reward.kind === 'item' && isItemKind(reward.itemKind) && validItemQuantity(reward.quantity);
}
export function validGiveawayPeer(value: number | undefined): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 2_000_000_000; }
export function validGiveawayToken(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
export function validateGiveaway(state: GiveawayState): void {
  if (!validGiveawayPeer(state.peerId) || state._id !== giveawayKey(state.peerId) || !validGiveawayToken(state.token)
    || !validGiveawayCount(state.count) || !Number.isSafeInteger(state.remaining) || state.remaining < 0 || state.remaining > state.count
    || !validGiveawayReward(state.reward) || (state.stage === 'active' && state.remaining === 0)
    || (state.stage === 'finished' && state.remaining !== 0)
    || (state.stage !== 'active' && state.stage !== 'finished' && state.stage !== 'cancelled')) throw new Error('Invalid giveaway state');
}
