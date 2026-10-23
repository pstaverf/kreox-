import { randomInt } from 'node:crypto';
import { MongoBulkWriteError, MongoClient, MongoServerError, type ClientSession, type Db, type WriteError } from 'mongodb';
import { accountCapacity, game } from '../config/game.js';
import type { Counter, GameInput, InventoryItem, MiningFarm, Notification, Player, PreparedReply, RankedPlayer, Ranking, RankingMetric, ProcessedMessage, Reply, Reward } from '../types/game.js';
import { DuplicateWriteError, type GameDatabase, type GameStore } from '../types/storage.js';
import { availableAccountIds } from '../services/rules.js';
import { initialFarm } from '../services/mining.js';
import { rankingFields, rankingScore } from '../services/rankings.js';
import { isRecord } from '../utils/validation.js';

export class MongoGameDatabase implements GameDatabase {
  private readonly db: Db;

  constructor(private readonly client: MongoClient, database: string) {
    this.db = client.db(database);
  }

  async initialize(): Promise<void> {
    const hello: unknown = await this.db.command({ hello: 1 });
    if (!isRecord(hello) || (typeof hello.setName !== 'string' && hello.msg !== 'isdbgrid')) {
      throw new Error('MongoDB replica set is required');
    }
    await this.db.collection<Player>('players').createIndex({ accountId: 1 }, { unique: true });
    await this.db.collection<InventoryItem>('inventory').createIndex({ vkId: 1, itemId: 1 }, { unique: true });
    await this.db.collection<ProcessedMessage>('processed_messages').createIndex({ _id: 1 });
    await this.db.collection<Notification>('notifications').createIndex({ state: 1, nextAttemptAt: 1 });
    await this.db.collection<Player>('players').createIndexes(Object.entries(rankingFields).map(([metric, field]) => ({
      key: { [field]: -1 as const, accountId: 1 as const }, name: `ranking_${metric}`
    })));
    const migration = await this.db.collection<Player>('players').updateMany({ $or: [
      { mining: { $exists: false } }, { referrals: { $exists: false } }, { stolenKC: { $exists: false } }
    ] }, [{ $set: {
      mining: { $ifNull: ['$mining', { $literal: initialFarm() }] },
      referrals: { $ifNull: ['$referrals', 0] },
      stolenKC: { $ifNull: ['$stolenKC', 0] }
    } }]);
    if (!migration.acknowledged || migration.modifiedCount !== migration.matchedCount) {
      throw new Error('Player migration failed');
    }
    const ids = ['registrations', 'responses'] as const;
    const result = await this.db.collection<Counter>('counters').bulkWrite(ids.map(_id => ({
      updateOne: { filter: { _id }, update: { $setOnInsert: { value: 0 } }, upsert: true }
    })), { ordered: false }).catch((error: unknown) => {
      if (error instanceof MongoBulkWriteError && error.err === undefined) {
        const writes: readonly WriteError[] = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
        if (writes.length > 0 && writes.every(write => write.code === 11000)) {
          return null;
        }
      }
      throw error;
    });
    if (result !== null && result.matchedCount + result.upsertedCount !== ids.length) {
      throw new Error('Counter initialization failed');
    }
    if (result === null && await this.db.collection<Counter>('counters').countDocuments(
      { _id: { $in: [...ids] } }, { limit: ids.length }
    ) !== ids.length) {
      throw new Error('Concurrent counter initialization failed');
    }
  }


  async leaseNotification(leaseId: string): Promise<Notification | null> {
    return this.db.collection<Notification>('notifications').findOneAndUpdate(
      { state: 'pending', $expr: { $lte: ['$nextAttemptAt', '$$NOW'] } },
      [{ $set: {
        leaseId,
        nextAttemptAt: { $add: ['$$NOW', game.notificationLeaseMs] },
        attempts: { $add: ['$attempts', 1] }
      } }],
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after', includeResultMetadata: false }
    );
  }

  async finishNotification(id: string, leaseId: string, state: 'sent' | 'failed' | 'pending', delayMs: number): Promise<void> {
    const result = await this.db.collection<Notification>('notifications').updateOne(
      { _id: id, state: 'pending', leaseId },
      [{ $set: { state, nextAttemptAt: { $add: ['$$NOW', delayMs] } } }, { $unset: 'leaseId' }]
    );
    if (result.matchedCount !== 1) {
      throw new Error('Notification lease was lost');
    }
  }

