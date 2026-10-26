import { isPositiveId } from '../utils/validation.js';
import { casinoConfig } from '../config/casino.js';
import type { GameStore } from '../types/storage.js';
import { casinoTexts } from './casino-texts.js';
import { safeBankMoney } from './bank-rules.js';

export async function addCasinoCredit(store: GameStore, key: string, vkId: number, amount: number, destination: 'wallet' | 'dealer' = 'wallet', notice = ''): Promise<void> {
  if (!isPositiveId(vkId) || !safeBankMoney(amount)) throw new Error('Invalid casino credit');
  if (amount === 0) return;
  await store.casinoInsert({ _id: `credit:${key}`, kind: 'credit', version: 0, vkId, amount, destination, notice, stage: 'pending', dueAt: new Date(0) });
}
export async function payCasinoCredit(store: GameStore, now: Date): Promise<boolean> {
  const credit = (await store.casinoList({ kind: 'credit', dueAt: now }, 1))[0];
  if (credit === undefined) return false;
  if (credit.kind !== 'credit' || !safeBankMoney(credit.amount)) throw new Error('Invalid pending casino credit');
  let paid = false;
  if (credit.destination === 'dealer' && (await store.dealer()).holderId === credit.vkId) paid = await store.casinoDealerIncome(credit.vkId, credit.amount);
  else paid = await store.updateBalance(credit.vkId, 'kc', 'add', credit.amount);
  if (paid) {
    credit.stage = 'paid';
    if (credit.notice.length > 0) await store.enqueueItemNotification(`notice:${credit._id}`, credit.vkId, credit.notice, { kind: 'none' });
  } else {
    if (credit.dueAt.getTime() === 0) await store.enqueueItemNotification(`waiting:${credit._id}`, credit.vkId, casinoTexts.creditWaiting, { kind: 'none' });
    credit.dueAt = new Date(now.getTime() + casinoConfig.retryMs);
  }
  await store.casinoSave(credit);
  return true;
}
