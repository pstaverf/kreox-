import { rouletteConfig } from '../config/roulette.js';
import type { RoulettePhotoResolver } from '../types/message-photos.js';
import type { GameDatabase } from '../types/storage.js';
import { logError } from '../utils/log.js';

export function startRoulettePhotoWorker(database: GameDatabase, resolvePhoto: RoulettePhotoResolver): (() => Promise<void>) & { wake: () => void } {
  const pending = new Map<string, Promise<void>>();
  let after = '';
  let stopped = false;
  let scanning: Promise<void> | undefined;
  const scan = async (): Promise<void> => {
    const capacity = rouletteConfig.photoPrefetchConcurrency - pending.size;
    if (capacity === 0) return;
    const rounds = await database.transaction(store => store.casinoList({ kind: 'roulette_photo', after }, capacity));
    if (stopped) return;
    if (rounds.length === 0) { after = ''; return; }
    for (const round of rounds) {
      if (round.kind !== 'round' || round.mode !== 'roulette') throw new Error('Invalid photo preparation round');
      after = round._id;
      if (pending.has(round.roundId)) continue;
      const task = resolvePhoto(round.peerId, round.result).then(() => undefined)
        .catch((error: unknown) => { logError('roulette_photo_prefetch', error); })
        .finally(() => { pending.delete(round.roundId); });
      pending.set(round.roundId, task);
    }
  };
  const tick = (): void => {
    if (stopped || scanning !== undefined) return;
    scanning = scan().catch((error: unknown) => { logError('roulette_photo_worker', error); }).finally(() => { scanning = undefined; });
  };
  const timer = setInterval(tick, rouletteConfig.photoPrefetchIntervalMs);
  timer.unref();
  tick();
  return Object.assign(async () => {
    stopped = true;
    clearInterval(timer);
    await scanning;
    await Promise.all(pending.values());
  }, { wake: tick });
}
