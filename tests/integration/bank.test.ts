import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { bankConfig } from '../../src/config/bank.js';
import { game } from '../../src/config/game.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { settleBankDeposits, finishDeposit } from '../../src/services/bank-deposits.js';
import { GameService } from '../../src/services/game.js';
import type { Deposit } from '../../src/types/bank.js';
import type { Command, Notification, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: registration migration, savings, transfer races, pensions and durable deposit payouts', {
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
    const service = new GameService(database, undefined, undefined, undefined, undefined, () => 0);
    let index = 0;
    const send = (command: Command, vkId = 1, isChat = false) => service.handle({ eventId: `bank-${index++}`, vkId, command, isChat, replySenderId: 2 }, async () => 'Игрок');
    for (const id of [1, 2, 3]) await send({ kind: 'profile' }, id);
    const players = db.collection<Player>('players');
    const deposits = db.collection<Deposit>('deposits');
    const notifications = db.collection<Notification>('notifications');
    await players.updateOne({ _id: 1 }, { $unset: { registeredAt: '' } });
    await database.initialize();
    const migrated = await players.findOne({ _id: 1 });
    assert.ok(migrated?.registeredAt instanceof Date);
    await database.initialize();
    assert.equal((await players.findOne({ _id: 1 }))?.registeredAt?.getTime(), migrated.registeredAt.getTime());
    const now = await database.transaction(store => store.now());
    await players.updateOne({ _id: 1 }, { $set: { kc: 10_000, savingsBalance: 1_000_000, savingsSince: new Date(now.getTime() - bankConfig.weekMs - 1000) } });
    assert.match((await send({ kind: 'bank_savings' })).text, /10.200 KC/);
    assert.equal((await players.findOne({ _id: 1 }))?.savingsBalance, 1_020_000);
    await send({ kind: 'bank_savings' });
    assert.equal((await players.findOne({ _id: 1 }))?.savingsBalance, 1_020_000);
    const transfers = await Promise.all(Array.from({ length: 8 }, () => send(parseCommand('монеты 100', undefined, true), 1, true)));
    assert.equal(transfers.filter(reply => reply.text.startsWith('Вы успешно')).length, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 0);
    assert.equal((await players.findOne({ _id: 2 }))?.kc, 9500);
    assert.equal(await notifications.countDocuments({ _id: /^transfer:/ }), 1);
    await players.updateOne({ _id: 1 }, { $set: { kc: 10_000 } });
    const replayInput = { eventId: 'bank-transfer-once', vkId: 1, isChat: true, replySenderId: 2, command: parseCommand('монеты 100', undefined, true) };
    const firstTransfer = await service.handle(replayInput, async () => 'Игрок');
    const restarted = new GameService(new MongoGameDatabase(client, name));
    const replays = await Promise.all(Array.from({ length: 8 }, () => restarted.handle(replayInput, async () => 'Игрок')));
    assert.ok(replays.every(reply => reply.randomId === firstTransfer.randomId));
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 0);
    assert.equal((await players.findOne({ _id: 2 }))?.kc, 19_000);
    assert.equal(await notifications.countDocuments({ _id: /^transfer:/ }), 2);
    await assert.rejects(database.transaction(async store => {
      const sender = await store.player(2);
      const receiver = await store.player(3);
      assert.ok(sender);
      assert.ok(receiver);
      assert.equal(await store.transferMoney(sender, receiver, 'kc', 1000, 950), true);
      throw new Error('Rollback after transfer credit');
    }));
    assert.equal((await players.findOne({ _id: 2 }))?.kc, 19_000);
    assert.equal((await players.findOne({ _id: 3 }))?.kc, 0);
    await players.updateOne({ _id: 1 }, { $set: { registeredAt: new Date(now.getTime() - 61 * bankConfig.dayMs) } });
    const pensions = await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'bank_pension' })));
    assert.equal(pensions.filter(reply => reply.text.startsWith('✅ Ваша пенсия')).length, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 500_000);
    const created = await Promise.all(Array.from({ length: 8 }, () => database.transaction(async store => {
      const player = await store.player(1);
      assert.ok(player);
      return store.createDeposit(player, 10_000, 3, await store.now());
    })));
    assert.equal(created.filter(value => typeof value !== 'string').length, 5);
    assert.equal(await deposits.countDocuments({ vkId: 1, state: 'active' }), 5);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 450_000);
    const pastEnd = new Date(now.getTime() - 1000);
    const pastStart = new Date(pastEnd.getTime() - 3 * bankConfig.dayMs);
    await deposits.updateMany({ vkId: 1, state: 'active' }, { $set: { createdAt: pastStart, expiresAt: pastEnd, nextAttemptAt: pastEnd } });
    const completions = await Promise.all(Array.from({ length: 8 }, () => settleBankDeposits(database)));
    assert.equal(completions.reduce((sum, count) => sum + count, 0), 5);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 501_000);
    assert.equal(await notifications.countDocuments({ _id: /^deposit:/ }), 5);
    assert.equal(await deposits.countDocuments({ vkId: 1, state: 'active' }), 0);
    const early = await database.transaction(async store => {
      const player = await store.player(1);
      assert.ok(player);
      return store.createDeposit(player, 10_000, 10, await store.now());
    });
    assert.ok(typeof early !== 'string');
    const quoted = await send({ kind: 'bank_deposit_early', depositId: early.depositId });
    assert.ok(quoted.keyboard.kind === 'bank_deposit_confirm');
    const token = quoted.keyboard.token;
    const withdrawn = await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'bank_deposit_confirm', token })));
    assert.equal(withdrawn.filter(reply => reply.text.startsWith('✅ Вы сняли депозит')).length, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 500_000);
    const blocked = await database.transaction(async store => {
      const player = await store.player(1);
      assert.ok(player);
      return store.createDeposit(player, 10_000, 3, await store.now());
    });
    assert.ok(typeof blocked !== 'string');
    const boundary = await send({ kind: 'bank_deposit_early', depositId: blocked.depositId });
    assert.ok(boundary.keyboard.kind === 'bank_deposit_confirm');
    const boundaryToken = boundary.keyboard.token;
    await deposits.updateOne({ _id: blocked._id }, { $set: { createdAt: pastStart, expiresAt: pastEnd, nextAttemptAt: pastEnd } });
    await players.updateOne({ _id: 1 }, { $set: { kc: game.maxAmount } });
    assert.equal(await settleBankDeposits(database), 0);
    assert.equal((await deposits.findOne({ _id: blocked._id }))?.state, 'active');
    await players.updateOne({ _id: 1 }, { $set: { kc: 0 } });
    await deposits.updateOne({ _id: blocked._id }, { $set: { nextAttemptAt: pastEnd } });
    await assert.rejects(database.transaction(async store => {
      const current = await store.deposit(1, blocked.depositId);
      assert.ok(current);
      assert.equal(await finishDeposit(store, current, await store.now()), true);
      throw new Error('Rollback after maturity notification');
    }));
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 0);
    assert.equal((await deposits.findOne({ _id: blocked._id }))?.state, 'active');
    assert.equal(await notifications.countDocuments({ _id: `deposit:${blocked._id}` }), 0);
    await Promise.all([send({ kind: 'bank_deposit_confirm', token: boundaryToken }), settleBankDeposits(database)]);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 10_200);
    assert.equal((await deposits.findOne({ _id: blocked._id }))?.state, 'completed');
    assert.equal(await notifications.countDocuments({ _id: `deposit:${blocked._id}` }), 1);
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
