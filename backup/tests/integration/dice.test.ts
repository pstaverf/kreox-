import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { diceConfig } from '../../src/config/dice.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { diceChatKey } from '../../src/services/dice-rules.js';
import { settleDice } from '../../src/services/dice.js';
import { GameService } from '../../src/services/game.js';
import type { CasinoRecord } from '../../src/types/casino.js';
import type { Command, Notification, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;
test('MongoDB replica set: dice last-seat races, cap serialization, event replay and restart-safe currency refunds', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 180_000
}, async () => {
  if (uri === undefined) throw new Error('Test MongoDB URI is missing');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  const peerId = 2_000_000_001;
  try {
    await client.connect();
    const database = new MongoGameDatabase(client, name);
    await database.initialize();
    await database.initialize();
    const service = new GameService(database, undefined, undefined, undefined, undefined, undefined, purpose => purpose.endsWith(':2') ? 11 : 0);
    let sequence = 0;
    const send = (command: Command, vkId = 1, eventId = `dice:${sequence++}`, peer = peerId) => service.handle({ eventId, command, vkId, isChat: true, peerId: peer }, async () => 'Игрок');
    for (const vkId of [1, 2, 3, 4, 5, 6, diceConfig.commissionId]) await send({ kind: 'profile' }, vkId);
    const players = db.collection<Player>('players');
    const records = db.collection<CasinoRecord>('casino_records');
    const notices = db.collection<Notification>('notifications');
    await players.updateMany({}, { $set: { kc: 10_000_000, euro: 10_000 } });
    const create = parseCommand('кости 1000', undefined, true);
    await send(create, 1, 'create-once');
    await send(create, 1, 'create-once');
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 9_900_000);
    await Promise.all(Array.from({ length: 12 }, (_, index) => send({ kind: 'dice_join', peerId, gameId: 1 }, index % 5 + 2)));
    assert.equal(await notices.countDocuments({ _id: `dice-result:${peerId}:1` }), 1);
    assert.equal(await records.countDocuments({ kind: 'dice_credit', _id: { $regex: '^dice-credit:commission:' } }), 1);
    const funded = parseCommand('кости 1000 5', undefined, true);
    await Promise.all(Array.from({ length: 8 }, (_, index) => send(funded, index % 5 + 1)));
    const chat = await records.findOne({ _id: diceChatKey(peerId) });
    assert.ok(chat?.kind === 'dice_chat');
    assert.equal(chat.games.length, 5);
    const otherPeer = peerId + 1;
    await send(parseCommand('кости евро 10 3', undefined, true), 1, undefined, otherPeer);
    await send({ kind: 'dice_join', peerId: otherPeer, gameId: 1 }, 2, undefined, otherPeer);
    assert.equal((await players.findOne({ _id: 1 }))?.euro, 9_000);
    const expired = await records.findOne({ _id: diceChatKey(otherPeer) });
    assert.ok(expired?.kind === 'dice_chat');
    const value = expired.games[0];
    assert.ok(value !== undefined);
    value.expiresAt = new Date(0);
    await records.updateOne({ _id: expired._id }, { $set: { games: [value], dueAt: new Date(0) } });
    const restarted = new MongoGameDatabase(client, name);
    await Promise.all([settleDice(restarted), settleDice(restarted)]);
    await settleDice(restarted);
    assert.equal((await players.findOne({ _id: 1 }))?.euro, 10_000);
    assert.equal((await players.findOne({ _id: 2 }))?.euro, 10_000);
    assert.equal(await notices.countDocuments({ _id: `dice-expired:${otherPeer}:1` }), 1);
    assert.equal(await notices.countDocuments({ peerId: { $in: [1, 2] }, text: { $regex: 'Ваша ставка в размере 10 💶 возвращена' } }), 2);
    const before = await records.findOne({ _id: diceChatKey(peerId) });
    await assert.rejects(database.transaction(async store => {
      await store.updateBalance(1, 'kc', 'take', 100_000);
      const state = await store.casinoGet(diceChatKey(peerId));
      assert.ok(state?.kind === 'dice_chat');
      state.games = [];
      await store.casinoSave(state);
      throw new Error('Rollback dice');
    }), /Rollback dice/);
    assert.deepEqual(await records.findOne({ _id: diceChatKey(peerId) }), before);
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