  async hasPlayer(vkId: number): Promise<boolean> {
    return await this.db.collection<Player>('players').findOne(
      { _id: vkId }, { projection: { _id: 1 } }
    ) !== null;
  }

  async transaction<T>(action: (store: GameStore) => Promise<T>): Promise<T> {
    try {
      return await this.client.withSession(async session => session.withTransaction(
        async () => action(new MongoGameStore(this.db, session)),
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', timeoutMS: 20_000 }
      ));
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new DuplicateWriteError();
      }
      throw error;
    }
  }
}

class MongoGameStore implements GameStore {
  private readonly players;
  private readonly items;
  private readonly messages;
  private readonly counters;
  private readonly notifications;

  constructor(db: Db, private readonly session: ClientSession) {
    this.players = db.collection<Player>('players');
    this.items = db.collection<InventoryItem>('inventory');
    this.messages = db.collection<ProcessedMessage>('processed_messages');
    this.counters = db.collection<Counter>('counters');
    this.notifications = db.collection<Notification>('notifications');
  }

  async processed(eventId: string): Promise<ProcessedMessage | null> {
    return this.messages.findOne({ _id: eventId }, { session: this.session });
  }

  private async nextRandomId(): Promise<number> {
    const counter = await this.counters.findOneAndUpdate(
      { _id: 'responses', value: { $gte: 0, $lt: game.maxRandomId } },
      { $inc: { value: 1 } },
      { session: this.session, returnDocument: 'after', includeResultMetadata: false }
    );
    if (counter === null) {
      throw new Error('Response ID range is exhausted');
    }
    return counter.value;
  }

  async remember(input: GameInput, reply: Reply): Promise<PreparedReply> {
    const prepared = { ...reply, randomId: await this.nextRandomId() };
    const result = await this.messages.insertOne(
      { _id: input.eventId, vkId: input.vkId, reply: prepared }, { session: this.session }
    );
    if (!result.acknowledged) {
      throw new Error('Message record was not acknowledged');
    }
    return prepared;
  }

  async player(vkId: number): Promise<Player | null> {
    return this.players.findOne({ _id: vkId }, { session: this.session });
  }

  async register(vkId: number, name: string): Promise<Player | null> {
    const counter = await this.counters.findOneAndUpdate(
      { _id: 'registrations', value: { $gte: 0, $lt: accountCapacity } },
      { $inc: { value: 1 } },
      { session: this.session, returnDocument: 'before', includeResultMetadata: false }
    );
    if (counter === null) {
      return null;
    }
    let accountId = counter.value;
    if (accountId >= game.sequentialAccounts) {
      const taken = await this.players.find(
        { accountId: { $gte: game.randomAccountMin, $lte: game.randomAccountMax } },
        { session: this.session, projection: { accountId: 1, _id: 0 } }
      ).limit(accountCapacity).toArray();
      const available = availableAccountIds(taken.map(player => player.accountId));
      const selected = available.length > 0 ? available[randomInt(available.length)] : undefined;
      if (selected === undefined) {
        throw new Error('Account counter is inconsistent');
      }
      accountId = selected;
    }
    const player: Player = {
      _id: vkId,
      accountId,
      name,
      kc: 0,
      euro: 0,
      bitcoin: 0,
      reputation: 0,
      completedTasks: 0,
      bonusDay: 0,
      lastBonusAt: null,
      nextBonusAt: new Date(0),
      nextItemId: 1,
      mining: initialFarm(),
      referrals: 0,
      stolenKC: 0
    };
    const result = await this.players.insertOne(player, { session: this.session });
    if (!result.acknowledged) {
      throw new Error('Registration was not acknowledged');
    }
    return player;
  }

  async now(): Promise<Date> {
    const value = await this.counters.aggregate<{ now: Date }>([
      { $match: { _id: 'registrations' } },
      { $project: { _id: 0, now: '$$NOW' } },
      { $limit: 1 }
    ], { session: this.session }).next();
    if (value === null || !(value.now instanceof Date) || !Number.isFinite(value.now.getTime())) {
      throw new Error('Database time is unavailable');
    }
    return value.now;
  }

