import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoMessagePhotos } from '../../src/repositories/mongo-message-photos.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { GameService } from '../../src/services/game.js';
import { roundKey } from '../../src/services/casino-rules.js';
import type { CasinoRecord } from '../../src/types/casino.js';
import type { Notification, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB: photo cache survives repository restart and zero metadata commits atomically in the outbox', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 60_000
}, async () => {
  if (uri === undefined) throw new Error('Test MongoDB URI is missing');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  try {
    await client.connect();
    const photos = new MongoMessagePhotos(db);
    await Promise.all(Array.from({ length: 10 }, () => photos.saveMessagePhoto('123:2000000001:configured-url', 'photo-123_9_key')));
    assert.equal(await new MongoMessagePhotos(db).messagePhoto('123:2000000001:configured-url'), 'photo-123_9_key');
    assert.equal(await photos.messagePhoto('456:2000000001:configured-url'), null);
    assert.equal(await db.collection('message_photos').countDocuments({}), 1);
    const database = new MongoGameDatabase(client, name);
    await database.initialize();
    await database.initialize();
    const service = new GameService(database, undefined, undefined, undefined, undefined, undefined, () => 0);
    await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
    await db.collection<Player>('players').updateOne({ _id: 1 }, { $set: { kc: 1_000_000 } });
    for (let index = 1; index <= 3; index += 1) {
      await service.handle({ eventId: `bet:${index}`, vkId: 1, peerId: 2_000_000_000 + index, isChat: true,
        command: parseCommand('0 1000', undefined, true) }, async () => 'Игрок');
    }
    await db.collection<CasinoRecord>('casino_records').updateOne({ _id: roundKey(2_000_000_003, 'roulette') }, { $set: { stage: 'finished' } });
    const first = await database.transaction(store => store.casinoList({ kind: 'roulette_photo', after: '' }, 1));
    assert.equal(first.length, 1);
    assert.equal(first[0]?._id, roundKey(2_000_000_001, 'roulette'));
    const rest = await database.transaction(store => store.casinoList({ kind: 'roulette_photo', after: first[0]?._id ?? '' }, 2));
    assert.equal(rest.length, 1);
    assert.equal(rest[0]?._id, roundKey(2_000_000_002, 'roulette'));
    assert.equal((await db.collection<Player>('players').findOne({ _id: 1 }))?.kc, 700_000);
    await database.transaction(store => store.enqueueItemNotification('roulette-zero', 2_000_000_001, 'Итоги', { kind: 'none' }, 0));
    const notification = await db.collection<Notification>('notifications').findOne({ _id: 'roulette-zero' });
    assert.equal(notification?.roulettePhoto, 0);
    await assert.rejects(database.transaction(async store => {
      await store.enqueueItemNotification('roulette-rollback', 2_000_000_001, 'Итоги', { kind: 'none' }, 2);
      throw new Error('Abort notification');
    }), /Abort notification/);
    assert.equal(await db.collection<Notification>('notifications').countDocuments({ _id: 'roulette-rollback' }), 0);
  } finally {
    await db.dropDatabase().catch(() => undefined);
    await client.close();
  }
});
