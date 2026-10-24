import { randomUUID } from 'node:crypto';
import { APIError, type VK } from 'vk-io';
import { game } from '../config/game.js';
import type { NotificationQueue } from '../types/storage.js';
import { logError } from '../utils/log.js';
import { sendReply } from './messages.js';

export function startNotifications(queue: NotificationQueue, vk: VK): () => Promise<void> {
  let running: Promise<void> | undefined;
  let stopped = false;
  const flush = async (): Promise<void> => {
    try {
      for (let count = 0; count < 20 && !stopped; count += 1) {
        const leaseId = randomUUID();
        const notification = await queue.leaseNotification(leaseId);
        if (notification === null) {
          return;
        }
        let state: 'sent' | 'failed' | 'pending' = 'sent';
        let delay = 0;
        try {
          await sendReply(vk, notification.peerId, notification.randomId, {
            text: notification.text, keyboard: notification.keyboard ?? { kind: 'none' }
          });
        } catch (error: unknown) {
          logError('notification_delivery', error, { notificationId: notification._id });
          const permanent = error instanceof APIError && typeof error.code === 'number' && [7, 15, 100, 900, 901, 902, 917, 945, 946].includes(error.code);
          state = permanent ? 'failed' : 'pending';
          delay = Math.min(game.notificationMaxRetryMs,
            game.notificationRetryMs * 2 ** Math.min(notification.attempts - 1, 10));
        }
        await queue.finishNotification(notification._id, leaseId, state, delay);
      }
    } catch (error: unknown) {
      logError('notification_worker', error);
    }
  };
  const tick = (): void => {
    if (running !== undefined || stopped) {
      return;
    }
    running = flush().finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, game.notificationIntervalMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
