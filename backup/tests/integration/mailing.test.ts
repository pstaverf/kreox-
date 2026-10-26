import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { mailingConfig } from '../../src/config/mailing.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { queueMailingBatch } from '../../src/services/mailing.js';
import type { Notification, ProcessedMessage } from '../../src/types/game.js';
import type { MailingCampaign, MailingRecipient } from '../../src/types/mailing.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: private history migration, mailing races, atomic page rollback and priority delivery', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 120_000
}, async () => {
  if (uri === undefined) throw new Error('Test MongoDB URI is missing');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  try {
    await client.connect();
    const old = db.collection<ProcessedMessage>('processed_messages');
    const reply = { text: 'Привет', randomId: 1, keyboard: { kind: 'none' } } satisfies ProcessedMessage['reply'];
    await old.insertMany(Array.from({ length: mailingConfig.migrationPageSize + 5 }, (_, index) => ({
      _id: `123:1:${index + 1}`, vkId: 1, reply
    })));
    await old.insertOne({ _id: '123:2000000001:1', vkId: 2, reply });
    const database = new MongoGameDatabase(client, name);
    await database.initialize();
    await database.initialize();
    const audience = db.collection<MailingRecipient>('mailing_recipients');
    assert.deepEqual((await audience.find({}).toArray()).map(recipient => recipient._id), [1]);
    const service = new GameService(database);
    await service.handle({ eventId: '123:2:2', vkId: 2, peerId: 2, command: { kind: 'profile' } }, async () => 'Игрок');
    assert.equal(await audience.countDocuments({}), 2);
    const input = { eventId: 'campaign', vkId: 888801846, isChat: true, command: parseCommand('/mailing Новости\nТекст', undefined, true) };
    const responses = await Promise.all(Array.from({ length: 8 }, () => service.handle(input, async () => 'Игрок')));
    assert.ok(responses.every(response => response.randomId === responses[0]?.randomId));
    const campaigns = db.collection<MailingCampaign>('mailing_campaigns');
    assert.equal(await campaigns.countDocuments({}), 1);
    const campaign = await campaigns.findOne({ _id: 'mailing:campaign' });
    assert.ok(campaign);
    await assert.rejects(database.transaction(async store => {
      const current = await store.pendingMailing();
      assert.ok(current);
      await store.enqueueMailing(`${current._id}:1`, 1, current.text);
      current.afterVkId = 1;
      await store.saveMailing(current);
      throw new Error('Rollback page');
    }), /Rollback page/);
    const notifications = db.collection<Notification>('notifications');
    assert.equal(await notifications.countDocuments({}), 0);
    assert.equal((await campaigns.findOne({ _id: campaign._id }))?.afterVkId, 0);
    await Promise.allSettled(Array.from({ length: 4 }, () => queueMailingBatch(database)));
    await queueMailingBatch(database);
    assert.equal(await notifications.countDocuments({}), 2);
    assert.equal((await campaigns.findOne({ _id: campaign._id }))?.state, 'queued');
    assert.equal((await new GameService(new MongoGameDatabase(client, name)).handle(input, async () => 'Игрок')).randomId, responses[0]?.randomId);
    await database.transaction(store => store.enqueueItemNotification('urgent-game-result', 2_000_000_001, 'Итоги', { kind: 'none' }));
    const first = await database.leaseNotification('urgent');
    assert.equal(first?._id, 'urgent-game-result');
    await database.finishNotification('urgent-game-result', 'urgent', 'sent', 0);
    const mailing = await database.leaseNotification('mailing');
    assert.ok(mailing);
    assert.ok(mailing._id.startsWith('mailing:campaign:'));
    await notifications.updateMany({ _id: { $ne: mailing._id }, priority: 1 }, { $set: { state: 'sent' } });
    assert.equal(mailing.priority, 1);
    await database.finishNotification(mailing._id, 'mailing', 'pending', 0);
    const retry = await database.leaseNotification('retry');
    assert.equal(retry?.randomId, mailing.randomId);
  } finally {
    await db.dropDatabase().catch(() => undefined);
    await client.close();
  }
});
