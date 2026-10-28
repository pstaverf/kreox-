import { bossConfig } from '../config/boss.js';
import { DuplicateWriteError, type GameDatabase } from '../types/storage.js';
import { bossAnnouncement } from './boss-texts.js';
export async function broadcastBoss(database: GameDatabase): Promise<number> {
  try {
    return await database.transaction(async store => {
      const now = await store.now();
      const job = (await store.casinoList({ kind: 'boss_broadcast', dueAt: now }, 1))[0];
      if (job === undefined) return 0;
      if (job.kind !== 'boss_broadcast') throw new Error('Invalid boss broadcast');
      const run = await store.casinoGet(job.runId);
      if (run?.kind !== 'boss_run') throw new Error('Missing broadcast boss');
      const subscribers = run.health === 0 ? [] : await store.casinoList({ kind: 'boss_subscribers', after: job.after, before: run.createdAt }, bossConfig.broadcastBatch);
      for (const subscriber of subscribers) {
        if (subscriber.kind !== 'boss_player') throw new Error('Invalid boss subscriber');
        await store.enqueueItemNotification(`boss-summon:${run._id}:${subscriber.vkId}`, subscriber.vkId, bossAnnouncement(run), { kind: 'boss_notice' }, undefined, { bossSummon: run._id });
        job.after = subscriber.vkId;
      }
      if (subscribers.length < bossConfig.broadcastBatch) job.stage = 'finished';
      job.dueAt = now;
      await store.casinoSave(job);
      return subscribers.length;
    });
  } catch (error: unknown) {
    if (!(error instanceof DuplicateWriteError)) throw error;
    return 0;
  }
}
