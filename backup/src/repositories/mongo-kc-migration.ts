import type { Db, Filter } from 'mongodb';
import { game } from '../config/game.js';
import { storageConfig } from '../config/storage.js';
import { roundKc } from '../services/kc-money.js';
import type { DirectorState } from '../types/casino.js';
import type { DealerState } from '../types/donate.js';
import type { Player } from '../types/game.js';

export function playerKcFields(player: Pick<Player, 'kc' | 'savingsBalance' | 'stolenKC'>): Pick<Player, 'kc' | 'savingsBalance' | 'stolenKC'> {
  return { kc: roundKc(player.kc),
    ...(player.savingsBalance === undefined ? {} : { savingsBalance: roundKc(player.savingsBalance) }),
    ...(player.stolenKC === undefined ? {} : { stolenKC: roundKc(player.stolenKC) }) };
}

export function playerKcFilter(player: Pick<Player, '_id' | 'kc' | 'savingsBalance' | 'stolenKC'>): Filter<Player> {
  return { _id: player._id, kc: player.kc, savingsBalance: player.savingsBalance ?? { $exists: false }, stolenKC: player.stolenKC ?? { $exists: false } };
}

export async function migrateWholeKc(db: Db): Promise<void> {
  const players = db.collection<Player>('players');
  let after = 0;
  let retries = 0;
  for (;;) {
    const page = await players.find({ _id: { $gt: after } }, { projection: { _id: 1, kc: 1, savingsBalance: 1, stolenKC: 1 } })
      .sort({ _id: 1 }).limit(storageConfig.kcMigrationPageSize).toArray();
    const last = page.at(-1);
    if (last === undefined) break;
    if (!Number.isSafeInteger(last._id) || last._id <= after) throw new Error('Invalid KC migration cursor');
    const changes = page.flatMap(player => {
      const rounded = playerKcFields(player);
      if (rounded.kc === player.kc && rounded.savingsBalance === player.savingsBalance && rounded.stolenKC === player.stolenKC) return [];
      return [{ updateOne: {
        filter: playerKcFilter(player),
        update: { $set: rounded }
      } }];
    });
    if (changes.length > 0) {
      const result = await players.bulkWrite(changes, { ordered: false, writeConcern: { w: 'majority' } });
      if (result.matchedCount !== changes.length) {
        retries += 1;
        if (retries >= game.duplicateRetries) throw new Error('Concurrent legacy KC writes; stop old bot instances before upgrading');
        continue;
      }
    }
    after = last._id;
    retries = 0;
  }
  const dealers = db.collection<DealerState>('dealer');
  for (let attempt = 0; attempt < game.duplicateRetries; attempt += 1) {
    const state = await dealers.findOne({ _id: 'casino' });
    if (state === null) throw new Error('Missing dealer for KC migration');
    const amount = roundKc(state.earnedKC);
    if (amount === state.earnedKC) break;
    const result = await dealers.updateOne({ _id: 'casino', earnedKC: state.earnedKC }, { $set: { earnedKC: amount } }, { writeConcern: { w: 'majority' } });
    if (result.matchedCount === 1) break;
    if (attempt + 1 === game.duplicateRetries) throw new Error('Concurrent dealer KC migration');
  }
  const directors = db.collection<DirectorState>('casino_records');
  for (let attempt = 0; attempt < game.duplicateRetries; attempt += 1) {
    const state = await directors.findOne({ _id: 'director', kind: 'director' });
    if (state === null) break;
    const amount = roundKc(state.earnedKC);
    if (amount === state.earnedKC) break;
    if (!Number.isSafeInteger(state.version) || state.version < 0 || state.version >= game.maxAmount) throw new Error('Invalid director KC migration version');
    const result = await directors.updateOne({ _id: state._id, kind: 'director', version: state.version, earnedKC: state.earnedKC },
      { $set: { earnedKC: amount }, $inc: { version: 1 } }, { writeConcern: { w: 'majority' } });
    if (result.matchedCount === 1) break;
    if (attempt + 1 === game.duplicateRetries) throw new Error('Concurrent director KC migration');
  }
}
