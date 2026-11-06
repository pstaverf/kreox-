import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { taskConfig } from '../../src/config/tasks.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { moscowTaskDay, newDailyTasks, progressDailyTask } from '../../src/services/tasks.js';
import type { InventoryItem, Notification, Player } from '../../src/types/game.js';
import type { DailyTasks } from '../../src/types/tasks.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: ASIC, reputation cooldown, task progress and one atomic daily payout', {
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
    await database.initialize();
    const service = new GameService(database, undefined, undefined, undefined, undefined, undefined, () => 0);
    for (const id of [1, 2]) await service.handle({ eventId: `registration-${id}`, vkId: id, command: { kind: 'profile' } }, async () => `Игрок ${id}`);
    const players = db.collection<Player>('players');
    const records = db.collection<DailyTasks>('daily_tasks');
    await players.updateOne({ _id: 1 }, { $set: { completedTasks: 4 } });
    const now = await database.transaction(store => store.now());
    const daily: DailyTasks = { ...newDailyTasks(1, moscowTaskDay(now), () => 0), tasks: [
      { kind: 'bonus', progress: 3, goal: 4 }, { kind: 'deposit', progress: 1, goal: 1 },
      { kind: 'director_bid', progress: 1, goal: 1 }, { kind: 'item_gift', progress: 1, goal: 1 },
      { kind: 'item_sale', progress: 1, goal: 1 }
    ] };
    await database.transaction(store => store.createDailyTasks(daily));
    await assert.rejects(database.transaction(async store => {
      await progressDailyTask(store, 1, 'bonus', now);
      throw new Error('Simulated transaction failure');
    }));
    assert.equal((await records.findOne({ _id: daily._id }))?.tasks[0]?.progress, 3);
    assert.equal((await players.findOne({ _id: 1 }))?.taskSetsCompleted, undefined);

    const bonus = { eventId: 'same-bonus', vkId: 1, command: { kind: 'bonus' } } as const;
    const first = await service.handle(bonus, async () => 'Игрок');
    assert.deepEqual(await service.handle(bonus, async () => 'Игрок'), first);
    const winner = await players.findOne({ _id: 1 });
    assert.ok(winner);
    assert.equal(winner.kc, game.rewards[0].kc + taskConfig.rewardKC);
    assert.equal(winner.bitcoin, game.rewards[0].bitcoin + taskConfig.rewardBitcoin);
    assert.equal(winner.completedTasks, 5);
    assert.equal(winner.assignedTasks, 5);
    assert.equal(winner.taskSetsCompleted, 1);
    assert.equal((await records.findOne({ _id: daily._id }))?.rewarded, true);
    const profile = await service.handle({ eventId: 'xp-profile', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
    assert.match(profile.text, /💫 Уровень: 1 \(1\/4 опыта\)/u);

    assert.equal(await database.transaction(store => store.grantItems(1, 'asic', 1)), true);
    const asic = await service.handle({ eventId: 'asic', vkId: 1, command: { kind: 'mining_asic' } }, async () => 'Игрок');
    assert.match(asic.text, /^💽 Ваша ферма активирована до/u);
    assert.equal(await db.collection<InventoryItem>('inventory').countDocuments({ vkId: 1, kind: 'asic' }), 1);
    assert.match((await service.handle({ eventId: 'asic-again', vkId: 1, command: { kind: 'mining_asic' } }, async () => 'Игрок')).text, /еще работает/u);

    const rep = { eventId: 'rep', vkId: 1, isChat: true, command: { kind: 'reputation', direction: -1, target: { kind: 'vk', id: 2 } } } as const;
    assert.match((await service.handle(rep, async () => 'Игрок')).text, /Репутация: -1 \(-1\)$/u);
    assert.match((await service.handle({ ...rep, eventId: 'rep-again' }, async () => 'Игрок')).text, /Подождите/u);
    assert.equal((await players.findOne({ _id: 2 }))?.reputation, -1);
    assert.equal(await db.collection<Notification>('notifications').countDocuments({ _id: 'reputation:rep' }), 1);
    assert.ok((await db.collection('reputation_cooldowns').indexes()).some(index => index.expireAfterSeconds === 0));
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
