import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { game } from '../../src/config/game.js';
import { MongoGameDatabase } from '../../src/repositories/mongo.js';
import { GameService } from '../../src/services/game.js';
import { texts } from '../../src/services/texts.js';
import type { Counter, InventoryItem, MiningFarm, Notification, Player, RankingMetric } from '../../src/types/game.js';

const uri = process.env.MONGODB_TEST_URI;

test('MongoDB replica set: mining, referral rewards, rankings, migration and notification leases', {
  skip: uri === undefined ? 'Set MONGODB_TEST_URI to a test replica set' : false,
  timeout: 120_000
}, async context => {
  if (uri === undefined) {
    throw new Error('Test MongoDB URI is missing');
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const name = `kreox_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  try {
    await client.connect();
    const players = db.collection<Player>('players');
    const legacy: Player = {
      _id: 90, accountId: 0, name: 'Старый игрок', kc: 12345, euro: 0, bitcoin: 0,
      reputation: 0, completedTasks: 0, bonusDay: 0, lastBonusAt: null,
      nextBonusAt: new Date(0), nextItemId: 1
    };
    assert.ok((await players.insertOne(legacy)).acknowledged);
    assert.ok((await db.collection<Counter>('counters').insertOne({ _id: 'registrations', value: 1 })).acknowledged);
    const database = new MongoGameDatabase(client, name);
    await database.initialize();
    const service = new GameService(database);
    const getPlayer = async (id = 1): Promise<Player> => {
      const player = await players.findOne({ _id: id });
      assert.ok(player);
      return player;
    };
    const getFarm = async (): Promise<MiningFarm> => {
      const player = await getPlayer();
      assert.ok(player.mining);
      return player.mining;
    };
    await context.test('legacy defaults are initialized without changing balances or IDs', async () => {
      const migrated = await getPlayer(90);
      assert.equal(migrated.kc, legacy.kc);
      assert.equal(migrated.accountId, 0);
      assert.equal(migrated.mining?.rate, game.mining.initialRate);
      assert.equal(migrated.referrals, 0);
      assert.equal(migrated.stolenKC, 0);
      await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Пригласивший');
    });
    await context.test('concurrent first registration grants exactly one referral reward and notification', async () => {
      const input = { eventId: 'referral-2', vkId: 2, referrerId: 1, command: { kind: 'profile' } } as const;
      const replies = await Promise.all(Array.from({ length: 8 }, () => service.handle(input, async () => 'Друг')));
      assert.ok(replies.every(reply => reply.text === texts.welcome));
      const inviter = await getPlayer();
      assert.equal(inviter.kc, game.referralRewardKC);
      assert.equal(inviter.referrals, 1);
      assert.equal(inviter.nextItemId, 2);
      assert.equal(await db.collection<InventoryItem>('inventory').countDocuments({ vkId: 1, kind: 'referral_case' }), 1);
      assert.equal(await db.collection<Notification>('notifications').countDocuments({ _id: 'referral:2' }), 1);
      await service.handle({ ...input, eventId: 'already-registered' }, async () => 'Друг');
      assert.equal((await getPlayer()).referrals, 1);
    });
    await context.test('concurrent starts do not extend a running session', async () => {
      const replies = await Promise.all(Array.from({ length: 8 }, (_, index) => service.handle({
        eventId: `start-${index}`, vkId: 1, command: { kind: 'mining_start' }
      }, async () => 'Игрок')));
      assert.equal(replies.filter(reply => reply.text === texts.miningStarted).length, 1);
      const farm = await getFarm();
      assert.equal(farm.activeUntil.getTime() - farm.updatedAt.getTime(), game.mining.durationMs);
    });
    await context.test('concurrent confirmations charge once for an offered level', async () => {
      assert.equal((await players.updateOne({ _id: 1 }, { $set: { bitcoin: 150_000_000 } })).matchedCount, 1);
      const replies = await Promise.all(Array.from({ length: 8 }, (_, index) => service.handle({
        eventId: `upgrade-${index}`, vkId: 1, command: { kind: 'mining_confirm', level: 0 }
      }, async () => 'Игрок')));
      assert.equal(replies.filter(reply => reply.text.startsWith('✅')).length, 1);
      assert.equal((await getPlayer()).bitcoin, 149_800_000);
      const farm = await getFarm();
      assert.equal(farm.level, 1);
      assert.equal(farm.upgradeCost, 500_000);
    });
    await context.test('parallel withdrawals cannot credit the same mining balance twice', async () => {
      assert.equal((await players.updateOne({ _id: 1 }, { $set: {
        'mining.balance': 120_000_000, 'mining.activeUntil': new Date(0), 'mining.updatedAt': new Date(0), 'mining.remainder': 0
      } })).matchedCount, 1);
      const before = (await getPlayer()).bitcoin;
      const replies = await Promise.all(Array.from({ length: 8 }, (_, index) => service.handle({
        eventId: `withdraw-${index}`, vkId: 1, command: { kind: 'mining_withdraw' }
      }, async () => 'Игрок')));
      assert.equal(replies.filter(reply => reply.text.startsWith('✅')).length, 1);
      assert.equal((await getPlayer()).bitcoin, before + 120_000_000);
      assert.equal((await getFarm()).balance, 0);
    });
    await context.test('registration, reward, item and notification roll back if a later step fails', async () => {
      const before = await getPlayer();
      await assert.rejects(database.transaction(async store => {
        const inviter = await store.player(1);
        assert.ok(inviter);
        const newcomer = await store.register(3, 'Не зарегистрирован');
        assert.ok(newcomer);
        await store.rewardReferral(inviter, newcomer, 'Награда');
        throw new Error('Failure after all writes');
      }));
      assert.deepEqual(await getPlayer(), before);
      assert.equal(await players.findOne({ _id: 3 }), null);
      assert.equal(await db.collection<Notification>('notifications').findOne({ _id: 'referral:3' }), null);
      assert.equal(await db.collection<InventoryItem>('inventory').countDocuments({ vkId: 1 }), 1);
    });
    await context.test('notification leases exclude other workers and survive an interrupted send', async () => {
      const attempts = await Promise.all([database.leaseNotification('first'), database.leaseNotification('second')]);
      const leased = attempts.find(value => value !== null);
      assert.ok(leased);
      assert.equal(attempts.filter(value => value !== null).length, 1);
      assert.ok(leased.leaseId);
      await assert.rejects(database.finishNotification(leased._id, 'wrong-lease', 'sent', 0));
      await database.finishNotification(leased._id, leased.leaseId, 'pending', 0);
      const retry = await database.leaseNotification('retry');
      assert.ok(retry);
      assert.equal(retry.randomId, leased.randomId);
      assert.equal(retry.attempts, 2);
      await database.finishNotification(retry._id, 'retry', 'sent', 0);
      assert.equal(await database.leaseNotification('finished'), null);
    });
    await context.test('all ranking metrics return bounded results and a positive place', async () => {
      for (const metric of ['kc', 'bitcoin', 'euro', 'mining', 'referrals', 'reputation', 'stolenKC'] satisfies RankingMetric[]) {
        const result = await database.transaction(async store => {
          const player = await store.player(1);
          assert.ok(player);
          return store.ranking(metric, player);
        });
        assert.equal(result.leaders.length, 3);
        assert.ok(result.place >= 1 && result.place <= 3);
        assert.ok(result.leaders.every((leader, index) => index === 0
          || (result.leaders[index - 1]?.score ?? 0) >= leader.score));
      }
    });
    await context.test('repeated initialization never resets a farm or earned referral rewards', async () => {
      const before = await getPlayer();
      await database.initialize();
      assert.deepEqual(await getPlayer(), before);
    });
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  }
});
