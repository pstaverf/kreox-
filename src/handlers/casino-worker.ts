import { casinoConfig } from '../config/casino.js';
import { settleCasino } from '../services/casino-worker.js';
import type { GameDatabase } from '../types/storage.js';
import { logError } from '../utils/log.js';

export function startCasinoWorker(database: GameDatabase, wakeNotifications: () => void): () => Promise<void> {
  let running: Promise<void> | undefined;
  let stopped = false;
  const tick = (): void => {
    if (running !== undefined || stopped) return;
    running = settleCasino(database).then(work => { if (work > 0) wakeNotifications(); }).catch((error: unknown) => { logError('casino_worker', error); }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, casinoConfig.workerMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
