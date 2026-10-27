import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { storageConfig } from '../../src/config/storage.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { migrateWholeKc, playerKcFields } from '../../src/repositories/mongo-kc-migration.js';
import { payCasinoCredit } from '../../src/services/casino-credits.js';
import { GameService } from '../../src/services/game.js';
import type { CasinoCredit, DirectorState } from '../../src/types/casino.js';
import type { DealerState } from '../../src/types/donate.js';
import type { Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: whole-KC migration pages, preserves unrelated data, restarts idempotently and pays legacy credits once', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 120_000
}, async () => {
  if (uri === undefined) throw new Error('Test MongoDB URI is missing');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  try {
    await client.connect();
    const database = new MongoGameDatabase(client, name);
    await database.initialize();
    const service = new GameService(database);
    await service.handle({ eventId: 'whole-register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
    const players = db.collection<Player>('players');
    const seed = await players.findOne({ _id: 1 });
    assert.ok(seed);
    delete seed.savingsBalance;
    delete seed.savingsSince;
    delete seed.stolenKC;
    const since = new Date('2026-10-01T00:00:00Z');
    const variants = [180_394_712, 53_750, 54_740, 0, game.maxAmount];
    const originals = Array.from({ length: storageConfig.kcMigrationPageSize + 1 }, (_, index): Player => {
      const amount = variants[index % variants.length];
      if (amount === undefined) throw new Error('Missing migration fixture');
      return { ...seed, _id: index + 1, accountId: index, kc: amount, euro: 12_345, bitcoin: 123_456_789,
        ...(index % 2 === 0 ? { savingsBalance: 53_750, savingsSince: since, stolenKC: 54_740 } : {}) };
    });
    await players.deleteMany({});
    await players.insertMany(originals);
    await db.collection<DealerState>('dealer').updateOne({ _id: 'casino' }, { $set: { earnedKC: 53_750 } });
    const director: DirectorState = { _id: 'director', kind: 'director', version: 4, holderId: 1, earnedKC: 54_740, electionId: 'old-election', dueAt: since, total: 12_345, participants: 2 };
    await db.collection<DirectorState>('casino_records').insertOne(director);
    await migrateWholeKc(db);
    const migrated = await players.find({}).sort({ _id: 1 }).toArray();
    assert.deepEqual(migrated, originals.map(player => ({ ...player, ...playerKcFields(player) })));
    assert.equal((await db.collection<DealerState>('dealer').findOne({ _id: 'casino' }))?.earnedKC, 53_800);
    const changedDirector = await db.collection<DirectorState>('casino_records').findOne({ _id: 'director' });
    assert.deepEqual(changedDirector, { ...director, earnedKC: 54_700, version: 5 });
    await migrateWholeKc(db);
    assert.deepEqual(await players.find({}).sort({ _id: 1 }).toArray(), migrated);
    assert.deepEqual(await db.collection<DirectorState>('casino_records').findOne({ _id: 'director' }), changedDirector);
    const credits = db.collection<CasinoCredit>('casino_records');
    await credits.insertOne({ _id: 'credit:old-half', kind: 'credit', version: 0, vkId: 1, amount: 53_750, destination: 'wallet', notice: 'Возвращено: 537.5 KC', stage: 'pending', dueAt: new Date(0) });
    const before = await players.findOne({ _id: 1 });
    assert.ok(before);
    await assert.rejects(database.transaction(async store => {
      assert.equal(await payCasinoCredit(store, await store.now()), true);
      throw new Error('Rollback rounded legacy credit');
    }), /Rollback rounded legacy credit/);
    assert.deepEqual(await players.findOne({ _id: 1 }), before);
    const results = await Promise.all(Array.from({ length: 8 }, () => database.transaction(async store => payCasinoCredit(store, await store.now()))));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, before.kc + 53_800);
    assert.equal((await credits.findOne({ _id: 'credit:old-half' }))?.amount, 53_800);
    await database.initialize();
    assert.equal(await database.transaction(async store => payCasinoCredit(store, await store.now())), false);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, before.kc + 53_800);
  } finally {
    try { await db.dropDatabase(); } finally { await client.close(); }
  }
});
