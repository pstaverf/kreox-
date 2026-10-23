import { game } from '../config/game.js';
import type { AdminBalanceCommand, BalanceOperation } from '../types/admin-balance.js';
import type { GameInput, Reply } from '../types/game.js';
import type { GameStore } from '../types/storage.js';
import { isPositiveId } from '../utils/validation.js';
import { texts } from './texts.js';

export function validBalanceChange(operation: BalanceOperation, amount: number): boolean {
  return (operation === 'set' || operation === 'add') && Number.isSafeInteger(amount) && amount >= 0 && amount <= game.maxAmount;
}

export async function adminBalanceAction(store: GameStore, input: GameInput, command: AdminBalanceCommand): Promise<Reply> {
  const reply = (text: string): Reply => ({ text, keyboard: { kind: 'none' } });
  if (command.kind === 'admin_balance_invalid' || !validBalanceChange(command.operation, command.amount)) {
    return reply(texts.adminBalanceUsage);
  }
  const targetId = command.targetId ?? input.replySenderId ?? input.vkId;
  if (!isPositiveId(targetId)) {
    return reply(texts.adminBalanceTarget);
  }
  if (await store.player(targetId) === null) {
    return reply(texts.adminBalanceMissing);
  }
  const changed = await store.updateKC(targetId, command.operation, command.amount);
  return reply(changed ? texts.adminDone : texts.adminBalanceLimit);
}
