import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { parseCommand } from '../../src/handlers/commands.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { claimGiveaway } from '../../src/services/giveaway.js';
import { giveawayClaimKey, giveawayKey } from '../../src/services/giveaway-rules.js';
import type { CasinoRecord } from '../../src/types/casino.js';
import type { Command, InventoryItem, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;
test('MongoDB replica set: giveaway dedup, last-slot races, item rollback, cancel and replacement isolation', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 180_000
}, async () => {
  if (uri === undefined) throw new Error('Test MongoDB URI is missing');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  const peerId = 2_000_000_001;
  const admin = 888801846;
  try {
    await client.connect();
    const database = new MongoGameDatabase(client, name);
    await database.initialize();
    const service = new GameService(database);
    let sequence = 0;
    const send = (command: Command, vkId = admin, peer = peerId, eventId = `force:${sequence++}`) => service.handle({ eventId, vkId, peerId: peer, isChat: true, command }, async () => 'Игрок');
    for (const vkId of [admin, 1, 2, 3, 4]) await send({ kind: 'profile' }, vkId);
    const records = db.collection<CasinoRecord>('casino_records');
    const players = db.collection<Player>('players');
    const items = db.collection<InventoryItem>('inventory');
    await send(parseCommand('/force Раздача монеты 2 1000', undefined, true), admin, peerId, 'launch-once');
    const initial = await records.findOne({ _id: giveawayKey(peerId) });
    assert.ok(initial?.kind === 'giveaway');
    const claim: Command = { kind: 'giveaway_claim', peerId, token: initial.token };
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => send(claim, 1)));
    assert.equal(duplicates.filter(value => value.text.startsWith('✅')).length, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 100_000);
    const restarted = new GameService(new MongoGameDatabase(client, name));
    await restarted.handle({ eventId: 'restart-claim', vkId: 1, peerId, isChat: true, command: claim }, async () => 'Игрок');
    const last = await Promise.all([send(claim, 2), send(claim, 3), send(claim, 4)]);
    assert.equal(last.filter(value => value.text.includes('Раздача завершена!')).length, 1);
    assert.equal(await records.countDocuments({ kind: 'giveaway_claim' }), 2);
    const totals = await players.find({ _id: { $in: [1, 2, 3, 4] } }).limit(4).toArray();
    assert.equal(totals.reduce((sum, value) => sum + value.kc, 0), 200_000);
    await send(parseCommand('/force Раздача кейс реферальный 2 10', undefined, true));
    const itemState = await records.findOne({ _id: giveawayKey(peerId) });
    assert.ok(itemState?.kind === 'giveaway');
    const itemClaim: Command = { kind: 'giveaway_claim', peerId, token: itemState.token };
    await assert.rejects(database.transaction(async store => {
      const player = await store.player(1);
      assert.ok(player !== null);
      await claimGiveaway(store, { eventId: 'item-rollback', command: itemClaim, vkId: 1, peerId, isChat: true }, player, itemClaim);
      throw new Error('Rollback giveaway');
    }), /Rollback giveaway/);
    assert.equal(await items.countDocuments({}), 0);
    assert.equal(await records.findOne({ _id: giveawayClaimKey(peerId, itemState.token, 1) }), null);
    assert.deepEqual(await records.findOne({ _id: giveawayKey(peerId) }), itemState);
    await send(itemClaim, 1);
    assert.equal(await items.countDocuments({ vkId: 1, kind: 'referral_case' }), 10);
    await send({ kind: 'giveaway_cancel', peerId, token: itemState.token });
    assert.equal((await send(itemClaim, 2)).text, '⚠ Раздача закончилась.');
    await send(parseCommand('/force Раздача евро 2 100', undefined, true));
    assert.equal((await send(itemClaim, 2)).text, '⚠ Нельзя принимать участие в старых раздачах.');
    const current = await records.findOne({ _id: giveawayKey(peerId) });
    assert.ok(current?.kind === 'giveaway');
    await send(parseCommand('/force Раздача монеты 2 1000', undefined, true), admin, peerId + 1);
    await send({ kind: 'giveaway_claim', peerId, token: current.token }, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.euro, 10_000);
    assert.equal((await players.findOne({ _id: admin }))?.euro, 0);
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
