import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoMessagePhotos } from '../../src/repositories/mongo-message-photos.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import type { Notification } from '../../src/types/game.js';

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
