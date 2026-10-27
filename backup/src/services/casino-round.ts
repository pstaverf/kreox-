import { casinoConfig } from '../config/casino.js';
import type { CasinoRound } from '../types/casino.js';
import type { GameStore } from '../types/storage.js';
import { closeKey } from './casino-rules.js';
import { roundClosed } from './casino-texts.js';

export async function closeCasinoRound(store: GameStore, round: CasinoRound, now: Date): Promise<void> {
  if (round.stage !== 'open' || round.closesAt > now) throw new Error('Premature casino close');
  await store.enqueueItemNotification(closeKey(round), round.peerId, roundClosed(round.mode), { kind: 'none' });
  round.stage = 'closed';
  round.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
  await store.casinoSave(round);
}
