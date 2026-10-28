import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { betMaximum } from '../../src/services/casino-texts.js';
import { roundKey } from '../../src/services/casino-rules.js';
import { settleWinningGroup } from '../../src/services/casino-winnings.js';
import { settleCasino } from '../../src/services/casino-worker.js';
import type { CasinoMode, CasinoRecord } from '../../src/types/casino.js';
import type { Notification, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: cumulative player budgets survive racing targets and grouped results preserve individual payout deduplication', {
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
    const service = new GameService(database, undefined, undefined, undefined, undefined, undefined, (purpose, maximum) => purpose.endsWith(':double') ? 125 : maximum - 1);
    const players = db.collection<Player>('players');
    const records = db.collection<CasinoRecord>('casino_records');
    const notices = db.collection<Notification>('notifications');
    for (const vkId of [1, 2]) await service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => 'Игрок');
    await players.updateMany({}, { $set: { kc: 1_000_000_000 } });
    const peerId = 2_000_000_001;
    let index = 0;
    const send = (text: string, vkId = 1, eventId = `policy:${index++}`) => service.handle({ eventId, vkId, peerId, isChat: true, text, command: parseCommand(text, undefined, true) }, async () => 'Игрок');
    const modes: { mode: CasinoMode; command: string; other: string }[] = [
      { mode: 'roulette', command: 'рулетка красное', other: 'рулетка 9' },
      { mode: 'dream', command: 'дрим 5', other: 'дрим 2' },
      { mode: 'crash', command: 'краш 1.5', other: 'краш 1.7' },
      { mode: 'double', command: 'дабл 5', other: 'дабл 5' }
    ];
    for (const value of modes) {
      const original = await send(`${value.command} 600к`, 1, `first:${value.mode}`);
      assert.match(original.text, /^✅/u);
      const raced = await Promise.all([send(`${value.command} 300к`), send(`${value.other} 300к`)]);
      assert.equal(raced.filter(reply => reply.text.startsWith('✅')).length, 1);
      assert.equal(raced.filter(reply => reply.text === betMaximum(value.mode)).length, 1);
      assert.match((await send(`${value.command} 100к`)).text, /^✅/u);
      const before = await players.findOne({ _id: 1 });
      assert.equal((await send(`${value.command} 1000`)).text, betMaximum(value.mode));
      assert.deepEqual(await players.findOne({ _id: 1 }), before);
      assert.equal((await send(`${value.command} 600к`, 1, `first:${value.mode}`)).randomId, original.randomId);
      const round = await records.findOne({ _id: roundKey(peerId, value.mode) });
      assert.ok(round?.kind === 'round');
      assert.equal(round.total, 100_000_000);
      assert.equal(await records.countDocuments({ kind: 'bet', roundId: round.roundId }), 3);
    }
    assert.match((await send('дабл 5 1кк', 2)).text, /^✅/u);
    const round = await records.findOne({ _id: roundKey(peerId, 'double') });
    assert.ok(round?.kind === 'round');
    const selected = await records.findOne({ kind: 'bet', roundId: round.roundId, vkId: 1 });
    assert.ok(selected?.kind === 'bet');
    await assert.rejects(database.transaction(async store => {
      await settleWinningGroup(store, round, selected);
      throw new Error('Rollback grouped settlement');
    }), /Rollback grouped settlement/u);
    assert.equal(await records.countDocuments({ kind: 'credit' }), 0);
    assert.equal(await records.countDocuments({ kind: 'bet', roundId: round.roundId, settled: true }), 0);
    const now = await database.transaction(store => store.now());
    const past = new Date(now.getTime() - 1000);
    await records.updateMany({ kind: 'round' }, { $set: { closesAt: past, dueAt: past } });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await notices.updateMany({}, { $set: { state: 'sent' } });
      await records.updateMany({ kind: 'round', stage: { $in: ['closed', 'waiting', 'announcing'] } }, { $set: { dueAt: past } });
      await Promise.all([settleCasino(database), settleCasino(database)]);
      if (await records.countDocuments({ kind: 'round', stage: { $ne: 'finished' } }) === 0 && await records.countDocuments({ kind: 'credit', stage: 'pending' }) === 0) break;
    }
    const pages = await notices.find({ _id: { $regex: `^result:${round.roundId}:` } }).toArray();
    const text = pages.map(page => page.text).join('\n');
    assert.equal((text.match(/✅/gu) ?? []).length, 2);
    assert.equal((text.match(/— 1\.000\.000 KC на 5\n— Приз: 5\.000\.000 KC/gu) ?? []).length, 2);
    assert.doesNotMatch(text, /Приз:[^\n]*\n\n✅/u);
    assert.equal(text.includes('Проиграно:'), false);
    assert.equal(await records.countDocuments({ kind: 'bet', roundId: round.roundId, settled: true }), 4);
    for (const bet of await records.find({ kind: 'bet', roundId: round.roundId }).toArray()) {
      assert.ok(bet.kind === 'bet');
      assert.equal(await records.countDocuments({ _id: `credit:${bet._id}`, kind: 'credit', stage: 'paid' }), 1);
    }
  } finally { try { await db.dropDatabase(); } finally { await client.close(); } }
});
