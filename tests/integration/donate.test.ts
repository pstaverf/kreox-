import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { donateConfig } from '../../src/config/donate.js';
import { game } from '../../src/config/game.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { donateTexts } from '../../src/services/donate-texts.js';
import type { DealerState } from '../../src/types/donate.js';
import type { Command, Notification, Player } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: donate purchases, theft races, global dealer cooldown, payout and rollback', {
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
    await database.initialize();
    const service = new GameService(database, undefined, undefined, undefined, (_purpose, maximum) => maximum - 1);
    let index = 0;
    const send = (command: Command, id = 1, eventId = `donate-${index++}`, isChat = false) => service.handle({
      eventId, vkId: id, command, isChat
    }, async () => 'Игрок', async () => [1, 2]);
    const players = db.collection<Player>('players');
    const dealers = db.collection<DealerState>('dealer');
    for (const id of [1, 2, 3]) await send({ kind: 'profile' }, id);
    await players.updateMany({}, { $set: { euro: 100_000 } });
    await send({ kind: 'donate_nick' });
    await service.handle({ eventId: 'nickname-text', vkId: 1, command: { kind: 'development' }, text: 'Новый ник' }, async () => 'Игрок');
    const nickname = { kind: 'donate_confirm', token: 'nickname-text' } as const;
    await Promise.all(Array.from({ length: 8 }, () => send(nickname, 1, 'same-rename')));
    assert.equal((await players.findOne({ _id: 1 }))?.name, 'Новый ник');
    assert.equal((await players.findOne({ _id: 1 }))?.euro, 95_000);
    const subscribe = await send({ kind: 'donate_thief' });
    assert.ok(subscribe.keyboard.kind === 'donate_confirmation');
    const subscribeToken = subscribe.keyboard.token;
    await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'donate_confirm', token: subscribeToken })));
    assert.equal((await players.findOne({ _id: 1 }))?.euro, 75_000);
    await players.updateOne({ _id: 2 }, { $set: { kc: 12345 } });
    const thefts = await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'theft' }, 1, undefined, true)));
    assert.equal(thefts.filter(reply => reply.text.includes('украл у игрока')).length, 1);
    assert.equal((await players.findOne({ _id: 1 }))?.kc, 12300);
    assert.equal((await players.findOne({ _id: 2 }))?.kc, 45);
    assert.equal(await db.collection<Notification>('notifications').countDocuments({ _id: /^theft:/ }), 1);
    const purchases = await Promise.all([send({ kind: 'dealer_buy' }, 1), send({ kind: 'dealer_buy' }, 2)]);
    assert.equal(purchases.filter(reply => reply.text.includes('вы успешно стали')).length, 1);
    const state = await database.transaction(store => store.dealer());
    assert.ok(state.holderId !== null);
    const buyerId = state.holderId === 1 ? 2 : 1;
    assert.match((await send({ kind: 'dealer_buy' }, buyerId)).text, /Подождите еще/);
    await database.transaction(async store => { assert.equal(await store.grantItems(buyerId, 'croupier', 1), true); });
    await dealers.updateOne({ _id: 'casino' }, { $set: { earnedKC: 32100 } });
    const previous = await players.findOne({ _id: state.holderId });
    assert.ok(previous);
    const takeover = await send({ kind: 'dealer_buy' }, buyerId, 'takeover-once');
    assert.match(takeover.text, /вы успешно стали/);
    await send({ kind: 'dealer_buy' }, buyerId, 'takeover-once');
    assert.equal((await players.findOne({ _id: previous._id }))?.kc, previous.kc + 32100);
    assert.equal((await dealers.findOne({ _id: 'casino' }))?.earnedKC, 0);
    assert.equal(await db.collection<Notification>('notifications').countDocuments({ _id: 'dealer:takeover-once' }), 1);
    await database.initialize();
    assert.equal((await dealers.findOne({ _id: 'casino' }))?.holderId, buyerId);
    await dealers.updateOne({ _id: 'casino' }, { $set: { earnedKC: 100, nextChangeAt: new Date(0) } });
    const before = await players.findOne({ _id: 3 });
    await assert.rejects(database.transaction(async store => {
      const buyer = await store.player(3);
      const holder = await store.player(buyerId);
      assert.ok(buyer);
      assert.ok(holder);
      assert.equal(await store.buyDealer(buyer, holder, await store.dealer(), await store.now()), 'ok');
      throw new Error('Rollback after dealer payout');
    }));
    assert.deepEqual(await players.findOne({ _id: 3 }), before);
    assert.equal((await dealers.findOne({ _id: 'casino' }))?.earnedKC, 100);
    await players.updateOne({ _id: buyerId }, { $set: { kc: game.maxAmount } });
    assert.equal((await send({ kind: 'dealer_buy' }, 3)).text, donateTexts.limit);
    assert.equal((await players.findOne({ _id: 3 }))?.euro, before?.euro);
    const actor = await players.findOne({ _id: 1 });
    assert.ok(actor?.thiefUntil);
    assert.ok(actor.nextTheftAt);
    assert.equal(actor.nextTheftAt.getTime() - donateConfig.theftCooldownMs < actor.thiefUntil.getTime(), true);
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});
