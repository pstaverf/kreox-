import { bankConfig } from '../config/bank.js';
import type { Deposit } from '../types/bank.js';
import type { GameDatabase, GameStore } from '../types/storage.js';
import { depositValue } from './bank-rules.js';
import { depositEndText } from './bank-texts.js';

export async function finishDeposit(store: GameStore, deposit: Deposit, now: Date): Promise<boolean> {
  if (deposit.expiresAt > now) return false;
  const player = await store.player(deposit.vkId);
  if (player === null) { await store.deferDeposit(deposit, now); return false; }
  const payout = depositValue(deposit, deposit.expiresAt);
  if (!await store.closeDeposit(player, deposit, payout, now, false)) {
    await store.deferDeposit(deposit, now);
    return false;
  }
  await store.enqueueItemNotification(`deposit:${deposit._id}`, player._id, depositEndText(deposit, payout), { kind: 'none' });
  return true;
}
export async function settleBankDeposits(database: GameDatabase): Promise<number> {
  let completed = 0;
  for (let index = 0; index < bankConfig.workerBatch; index += 1) {
    const result = await database.transaction(async store => {
      const now = await store.now();
      const deposit = await store.nextDueDeposit(now);
      if (deposit === null) return 'empty';
      return await finishDeposit(store, deposit, now) ? 'completed' : 'deferred';
    });
    if (result === 'empty') break;
    if (result === 'completed') completed += 1;
  }
  return completed;
}
