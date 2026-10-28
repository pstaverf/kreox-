import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { broadcastBoss } from '../../src/services/boss-broadcast.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { closeKey, roundKey } from '../../src/services/casino-rules.js';
import { settleCasino } from '../../src/services/casino-worker.js';
import { doublePhotos } from '../../src/config/double.js';
import { bossCaseKind } from '../../src/services/boss-rules.js';
import type { CasinoRecord } from '../../src/types/casino.js';
import type { Command, InventoryItem, Notification, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: boss summon/upgrade/final-hit races, durable notifications and atomic new-case rewards', {
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
    const records = db.collection<CasinoRecord>('casino_records');
    const players = db.collection<Player>('players');
    const items = db.collection<InventoryItem>('inventory');
    const service = new GameService(database, undefined, undefined, undefined, undefined, undefined, () => 0);
    let index = 0;
    const send = (command: Command, vkId = 1, eventId = `boss:${index++}`) => service.handle({ eventId, vkId, peerId: vkId, hasPayload: true, command }, async () => 'Игрок');
    for (const vkId of [1, 2]) { await send({ kind: 'profile' }, vkId); await send({ kind: 'boss_subscribe' }, vkId); }
    await players.updateMany({}, { $set: { kc: 10_000_000 } });
    const quote = await send({ kind: 'boss_damage' });
    assert.ok(quote.keyboard.kind === 'boss_upgrade');
    const command: Command = { kind: 'boss_upgrade', token: quote.keyboard.token, quantity: 1 };
    await Promise.all(Array.from({ length: 8 }, () => send(command)));
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 9_500_000);
    const upgraded = await records.findOne({ _id: 'boss-player:1' });
    assert.ok(upgraded?.kind === 'boss_player');
    assert.equal(upgraded.level, 1);
    const summoned = await Promise.all([send(parseCommand('!cboss 1 «Ахиллес» 💙', undefined), 888801846), send(parseCommand('!cboss 1 «Ахиллес» 💙', undefined), 312631501)]);
    assert.equal(summoned.filter(reply => reply.text.includes('успешно призван')).length, 1);
    assert.equal(await records.countDocuments({ kind: 'boss_run' }), 1);
    assert.equal(await broadcastBoss(database), 2);
    assert.equal(await broadcastBoss(database), 0);
    const current = await records.findOne({ _id: 'boss-current' });
    assert.ok(current?.kind === 'boss_current');
    assert.equal(await database.bossNotificationsAllowed(1, current.runId), true);
    await send({ kind: 'boss_subscribe' }, 1);
    assert.equal(await database.bossNotificationsAllowed(1, current.runId), false);
    const first = await send({ kind: 'boss_fight' });
    const second = await send({ kind: 'boss_fight' }, 2);
    assert.ok(first.keyboard.kind === 'boss_fight' && second.keyboard.kind === 'boss_fight');
    const commands: Command[] = [
      { kind: 'boss_attack', token: first.keyboard.token, slot: first.keyboard.emojis.indexOf('⚔️') },
      { kind: 'boss_attack', token: second.keyboard.token, slot: second.keyboard.emojis.indexOf('⚔️') }
    ];
    const one = commands[0];
    const two = commands[1];
    assert.ok(one && two);
    await Promise.all([send(one), send(two, 2)]);
    const dead = await records.findOne({ _id: current.runId });
    assert.ok(dead?.kind === 'boss_run');
    assert.equal(dead.health, 0);
    const scores = await records.find({ kind: 'boss_damage', runId: current.runId }).toArray();
    assert.equal(scores.reduce((total, value) => total + (value.kind === 'boss_damage' ? value.damage : 0), 0), 1);
    assert.equal(await items.countDocuments({ kind: bossCaseKind('💙', 'Ахиллес') }), 1);
    assert.equal(await database.bossNotificationsAllowed(2, current.runId), false);
    const winnerItem = await items.findOne({ kind: bossCaseKind('💙', 'Ахиллес') });
    assert.ok(winnerItem);
    await assert.rejects(database.transaction(async store => {
      const player = await store.player(winnerItem.vkId);
      assert.ok(player);
      assert.equal(await store.openItems(player, winnerItem.kind, 1, { kc: 0, euro: 0, aristocrat: 1, counts: [] }, await store.now()), 'ok');
      throw new Error('Rollback nested case reward');
    }), /Rollback nested case reward/u);
    assert.equal(await items.countDocuments({ kind: winnerItem.kind }), 1);
    await database.transaction(async store => {
      const player = await store.player(winnerItem.vkId);
      assert.ok(player);
      assert.equal(await store.openItems(player, winnerItem.kind, 1, { kc: 0, euro: 0, aristocrat: 1, counts: [] }, await store.now()), 'ok');
    });
    assert.equal(await items.countDocuments({ kind: winnerItem.kind }), 0);
    assert.equal(await items.countDocuments({ kind: 'aristocrat_case' }), 1);
    await database.initialize();
    assert.equal((await records.findOne({ _id: 'boss-player:1' }))?.kind, 'boss_player');
    assert.equal(await db.collection<Notification>('notifications').countDocuments({ bossSummon: current.runId }), 2);
  } finally { try { await db.dropDatabase(); } finally { await client.close(); } }
});

test('MongoDB replica set: double stake replay/races, ten-bet cap, delivery-gated close and exact payout/photo metadata', {
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
    await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
    await players.updateOne({ _id: 1 }, { $set: { kc: 10_000_000 } });
    const input = { eventId: 'double-once', vkId: 1, peerId: 2_000_000_001, isChat: true, command: parseCommand('дабл 5 1000', undefined, true) };
    const replays = await Promise.all(Array.from({ length: 8 }, () => service.handle(input, async () => 'Игрок')));
    assert.ok(replays.every(reply => reply.randomId === replays[0]?.randomId));
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 9_900_000);
    const bets = await Promise.all(Array.from({ length: 12 }, (_, index) => service.handle({ ...input, eventId: `double-many:${index}` }, async () => 'Игрок')));
    assert.equal(bets.filter(reply => reply.text.startsWith('✅')).length, 9);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 9_000_000);
    const now = await database.transaction(store => store.now());
    const past = new Date(now.getTime() - 1000);
    const id = roundKey(input.peerId, 'double');
    await records.updateOne({ _id: id }, { $set: { dueAt: past, closesAt: past } });
    await settleCasino(database);
    const closed = await records.findOne({ _id: id });
    assert.ok(closed?.kind === 'round');
    assert.equal(closed.stage, 'closed');
    assert.equal(await notices.countDocuments({ _id: closeKey(closed) }), 1);
    for (let index = 0; index < 8; index += 1) {
      await notices.updateMany({}, { $set: { state: 'sent' } });
      await records.updateMany({ kind: 'round', stage: { $in: ['closed', 'waiting', 'announcing'] } }, { $set: { dueAt: past } });
      await settleCasino(database);
    }
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 14_000_000);
    const photoUrl = doublePhotos[5];
    assert.ok(photoUrl);
    assert.equal((await notices.findOne({ photoUrl }))?.photoUrl, photoUrl);
    const round = await records.findOne({ _id: id });
    assert.ok(round?.kind === 'round');
    assert.equal(round.winners, 10);
    const result = await notices.findOne({ _id: `result:${round.roundId}:0` });
    assert.ok(result);
    assert.equal((result.text.match(/— Приз:/gu) ?? []).length, 1);
    assert.match(result.text, /— 10\.000 KC на 5\n— Приз: 50\.000 KC/u);
    assert.equal(result.text.includes('Проиграно:'), false);
  } finally { try { await db.dropDatabase(); } finally { await client.close(); } }
});
