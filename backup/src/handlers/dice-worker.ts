import { diceConfig } from '../config/dice.js';
import { settleDice } from '../services/dice.js';
import type { GameDatabase } from '../types/storage.js';
import { logError } from '../utils/log.js';

export function startDiceWorker(database: GameDatabase, wakeNotifications: () => void): () => Promise<void> {
  let running: Promise<void> | undefined;
  let stopped = false;
  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = settleDice(database).then(work => { if (work > 0) wakeNotifications(); })
      .catch((error: unknown) => { logError('dice_worker', error); }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, diceConfig.workerMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
