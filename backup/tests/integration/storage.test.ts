import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { storageConfig } from '../../src/config/storage.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { texts } from '../../src/services/texts.js';
import type { Counter, Notification, Player, ProcessedMessage } from '../../src/types/game.js';
import { isRecord } from '../../src/utils/validation.js';

const uri = process.env.MONGODB_TEST_URI;
test('MongoDB replica set: response blocks, rollback/restart, transaction clock, registry cache and capped referrals', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 180_000
}, async () => {
  if (uri === undefined) throw new Error('Test MongoDB URI is missing');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, monitorCommands: true });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  const metrics = { reserves: 0, clock: 0, chats: 0 };
  client.on('commandStarted', event => {
    const command: unknown = event.command;
    if (!isRecord(command) || command.$db !== name) return;
    if (event.commandName === 'findAndModify' && command.findAndModify === 'counters' && isRecord(command.query) && command.query._id === 'responses') {
      metrics.reserves += 1;
      assert.equal(command.autocommit, undefined);
      assert.ok(isRecord(command.writeConcern));
      assert.equal(command.writeConcern.w, 'majority');
    }
    if (event.commandName === 'aggregate' && command.aggregate === 'counters') metrics.clock += 1;
    if (event.commandName === 'update' && command.update === 'casino_records') metrics.chats += 1;
  });
  try {
    await client.connect();
    const first = new MongoGameDatabase(client, name);
    const second = new MongoGameDatabase(client, name);
    await first.initialize();
    const reply = { text: 'Ответ', keyboard: { kind: 'none' } } as const;
    const replies = await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? first : second).transaction(async store => {
      if (index < 4) await store.enqueueItemNotification(`notice:${index}`, 1, 'Награда', { kind: 'none' });
      return store.remember({ eventId: `event:${index}`, vkId: 1, command: { kind: 'profile' } }, reply);
    })));
    assert.equal(metrics.reserves, 2);
    assert.equal((await db.collection<Counter>('counters').findOne({ _id: 'responses' }))?.value, 2 * storageConfig.responseIdBlockSize);
    const notifications = await db.collection<Notification>('notifications').find({}).toArray();
    const ids = [...replies.map(value => value.randomId), ...notifications.map(value => value.randomId)];
    assert.equal(new Set(ids).size, ids.length);
    let rolledId = 0;
    await assert.rejects(first.transaction(async store => {
      rolledId = (await store.remember({ eventId: 'rollback', vkId: 1, command: { kind: 'profile' } }, reply)).randomId;
      await store.enqueueItemNotification('rollback-notice', 1, 'Не отправлять', { kind: 'none' });
      throw new Error('Rollback');
    }), /Rollback/);
    assert.equal(await db.collection<ProcessedMessage>('processed_messages').findOne({ _id: 'rollback' }), null);
    assert.equal(await db.collection<Notification>('notifications').findOne({ _id: 'rollback-notice' }), null);
    const restarted = new MongoGameDatabase(client, name);
    const fresh = await restarted.transaction(store => store.remember({ eventId: 'restart', vkId: 1, command: { kind: 'profile' } }, reply));
    assert.ok(fresh.randomId > 2 * storageConfig.responseIdBlockSize);
    assert.notEqual(fresh.randomId, rolledId);
    assert.equal((await restarted.transaction(store => store.processed('event:0')))?.reply.randomId, replies[0]?.randomId);
    metrics.clock = 0;
    await first.transaction(async store => {
      const a = await store.now();
      a.setTime(0);
      assert.ok((await store.now()).getTime() > 0);
      assert.equal(metrics.clock, 1);
    });
    await first.transaction(store => store.now());
    assert.equal(metrics.clock, 2);
    metrics.chats = 0;
    await Promise.all(Array.from({ length: 40 }, () => first.recordChat(2_000_000_001)));
    assert.equal(metrics.chats, 1);
    await first.recordChat(2_000_000_001, false);
    await first.recordChat(2_000_000_001, false);
    assert.equal(metrics.chats, 2);
    await first.recordChat(2_000_000_001);
    assert.equal(metrics.chats, 3);
    const service = new GameService(first);
    await service.handle({ eventId: 'register-inviter', vkId: 1, command: { kind: 'profile' } }, async () => 'Пригласивший');
    for (const [index, field] of (['kc', 'nextItemId', 'referrals'] as const).entries()) {
      const players = db.collection<Player>('players');
      await players.updateOne({ _id: 1 }, { $set: { kc: 0, nextItemId: 1, referrals: 0, [field]: game.maxAmount } });
      const before = await players.findOne({ _id: 1 });
      const input = { eventId: `limited-referral:${field}`, vkId: 100 + index, referrerId: 1, command: { kind: 'profile' } } as const;
      const response = await service.handle(input, async () => 'Новичок');
      assert.equal(response.text, texts.welcome);
      assert.ok(await players.findOne({ _id: input.vkId }));
      assert.deepEqual(await players.findOne({ _id: 1 }), before);
      assert.equal(await db.collection<Notification>('notifications').findOne({ _id: `referral:${input.vkId}` }), null);
      assert.equal((await service.handle(input, async () => 'Новичок')).randomId, response.randomId);
    }
    await db.collection<Counter>('counters').updateOne({ _id: 'responses' }, { $set: { value: game.maxRandomId - 2 } });
    const final = new MongoGameDatabase(client, name);
    for (let index = 0; index < 2; index += 1) {
      const result = await final.transaction(store => store.remember({ eventId: `final:${index}`, vkId: 1, command: { kind: 'profile' } }, reply));
      assert.equal(result.randomId, game.maxRandomId - 1 + index);
    }
    await assert.rejects(final.transaction(store => store.remember({ eventId: 'exhausted', vkId: 1, command: { kind: 'profile' } }, reply)), /range is exhausted/);
    assert.equal(await db.collection<ProcessedMessage>('processed_messages').findOne({ _id: 'exhausted' }), null);
    assert.equal((await db.collection<Counter>('counters').findOne({ _id: 'responses' }))?.value, game.maxRandomId);
  } finally {
    await db.dropDatabase().catch(() => undefined);
    await client.close();
  }
});
