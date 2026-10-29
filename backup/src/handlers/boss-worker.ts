import { bossConfig } from '../config/boss.js';
import { broadcastBoss } from '../services/boss-broadcast.js';
import type { GameDatabase } from '../types/storage.js';
import { logError } from '../utils/log.js';
export function startBossWorker(database: GameDatabase, wakeNotifications: () => void): () => Promise<void> {
  let running: Promise<void> | undefined;
  let stopped = false;
  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = broadcastBoss(database).then(count => { if (count > 0) wakeNotifications(); }).catch((error: unknown) => { logError('boss_worker', error); }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, bossConfig.workerMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
