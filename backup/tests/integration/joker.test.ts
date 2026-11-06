import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { betMaximum } from '../../src/services/casino-texts.js';
import { GameService } from '../../src/services/game.js';
import type { CasinoRecord } from '../../src/types/casino.js';
import type { InventoryItem, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: confirmed Joker permits a large all-in until expiry and survives restart', {
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
    const service = new GameService(database);
    const players = db.collection<Player>('players');
    const items = db.collection<InventoryItem>('inventory');
    const records = db.collection<CasinoRecord>('casino_records');
    const amount = 2_500_000 * game.kcScale;
    for (const vkId of [1, 2]) {
      await service.handle({ eventId: `register-${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
    }
    await players.updateMany({}, { $set: { kc: amount } });
    const command = parseCommand('ч3 все', undefined, true);
    const denied = await service.handle({ eventId: 'no-joker', vkId: 2, peerId: 2_000_000_001, isChat: true, command }, async () => 'Игрок 2');
    assert.equal(denied.text, betMaximum('roulette'));
    assert.equal((await players.findOne({ _id: 2 }))?.kc, amount);
    assert.equal(await database.transaction(store => store.grantItems(1, 'joker', 1)), true);
    const prompt = await service.handle({ eventId: 'use-joker', vkId: 1, command: { kind: 'item_use', itemKind: 'joker' } }, async () => 'Игрок 1');
    assert.equal(prompt.keyboard.kind, 'item_confirmation');
    if (prompt.keyboard.kind !== 'item_confirmation') throw new Error('Missing Joker confirmation');
    const activated = await service.handle({ eventId: 'confirm-joker', vkId: 1, command: { kind: 'item_activate_confirm', token: prompt.keyboard.token } }, async () => 'Игрок 1');
    assert.equal(activated.text, 'Ваши лимиты в казино больше не ограничены.');
    assert.equal(await items.countDocuments({ vkId: 1, kind: 'joker' }), 0);
    const now = await database.transaction(store => store.now());
    const player = await players.findOne({ _id: 1 });
    assert.ok(player?.jokerUntil instanceof Date && player.jokerUntil > now);
    const restarted = new GameService(new MongoGameDatabase(client, name));
    const input = { eventId: 'joker-all-in', vkId: 1, peerId: 2_000_000_001, isChat: true, command };
    const accepted = await restarted.handle(input, async () => 'Игрок 1');
    assert.equal(accepted.text, '✅ [id1|Игрок 1] — 2.500.000 KC на ч3');
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 0);
    const bet = await records.findOne({ _id: 'bet:joker-all-in:0' });
    assert.ok(bet?.kind === 'bet');
    assert.equal(bet.amount, amount);
    assert.equal((await restarted.handle(input, async () => 'Игрок 1')).randomId, accepted.randomId);
    assert.equal(await records.countDocuments({ _id: 'bet:joker-all-in:0' }), 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 0);
    await players.updateOne({ _id: 1 }, { $set: { kc: amount, jokerUntil: new Date(0) } });
    const expired = await restarted.handle({ ...input, eventId: 'expired-joker', peerId: 2_000_000_002 }, async () => 'Игрок 1');
    assert.equal(expired.text, betMaximum('roulette'));
    assert.equal((await players.findOne({ _id: 1 }))?.kc, amount);
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
