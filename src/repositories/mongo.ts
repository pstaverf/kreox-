import { randomInt } from 'node:crypto';
import { MongoBulkWriteError, MongoClient, MongoServerError, type ClientSession, type Db, type WriteError } from 'mongodb';
import { accountCapacity, game } from '../config/game.js';
import type { Counter, GameInput, InventoryItem, Player, PreparedReply, ProcessedMessage, Reply, Reward } from '../types/game.js';
import { DuplicateWriteError, type GameDatabase, type GameStore } from '../types/storage.js';
import { availableAccountIds } from '../services/rules.js';
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

  constructor(db: Db, private readonly session: ClientSession) {
    this.players = db.collection<Player>('players');
    this.items = db.collection<InventoryItem>('inventory');
    this.messages = db.collection<ProcessedMessage>('processed_messages');
    this.counters = db.collection<Counter>('counters');
  }

  async processed(eventId: string): Promise<ProcessedMessage | null> {
    return this.messages.findOne({ _id: eventId }, { session: this.session });
  }

  async remember(input: GameInput, reply: Reply): Promise<PreparedReply> {
    const counter = await this.counters.findOneAndUpdate(
      { _id: 'responses', value: { $gte: 0, $lt: game.maxRandomId } },
      { $inc: { value: 1 } },
      { session: this.session, returnDocument: 'after', includeResultMetadata: false }
    );
    if (counter === null) {
      throw new Error('Response ID range is exhausted');
    }
    const prepared = { ...reply, randomId: counter.value };
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
      nextItemId: 1
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
}
