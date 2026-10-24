import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import type { InventoryItem, Notification, Player } from '../../src/types/game.js';
import type { ItemOffer } from '../../src/types/items.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: item opening, gifts, reserved purchases, expiration and rollback', {
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
    const service = new GameService(database, undefined, undefined, () => 0);
    for (const id of [1, 2, 3]) {
      await service.handle({ eventId: `register-${id}`, vkId: id, command: { kind: 'profile' } }, async () => 'Игрок');
    }
    const players = db.collection<Player>('players');
    const items = db.collection<InventoryItem>('inventory');
    const offers = db.collection<ItemOffer>('item_offers');
    const grant = (quantity: number) => database.transaction(store => store.grantItems(1, 'referral_case', quantity));
    assert.equal(await grant(1), true);
    const input = { eventId: 'same-open', vkId: 1, command: { kind: 'item_open', itemKind: 'referral_case', quantity: 1 } } as const;
    const opened = await Promise.all(Array.from({ length: 8 }, () => service.handle(input, async () => 'Игрок')));
    assert.ok(opened.every(reply => reply.randomId === opened[0]?.randomId));
    assert.equal(await items.countDocuments({ vkId: 1 }), 0);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 150_000);
    assert.equal(await grant(3), true);
    const inventory = await service.handle({
      eventId: 'grouped-inventory', vkId: 1, command: { kind: 'inventory', page: 0 }
    }, async () => 'Игрок');
    assert.equal(inventory.text, '🎒 Ваш инвентарь:\n\n🆔 2 — 👬 Кейс «Реферальный» (3 шт.)');
    assert.deepEqual(inventory.keyboard, { kind: 'inventory', page: 0, itemIds: [2], hasNext: false });
    assert.equal((await service.handle({
      eventId: 'grouped-chat-inventory', vkId: 1, isChat: true, command: { kind: 'inventory', page: 0 }
    }, async () => 'Игрок')).text, inventory.text);
    assert.deepEqual(await database.transaction(store => store.inventory(1, 1)), []);
    assert.deepEqual(await database.transaction(store => store.inventoryAll(2)), []);
    await assert.rejects(database.transaction(async store => {
      const sender = await store.player(1);
      const receiver = await store.player(2);
      assert.ok(sender);
      assert.ok(receiver);
      assert.equal(await store.giftItems(sender, receiver, 'referral_case', 2, await store.now()), 'ok');
      await store.enqueueItemNotification('rollback-gift', 2, 'Подарок', { kind: 'none' });
      throw new Error('Rollback after transfer');
    }));
    assert.equal(await items.countDocuments({ vkId: 1 }), 3);
    assert.equal(await items.countDocuments({ vkId: 2 }), 0);
    assert.equal(await db.collection<Notification>('notifications').findOne({ _id: 'rollback-gift' }), null);
    const createOffer = (id: string, quantity: number) => database.transaction(async store => {
      const now = await store.now();
      return store.reserveOffer({
        _id: id, sellerId: 1, buyerId: 2, itemKind: 'referral_case', quantity, price: 10000,
        expiresAt: new Date(now.getTime() + 600_000), state: 'pending'
      }, now);
    });
    const reserves = await Promise.all([createOffer('first-offer', 2), createOffer('second-offer', 2)]);
    assert.equal(reserves.filter(Boolean).length, 1);
    const offer = await offers.findOne({ state: 'pending' });
    assert.ok(offer);
    assert.equal(await database.transaction(store => store.itemCount(1, 'referral_case', new Date())), 1);
    assert.equal(await database.transaction(store => store.removeItems(1, 'referral_case', 2, new Date())), false);
    await players.updateOne({ _id: 2 }, { $set: { kc: 1_000_000 } });
    const buy = () => database.transaction(async store => {
      const current = await store.itemOffer(offer._id);
      const buyer = await store.player(2);
      const seller = await store.player(1);
      assert.ok(current);
      assert.ok(buyer);
      assert.ok(seller);
      return store.purchaseOffer(current, buyer, seller, await store.now());
    });
    const results = await Promise.all(Array.from({ length: 8 }, buy));
    assert.equal(results.filter(value => value === 'ok').length, 1);
    assert.equal(results.filter(value => value === 'invalid').length, 7);
    assert.equal((await players.findOne({ _id: 2 }))?.kc, 990_000);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 160_000);
    assert.equal(await items.countDocuments({ vkId: 2 }), 2);
    assert.equal(await items.countDocuments({ vkId: 1 }), 1);
    assert.equal(await createOffer('expires', 1), true);
    const past = new Date(0);
    await offers.updateOne({ _id: 'expires' }, { $set: { expiresAt: past } });
    await items.updateMany({ offerId: 'expires' }, { $set: { reservedUntil: past } });
    assert.equal(await database.transaction(async store => store.itemCount(1, 'referral_case', await store.now())), 1);
    await assert.rejects(database.transaction(async store => {
      const player = await store.player(1);
      assert.ok(player);
      assert.equal(await store.openItems(player, 'referral_case', 1, { kc: 150000, euro: 0, counts: [1, 0, 0, 0, 0, 0] }, await store.now()), 'ok');
      throw new Error('Rollback after opening');
    }));
    assert.equal(await items.countDocuments({ vkId: 1 }), 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 160_000);
    await players.updateOne({ _id: 1 }, { $set: { kc: game.maxAmount } });
    assert.equal(await database.transaction(async store => {
      const player = await store.player(1);
      assert.ok(player);
      return store.openItems(player, 'referral_case', 1, { kc: 150000, euro: 0, counts: [1, 0, 0, 0, 0, 0] }, await store.now());
    }), 'limit');
    assert.equal(await items.countDocuments({ vkId: 1 }), 1);
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
