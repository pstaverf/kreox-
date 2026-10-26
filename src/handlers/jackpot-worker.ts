import { privateCasinoConfig } from '../config/private-casino.js';
import { settleJackpot } from '../services/jackpot.js';
import type { GameDatabase } from '../types/storage.js';
import { logError } from '../utils/log.js';

export function startJackpotWorker(database: GameDatabase, wakeNotifications: () => void): () => Promise<void> {
  let running: Promise<void> | undefined;
  let stopped = false;
  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = settleJackpot(database).then(work => { if (work > 0) wakeNotifications(); })
      .catch((error: unknown) => { logError('jackpot_worker', error); }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, privateCasinoConfig.workerMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
