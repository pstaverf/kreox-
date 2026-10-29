import { mailingConfig } from '../config/mailing.js';
import { queueMailingBatch } from '../services/mailing.js';
import type { GameDatabase } from '../types/storage.js';
import { logError } from '../utils/log.js';

export function startMailingWorker(database: GameDatabase, wakeNotifications: () => void): () => Promise<void> {
  let running: Promise<void> | undefined;
  let stopped = false;
  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = queueMailingBatch(database).then(count => { if (count > 0) wakeNotifications(); })
      .catch((error: unknown) => { logError('mailing_worker', error); }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, mailingConfig.intervalMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; };
}