  async claim(player: Player, day: number, reward: Reward, now: Date): Promise<boolean> {
    const updated = await this.players.findOneAndUpdate(
      {
        _id: player._id,
        bonusDay: player.bonusDay,
        lastBonusAt: player.lastBonusAt,
        nextBonusAt: { $lte: now },
        kc: { $gte: 0, $lte: game.maxAmount - reward.kc },
        bitcoin: { $gte: 0, $lte: game.maxAmount - reward.bitcoin },
        nextItemId: { $gte: 1, $lte: game.maxAmount - (reward.case ? 1 : 0) }
      },
      {
        $inc: { kc: reward.kc, bitcoin: reward.bitcoin, nextItemId: reward.case ? 1 : 0 },
        $set: { bonusDay: day, lastBonusAt: now, nextBonusAt: new Date(now.getTime() + game.bonusIntervalMs) }
      },
      { session: this.session, returnDocument: 'after', includeResultMetadata: false, projection: { _id: 1 } }
    );
    if (updated === null) {
      return false;
    }
    if (reward.case) {
      const result = await this.items.insertOne({
        _id: `${player._id}:${player.nextItemId}`,
        vkId: player._id,
        itemId: player.nextItemId,
        kind: 'zhdun_case'
      }, { session: this.session });
      if (!result.acknowledged) {
        throw new Error('Inventory insert was not acknowledged');
      }
    }
    return true;
  }

  async inventory(vkId: number, page: number): Promise<InventoryItem[]> {
    return this.items.find(
      { vkId, itemId: { $gt: page * game.inventoryPageSize } },
      { session: this.session, projection: { _id: 1, vkId: 1, itemId: 1, kind: 1 } }
    ).sort({ itemId: 1 }).limit(game.inventoryPageSize + 1).toArray();
  }

  async inventoryAll(vkId: number): Promise<InventoryItem[]> {
    return this.items.find({ vkId }, { session: this.session })
      .sort({ itemId: 1 }).limit(game.chatInventoryLimit + 1).toArray();
  }

  async saveMining(player: Player, farm: MiningFarm, bitcoinDelta: number): Promise<boolean> {
    const result = await this.players.updateOne({
      _id: player._id,
      mining: player.mining ?? { $exists: false },
      bitcoin: { $gte: Math.max(0, -bitcoinDelta), $lte: game.maxAmount - Math.max(0, bitcoinDelta) }
    }, { $set: { mining: farm }, $inc: { bitcoin: bitcoinDelta } }, { session: this.session });
    return result.matchedCount === 1;
  }

  async ranking(metric: RankingMetric, player: Player): Promise<Ranking> {
    const field = rankingFields[metric];
    const score = rankingScore(player, metric);
    const leaders = await this.players.find<RankedPlayer>({}, {
      session: this.session, projection: { _id: 1, name: 1, accountId: 1, [field]: 1 }
    }).sort({ [field]: -1, accountId: 1 }).limit(game.leaderboardSize).toArray();
    const ahead = await this.players.countDocuments({ $or: [
      { [field]: { $gt: score } }, { [field]: score, accountId: { $lt: player.accountId } }
    ] }, { session: this.session });
    return {
      leaders: leaders.map(leader => ({
        _id: leader._id, name: leader.name, accountId: leader.accountId, score: rankingScore(leader, metric)
      })),
      place: ahead + 1
    };
  }

  async saveReferralUrl(vkId: number, url: string): Promise<void> {
    const result = await this.players.updateOne({ _id: vkId }, { $set: { referralUrl: url } }, { session: this.session });
    if (result.matchedCount !== 1) {
      throw new Error('Referral link owner was not found');
    }
  }

  async rewardReferral(inviter: Player, newcomer: Player, text: string): Promise<void> {
    if (inviter._id === newcomer._id) {
      throw new Error('Self referral is not allowed');
    }
    const result = await this.players.updateOne({
      _id: inviter._id,
      kc: { $gte: 0, $lte: game.maxAmount - game.referralRewardKC },
      referrals: { $gte: 0, $lt: game.maxAmount },
      nextItemId: { $eq: inviter.nextItemId, $gte: 1, $lt: game.maxAmount }
    }, { $inc: { kc: game.referralRewardKC, referrals: 1, nextItemId: 1 } }, { session: this.session });
    if (result.matchedCount !== 1) {
      throw new Error('Referral reward limits exceeded');
    }
    const item = await this.items.insertOne({
      _id: `${inviter._id}:${inviter.nextItemId}`, vkId: inviter._id,
      itemId: inviter.nextItemId, kind: 'referral_case'
    }, { session: this.session });
    const notification = await this.notifications.insertOne({
      _id: `referral:${newcomer._id}`, peerId: inviter._id, text,
      randomId: await this.nextRandomId(), state: 'pending', nextAttemptAt: new Date(0), attempts: 0
    }, { session: this.session });
    if (!item.acknowledged || !notification.acknowledged) {
      throw new Error('Referral reward was not acknowledged');
    }
  }

}
