import { doublePhotos } from '../config/double.js';
import { rouletteConfig } from '../config/roulette.js';
import type { MessagePhotoResolver, RoulettePhotoResolver } from '../types/message-photos.js';
import type { GameDatabase } from '../types/storage.js';
import { logError } from '../utils/log.js';

export function startRoulettePhotoWorker(database: GameDatabase, resolvePhoto: RoulettePhotoResolver, resolveMessagePhoto?: MessagePhotoResolver): (() => Promise<void>) & { wake: () => void } {
  const pending = new Map<string, Promise<void>>();
  let after = '';
  let stopped = false;
  let scanning: Promise<void> | undefined;
  const scan = async (): Promise<void> => {
    const capacity = rouletteConfig.photoPrefetchConcurrency - pending.size;
    if (capacity === 0) return;
    const rounds = await database.transaction(store => store.casinoList({ kind: resolveMessagePhoto === undefined ? 'roulette_photo' : 'casino_photo', after }, capacity));
    if (stopped) return;
    if (rounds.length === 0) { after = ''; return; }
    for (const round of rounds) {
      if (round.kind !== 'round' || (round.mode !== 'roulette' && round.mode !== 'double')) throw new Error('Invalid photo preparation round');
      after = round._id;
      if (pending.has(round.roundId)) continue;
      const url = doublePhotos[round.result];
      const work = round.mode === 'roulette' ? resolvePhoto(round.peerId, round.result) : resolveMessagePhoto !== undefined && url !== undefined ? resolveMessagePhoto(round.peerId, url) : Promise.resolve(null);
      const task = work.then(() => undefined)
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
