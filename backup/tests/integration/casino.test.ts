import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { roundKey } from '../../src/services/casino-rules.js';
import { settleCasino } from '../../src/services/casino-worker.js';
import { GameService } from '../../src/services/game.js';
import type { CasinoRecord } from '../../src/types/casino.js';
import type { Command, Notification, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: casino races, durable payouts, result delivery, election refunds and atomic rollback', {
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
    await database.initialize();
    const service = new GameService(database, undefined, undefined, undefined, undefined, undefined, () => 484_999_999);
    const records = db.collection<CasinoRecord>('casino_records');
    const players = db.collection<Player>('players');
    const notifications = db.collection<Notification>('notifications');
    let index = 0;
    const send = (command: Command, vkId = 1, eventId = `casino-${index++}`, isChat = false) => service.handle({ eventId, vkId, command, isChat, peerId: 2_000_000_001 }, async () => 'Игрок');
    for (const id of [1, 2, 3]) await send({ kind: 'profile' }, id);
    await players.updateMany({}, { $set: { kc: 10_000_000 } });
    await send({ kind: 'director_view' });
    await records.updateOne({ _id: 'director' }, { $set: { holderId: 3 } });
    const bet = parseCommand('краш 1.7 1000', undefined, true);
    const races = await Promise.all(Array.from({ length: 16 }, () => send(bet, 1, undefined, true)));
    assert.equal(races.filter(reply => reply.text.startsWith('✅')).length, 10);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 9_000_000);
    const director = await records.findOne({ _id: 'director' });
    assert.ok(director?.kind === 'director');
    assert.equal(director.earnedKC, 10_000);
    const otherBet = await send(bet, 2, 'casino-replayed', true);
    const restarted = new GameService(new MongoGameDatabase(client, name));
    await restarted.handle({ eventId: 'casino-replayed', vkId: 2, command: bet, isChat: true, peerId: 2_000_000_001 }, async () => 'Игрок');
    assert.equal((await players.findOne({ _id: 2 }))?.kc, 9_900_000);
    assert.equal(otherBet.keyboard.kind, 'none');
    const now = await database.transaction(store => store.now());
    const past = new Date(now.getTime() - 1000);
    await records.updateOne({ _id: roundKey(2_000_000_001, 'crash') }, { $set: { closesAt: past, dueAt: past } });
    await settleCasino(database);
    assert.equal((await records.findOne({ _id: roundKey(2_000_000_001, 'crash') }))?.kind, 'round');
    const resultRound = await records.findOne({ _id: roundKey(2_000_000_001, 'crash') });
    assert.ok(resultRound?.kind === 'round');
    assert.equal(resultRound.stage, 'closed');
    await notifications.updateMany({}, { $set: { state: 'sent' } });
    await records.updateOne({ _id: resultRound._id }, { $set: { dueAt: past } });
    await settleCasino(database);
    await records.updateOne({ _id: resultRound._id }, { $set: { dueAt: past } });
    await players.updateOne({ _id: 2 }, { $set: { kc: game.maxAmount } });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await records.updateMany({ kind: 'round', stage: { $in: ['announcing', 'waiting'] } }, { $set: { dueAt: past } });
      await notifications.updateMany({}, { $set: { state: 'sent' } });
      await Promise.all([settleCasino(database), settleCasino(database)]);
    }
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 10_700_000);
    assert.equal((await players.findOne({ _id: 2 }))?.kc, game.maxAmount);
    const pending = await records.findOne({ kind: 'credit', vkId: 2, stage: 'pending' });
    assert.ok(pending?.kind === 'credit');
    assert.equal(pending.amount, 170_000);
    await players.updateOne({ _id: 2 }, { $set: { kc: 0 } });
    await records.updateOne({ _id: pending._id }, { $set: { dueAt: past } });
    await settleCasino(database);
    assert.equal((await players.findOne({ _id: 2 }))?.kc, 170_000);
    const before = await players.findOne({ _id: 1 });
    await assert.rejects(database.transaction(async store => {
      assert.equal(await store.updateBalance(1, 'kc', 'take', 100_000), true);
      await store.casinoInsert({ _id: 'credit:rollback', version: 0, kind: 'credit', vkId: 2, amount: 100_000, destination: 'wallet', notice: '', dueAt: past, stage: 'pending' });
      throw new Error('Rollback casino debit and payout');
    }));
    assert.deepEqual(await players.findOne({ _id: 1 }), before);
    assert.equal(await records.countDocuments({ _id: 'credit:rollback' }), 0);
    for (const id of [1, 2]) {
      await send({ kind: 'director_bid' }, id);
      const quote = await service.handle({ eventId: `bid-input-${id}`, vkId: id, command: { kind: 'development' }, text: '1000' }, async () => 'Игрок');
      assert.ok(quote.keyboard.kind === 'director_confirm');
      const token = quote.keyboard.token;
      const confirmations = await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'director_confirm', token }, id)));
      assert.equal(confirmations.filter(reply => reply.text.startsWith('✅ Вы успешно поставили')).length, 1);
    }
    await database.recordChat(2_000_000_001);
    await database.recordChat(2_000_000_002);
    const before1 = await players.findOne({ _id: 1 });
    const before2 = await players.findOne({ _id: 2 });
    assert.ok(before1 && before2);
    await records.updateOne({ _id: 'director' }, { $set: { dueAt: past } });
    await Promise.all(Array.from({ length: 4 }, () => settleCasino(database, () => 0)));
    await settleCasino(database, () => 0);
    const afterElection = await records.findOne({ _id: 'director' });
    assert.ok(afterElection?.kind === 'director');
    assert.equal(afterElection.holderId, 1);
    assert.equal(afterElection.total, 0);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, before1.kc);
    assert.equal((await players.findOne({ _id: 2 }))?.kc, before2.kc + 50_000);
    assert.equal(await notifications.countDocuments({ text: /Всего ставок было/ }), 2);
    assert.equal(await notifications.countDocuments({ text: /Поздравляем с победой/ }), 1);
    assert.equal(await notifications.countDocuments({ text: /вы проиграли/ }), 1);
    await players.updateOne({ _id: 1 }, { $set: { kc: 600_001 } });
    const relative = await service.handle({ eventId: 'relative-mixed', vkId: 1, isChat: true, peerId: 2_000_000_009,
      command: parseCommand('краш 1.7 пол\nдрим 20 пол\nкраш 1.7 всё\nдрим 1 вб', undefined, true)
    }, async () => 'Игрок');
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 0);
    assert.equal(relative.text.split('\n').filter(line => line.startsWith('✅')).length, 3);
    const relativeBets = await records.find({ kind: 'bet', _id: /^bet:relative-mixed:/ }).sort({ _id: 1 }).limit(4).toArray();
    assert.deepEqual(relativeBets.map(bet => bet.kind === 'bet' ? bet.amount : null), [300_000, 150_000, 150_001]);

  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
