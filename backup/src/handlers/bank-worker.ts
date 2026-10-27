import { bankConfig } from '../config/bank.js';
import { settleBankDeposits } from '../services/bank-deposits.js';
import type { GameDatabase } from '../types/storage.js';
import { logError } from '../utils/log.js';

export function startBankWorker(database: GameDatabase, wakeNotifications?: () => void): () => Promise<void> {
  let running: Promise<void> | undefined;
  let stopped = false;
  const tick = (): void => {
    if (running !== undefined || stopped) return;
    running = settleBankDeposits(database).then(work => { if (work > 0) wakeNotifications?.(); }).catch((error: unknown) => { logError('bank_deposits', error); }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, bankConfig.workerIntervalMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
