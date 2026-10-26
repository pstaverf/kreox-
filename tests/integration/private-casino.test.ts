import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { coinKey } from '../../src/services/coin-rules.js';
import { settleJackpot } from '../../src/services/jackpot.js';
import { settleCasino } from '../../src/services/casino-worker.js';
import type { CasinoRecord } from '../../src/types/casino.js';
import type { Command, Notification, Player } from '../../src/types/game.js';
import type { CoinState } from '../../src/types/private-casino.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: coin double clicks, payout rollback, jackpot registration races and durable draw recovery', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 180_000
}, async () => {
  if (uri === undefined) throw new Error('Test MongoDB URI is missing');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  try {
    await client.connect();
    const database = new MongoGameDatabase(client, name);
    await database.initialize();
    const service = new GameService(database, undefined, undefined, undefined, undefined, undefined, () => 0);
    let sequence = 0;
    const send = (command: Command, vkId = 1, text?: string, eventId = `private:${sequence++}`) => service.handle({
      eventId, vkId, peerId: vkId, command, ...(text === undefined ? {} : { text })
    }, async () => 'Игрок');
    const players = db.collection<Player>('players');
    const records = db.collection<CasinoRecord>('casino_records');
    for (const vkId of [1, 2, 3]) await send({ kind: 'profile' }, vkId);
    await players.updateMany({}, { $set: { kc: 10_000_000 } });
    await send({ kind: 'coin' });
    await send({ kind: 'development' }, 1, '10к');
    const initial = await records.findOne({ _id: coinKey(1) });
    assert.ok(initial?.kind === 'coin');
    const flip: Command = { kind: 'coin_flip', side: 'diamond', token: initial.sessionId, step: 0 };
    const clicks = await Promise.all(Array.from({ length: 8 }, () => send(flip)));
    assert.equal(clicks.filter(reply => reply.text.startsWith('✅ Вы угадали!')).length, 1);
    const won = await records.findOne({ _id: coinKey(1) });
    assert.ok(won?.kind === 'coin');
    assert.equal(won.history.length, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 9_000_000);
    await assert.rejects(database.transaction(async store => {
      assert.equal(await store.updateBalance(1, 'kc', 'add', 1_800_000), true);
      const state = await store.casinoGet(coinKey(1));
      assert.ok(state?.kind === 'coin');
      state.stage = 'finished';
      await store.casinoSave(state);
      throw new Error('Rollback cashout');
    }), /Rollback cashout/);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 9_000_000);
    assert.equal((await db.collection<CoinState>('casino_records').findOne({ _id: coinKey(1) }))?.stage, 'playing');
    const cash: Command = { kind: 'coin_cashout', token: won.sessionId, step: 1 };
    const paid = await Promise.all(Array.from({ length: 8 }, () => send(cash)));
    assert.equal(paid.filter(reply => reply.text.startsWith('✅ Вы забрали')).length, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 10_800_000);
    await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'jackpot_join' })));
    await send({ kind: 'jackpot_join' }, 2);
    await send({ kind: 'jackpot_join' }, 3);
    const jackpot = await records.findOne({ _id: 'jackpot' });
    assert.ok(jackpot?.kind === 'jackpot');
    assert.equal(jackpot.participants, 3);
    assert.equal(jackpot.amount, 100_000);
    const now = await database.transaction(store => store.now());
    await records.updateOne({ _id: 'jackpot' }, { $set: { dueAt: new Date(now.getTime() - 1000) } });
    await settleJackpot(new MongoGameDatabase(client, name), () => 0);
    await settleCasino(database);
    const draw = await records.findOne({ _id: `jackpot-draw:${jackpot.roundId}` });
    assert.ok(draw?.kind === 'jackpot_draw');
    assert.equal(draw.stage, 'finished');
    const notifications = db.collection<Notification>('notifications');
    assert.equal(await notifications.countDocuments({ _id: { $regex: '^jackpot-result:' } }), 2);
    assert.equal((await players.findOne({ _id: draw.winnerId }))?.kc, draw.winnerId === 1 ? 10_900_000 : 10_100_000);
    await settleJackpot(database, () => 0);
    await settleCasino(database);
    assert.equal(await notifications.countDocuments({ _id: { $regex: '^jackpot-result:' } }), 2);
  } finally {
    await db.dropDatabase().catch(() => undefined);
    await client.close();
  }
});
