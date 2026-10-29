import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { accountCapacity, game } from '../../src/config/game.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { rewardForDay } from '../../src/services/rules.js';
import { texts } from '../../src/services/texts.js';
import type { Counter, InventoryItem, Player, ProcessedMessage } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: atomicity, concurrency, IDs and persistent deduplication', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 120_000
}, async context => {
  if (uri === undefined) {
    throw new Error('Test MongoDB URI is missing');
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const databaseName = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(databaseName);
  try {
    await client.connect();
    const database = new MongoGameDatabase(client, databaseName);
    await Promise.all([database.initialize(), database.initialize()]);
    const service = new GameService(database);
    await context.test('simultaneous repeated registration gives one account', async () => {
      const input = { eventId: 'register-1', vkId: 1, command: { kind: 'profile' } } as const;
      const replies = await Promise.all(Array.from({ length: 6 }, () => service.handle(input, async () => 'Игрок')));
      assert.ok(replies.every(reply => reply.text === texts.welcome));
      assert.equal(await db.collection<Player>('players').countDocuments({ _id: 1 }), 1);
      assert.equal((await db.collection<Player>('players').findOne({ _id: 1 }))?.accountId, 0);
      assert.equal((await db.collection<Counter>('counters').findOne({ _id: 'registrations' }))?.value, 1);
    });
    await context.test('first 50 IDs are sequential; later IDs are random, unique and in range', async () => {
      for (let start = 2; start <= 60; start += 10) {
        const ids = Array.from({ length: Math.min(10, 61 - start) }, (_, index) => start + index);
        await Promise.all(ids.map(vkId => service.handle({
          eventId: `register-${vkId}`, vkId, command: { kind: 'profile' }
        }, async () => 'Игрок')));
      }
      const players = await db.collection<Player>('players').find({}).limit(100).toArray();
      assert.equal(players.length, 60);
      assert.equal(new Set(players.map(player => player.accountId)).size, 60);
      assert.deepEqual(players.filter(player => player.accountId < 50).map(player => player.accountId).sort((a, b) => a - b),
        Array.from({ length: 50 }, (_, index) => index));
      assert.ok(players.filter(player => player.accountId >= 50)
        .every(player => player.accountId >= game.randomAccountMin && player.accountId <= game.randomAccountMax));
    });
    await context.test('simultaneous bonus messages award only once', async () => {
      const inputs = Array.from({ length: 12 }, (_, index) => ({
        eventId: `bonus-${index}`, vkId: 1, command: { kind: 'bonus' }
      } as const));
      const replies = await Promise.all(inputs.map(input => service.handle(input, async () => 'Игрок')));
      assert.equal(replies.filter(reply => reply.text.startsWith('🎁')).length, 1);
      const player = await db.collection<Player>('players').findOne({ _id: 1 });
      assert.equal(player?.kc, 250_000);
      assert.equal(player.bitcoin, 150_000_000);
      const index = replies.findIndex(reply => reply.text.startsWith('🎁'));
      const original = inputs[index];
      assert.ok(original);
      const result = await db.collection<Player>('players').updateOne({ _id: 1 }, { $set: { nextBonusAt: new Date(0) } });
      assert.equal(result.matchedCount, 1);
      assert.deepEqual(await new GameService(database).handle(original, async () => 'Игрок'), replies[index]);
      assert.equal((await db.collection<Player>('players').findOne({ _id: 1 }))?.kc, 250_000);
    });
    await context.test('seventh bonus inserts a case exactly once', async () => {
      const now = await database.transaction(store => store.now());
      const result = await db.collection<Player>('players').updateOne({ _id: 1 }, {
        $set: { bonusDay: 6, lastBonusAt: new Date(now.getTime() - game.bonusIntervalMs), nextBonusAt: new Date(0) }
      });
      assert.equal(result.matchedCount, 1);
      const input = { eventId: 'seventh', vkId: 1, command: { kind: 'bonus' } } as const;
      await Promise.all(Array.from({ length: 6 }, () => service.handle(input, async () => 'Игрок')));
      assert.equal(await db.collection<InventoryItem>('inventory').countDocuments({ vkId: 1 }), 1);
      const item = await db.collection<InventoryItem>('inventory').findOne({ vkId: 1, itemId: 1 });
      assert.equal(item?.kind, 'zhdun_case');
      assert.equal((await db.collection<Player>('players').findOne({ _id: 1 }))?.kc, 10_250_000);
    });
    await context.test('failure after writes rolls back reward, case and processed event', async () => {
      const before = await db.collection<Player>('players').findOne({ _id: 1 });
      assert.ok(before);
      const reset = await db.collection<Player>('players').updateOne({ _id: 1 }, { $set: { nextBonusAt: new Date(0) } });
      assert.equal(reset.matchedCount, 1);
      await assert.rejects(database.transaction(async store => {
        const player = await store.player(1);
        assert.ok(player);
        assert.equal(await store.claim(player, 7, rewardForDay(7), await store.now()), true);
        await store.remember({ eventId: 'rolled-back', vkId: 1, command: { kind: 'bonus' } },
          { text: 'not committed', keyboard: { kind: 'main' } });
        throw new Error('Simulated failure after all writes');
      }));
      const after = await db.collection<Player>('players').findOne({ _id: 1 });
      assert.equal(after?.kc, before.kc);
      assert.equal(after.nextItemId, before.nextItemId);
      assert.equal(await db.collection<InventoryItem>('inventory').countDocuments({ vkId: 1 }), 1);
      assert.equal(await db.collection<ProcessedMessage>('processed_messages').countDocuments({ _id: 'rolled-back' }), 0);
    });
    await context.test('balance limit refuses the entire bonus', async () => {
      const update = await db.collection<Player>('players').updateOne({ _id: 2 }, { $set: { bitcoin: game.maxAmount } });
      assert.equal(update.matchedCount, 1);
      const reply = await service.handle({ eventId: 'overflow', vkId: 2, command: { kind: 'bonus' } }, async () => 'Игрок');
      assert.equal(reply.text, texts.balanceLimit);
      const player = await db.collection<Player>('players').findOne({ _id: 2 });
      assert.equal(player?.kc, 0);
      assert.equal(player.bonusDay, 0);
      assert.equal(player.bitcoin, game.maxAmount);
    });
    await context.test('exhaustion never reuses an account ID or inserts a partial player', async () => {
      const update = await db.collection<Counter>('counters').updateOne({ _id: 'registrations' }, { $set: { value: accountCapacity } });
      assert.equal(update.matchedCount, 1);
      const reply = await service.handle({ eventId: 'full', vkId: 100, command: { kind: 'profile' } }, async () => 'Игрок');
      assert.equal(reply.text, texts.registrationLimit);
      assert.equal(await db.collection<Player>('players').findOne({ _id: 100 }), null);
    });
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  }
});
