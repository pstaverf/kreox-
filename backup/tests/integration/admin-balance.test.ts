import { maxWholeKc } from '../../src/services/kc-money.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { parseCommand } from '../../src/handlers/commands.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { texts } from '../../src/services/texts.js';
import type { Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: admin balance commands are atomic, bounded and durably deduplicated', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 120_000
}, async () => {
  if (uri === undefined) {
    throw new Error('Test MongoDB URI is missing');
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  try {
    await client.connect();
    const database = new MongoGameDatabase(client, name);
    await database.initialize();
    const service = new GameService(database);
    await service.handle({ eventId: 'register-target', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
    const players = db.collection<Player>('players');
    let sequence = 0;
    const send = (text: string, eventId = `admin-${sequence++}`) => service.handle({
      eventId, vkId: 888801846, isChat: true, command: parseCommand(text, undefined)
    }, async () => { throw new Error('Admin must not be registered'); });
    assert.equal((await send('!set @id1 100')).text, 'Done.');
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 10_000);
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => send('!add @id1 100k', 'same-add')));
    assert.ok(duplicates.every(value => value.randomId === duplicates[0]?.randomId));
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 10_010_000);
    await Promise.all(Array.from({ length: 8 }, () => send('!add @id1 1k')));
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 10_810_000);
    const restarted = new GameService(new MongoGameDatabase(client, name));
    const repeated = await restarted.handle({
      eventId: 'same-add', vkId: 888801846, command: parseCommand('!add @id1 100k', undefined)
    }, async () => 'Игрок');
    assert.equal(repeated.randomId, duplicates[0]?.randomId);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 10_810_000);
    const before = await players.findOne({ _id: 1 });
    await assert.rejects(database.transaction(async store => {
      assert.equal(await store.updateKC(1, 'add', 1_000_000), true);
      throw new Error('Rollback after balance write');
    }));
    assert.deepEqual(await players.findOne({ _id: 1 }), before);
    await players.updateOne({ _id: 1 }, { $set: { kc: maxWholeKc - 100 } });
    const last = await Promise.all(Array.from({ length: 8 }, () => send('!add @id1 1')));
    assert.equal(last.filter(value => value.text === 'Done.').length, 1);
    assert.equal(last.filter(value => value.text === texts.adminBalanceLimit).length, 7);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, maxWholeKc);
    assert.equal((await send('!set @id1 0')).text, 'Done.');
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 0);
    assert.equal((await send('!set @id999 100')).text, texts.adminBalanceMissing);
    assert.equal(await players.countDocuments(), 1);
    for (const [suffix, currency, scale] of [['donut', 'euro', game.euroScale], ['bit', 'bitcoin', game.bitcoinScale]] as const) {
      assert.equal((await send(`!set${suffix} 1 10`)).text, 'Done.');
      assert.equal((await send(`!add${suffix} 1 2`)).text, 'Done.');
      assert.equal((await players.findOne({ _id: 1 }))?.[currency], 12 * scale);
      const take = await Promise.all(Array.from({ length: 8 }, () => send(`!take${suffix} 1 12`)));
      assert.equal(take.filter(reply => reply.text === 'Done.').length, 1);
      assert.equal((await players.findOne({ _id: 1 }))?.[currency], 0);
      await players.updateOne({ _id: 1 }, { $set: { [currency]: game.maxAmount } });
      assert.equal((await send(`!add${suffix} 1 1`)).text, texts.adminWalletLimit);
      assert.equal((await players.findOne({ _id: 1 }))?.[currency], game.maxAmount);
      assert.equal((await send(`!set${suffix} 1 10`)).text, 'Done.');
      const repeated = await Promise.all(Array.from({ length: 8 }, () => send(`!take${suffix} 1 1`, `same-take-${suffix}`)));
      assert.ok(repeated.every(reply => reply.randomId === repeated[0]?.randomId));
      assert.equal((await players.findOne({ _id: 1 }))?.[currency], 9 * scale);
      const snapshot = await players.findOne({ _id: 1 });
      await assert.rejects(database.transaction(async store => {
        assert.equal(await store.updateBalance(1, currency, 'take', scale), true);
        throw new Error('Rollback after wallet debit');
      }));
      assert.deepEqual(await players.findOne({ _id: 1 }), snapshot);
    }
    const reply = await service.handle({ eventId: 'wallet-reply', vkId: 888801846,
      command: parseCommand('!setbit 1.116', undefined), replySenderId: 1
    }, async () => { throw new Error('No registration'); });
    assert.equal(reply.text, 'Done.');
    assert.equal((await players.findOne({ _id: 1 }))?.bitcoin, 111_600_000);

  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
