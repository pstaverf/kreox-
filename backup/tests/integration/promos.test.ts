import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { promoTexts } from '../../src/services/promo-texts.js';
import type { Player } from '../../src/types/game.js';
import type { Promo, PromoRedemption } from '../../src/types/promo.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: promo funding, global uniqueness, activation races and rollback', {
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
    await database.initialize();
    const service = new GameService(database);
    for (let id = 1; id <= 10; id += 1) {
      await service.handle({ eventId: `register-${id}`, vkId: id, command: { kind: 'profile' } }, async () => 'Игрок');
    }
    const players = db.collection<Player>('players');
    const promos = db.collection<Promo>('promos');
    const receipts = db.collection<PromoRedemption>('promo_redemptions');
    const code: Promo = { _id: 'Подарок', ownerId: 1, currency: 'kc', amount: 1_000_000, quantity: 5, remaining: 5 };
    await players.updateMany({ _id: { $in: [1, 2] } }, { $set: { kc: 10_000_000 } });
    const create = (owner: number) => database.transaction(async store => {
      const player = await store.player(owner);
      assert.ok(player);
      return store.createPromo(player, { ...code, ownerId: owner });
    });
    const competing = await Promise.allSettled([create(1), create(2)]);
    assert.equal(competing.filter(value => value.status === 'fulfilled' && value.value === 'created').length, 1);
    assert.equal(await promos.countDocuments(), 1);
    const owner = await promos.findOne({ _id: code._id });
    assert.ok(owner);
    for (const id of [1, 2]) {
      const player = await players.findOne({ _id: id });
      assert.equal(player?.kc, id === owner.ownerId ? 5_000_000 : 10_000_000);
    }
    const actor = owner.ownerId === 1 ? 2 : 1;
    const actorBefore = await players.findOne({ _id: actor });
    assert.ok(actorBefore);
    const redeem = (vkId: number) => database.transaction(async store => {
      const player = await store.player(vkId);
      const promo = await store.promo(code._id);
      assert.ok(player);
      assert.ok(promo);
      return store.activatePromo(player, promo);
    });
    const duplicateRedemptions = await Promise.all(Array.from({ length: 8 }, () => redeem(actor)));
    assert.equal(duplicateRedemptions.filter(value => value === 'redeemed').length, 1);
    assert.equal(duplicateRedemptions.filter(value => value === 'already').length, 7);
    assert.equal((await players.findOne({ _id: actor }))?.kc, actorBefore.kc + code.amount);
    assert.equal((await promos.findOne({ _id: code._id }))?.remaining, 4);
    const race = await Promise.all(Array.from({ length: 8 }, (_, index) => redeem(index + 3)));
    assert.equal(race.filter(value => value === 'redeemed').length, 4);
    assert.equal(race.filter(value => value === 'empty').length, 4);
    assert.equal((await promos.findOne({ _id: code._id }))?.remaining, 0);
    assert.equal(await receipts.countDocuments(), 5);
    assert.equal(await redeem(owner.ownerId), 'own');
    assert.equal(await create(actor), 'exists');
    await database.transaction(async store => {
      const player = await store.player(owner.ownerId);
      assert.ok(player);
      assert.equal(await store.createPromo(player, { ...code, _id: 'подарок', ownerId: owner.ownerId }), 'created');
    });
    assert.equal(await promos.countDocuments(), 2);
    const lower = await promos.findOne({ _id: 'подарок' });
    assert.ok(lower);
    const beforeRollback = await players.findOne({ _id: actor });
    await assert.rejects(database.transaction(async store => {
      const player = await store.player(actor);
      assert.ok(player);
      assert.equal(await store.activatePromo(player, lower), 'redeemed');
      throw new Error('Rollback after redemption');
    }));
    assert.deepEqual(await players.findOne({ _id: actor }), beforeRollback);
    assert.equal((await promos.findOne({ _id: 'подарок' }))?.remaining, 5);
    assert.equal(await receipts.countDocuments({ promoName: 'подарок' }), 0);
    await assert.rejects(database.transaction(async store => {
      const player = await store.player(actor);
      assert.ok(player);
      assert.equal(await store.createPromo(player, { ...code, _id: 'Откатить', ownerId: actor }), 'created');
      throw new Error('Rollback after funding');
    }));
    assert.deepEqual(await players.findOne({ _id: actor }), beforeRollback);
    assert.equal(await promos.findOne({ _id: 'Откатить' }), null);
    await players.updateOne({ _id: actor }, { $set: { kc: game.maxAmount } });
    assert.equal(await database.transaction(async store => {
      const player = await store.player(actor);
      const promo = await store.promo('подарок');
      assert.ok(player);
      assert.ok(promo);
      return store.activatePromo(player, promo);
    }), 'balance_limit');
    assert.equal(await receipts.countDocuments({ promoName: 'подарок' }), 0);
    await players.updateOne({ _id: actor }, { $set: {
      promoDraft: { step: 'confirm', name: 'Восстановить', currency: 'euro', amount: 500, quantity: 5, token: 'persistent' },
      euro: 2500
    } });
    const restored = new GameService(new MongoGameDatabase(client, name));
    const input = { eventId: 'persistent-confirm', vkId: actor, command: { kind: 'promo_confirm', token: 'persistent' } } as const;
    const first = await restored.handle(input, async () => 'Игрок');
    assert.equal(first.text, promoTexts.created);
    assert.deepEqual(await restored.handle(input, async () => 'Игрок'), first);
    assert.equal((await players.findOne({ _id: actor }))?.euro, 0);
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
