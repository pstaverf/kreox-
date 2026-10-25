import { DuplicateWriteError } from '../types/storage.js';
import type { ClientSession, Db, Filter } from 'mongodb';
import { accountCapacity, game } from '../config/game.js';
import type { CasinoQuery, CasinoRecord, DirectorDraft } from '../types/casino.js';
import type { DealerState } from '../types/donate.js';
import type { Notification, Player } from '../types/game.js';
import { MongoBankStore } from './mongo-bank.js';

export class MongoCasinoStore extends MongoBankStore {
  private readonly casinoPlayers;
  private readonly records;
  private readonly notices;
  private readonly casinoDealers;
  constructor(db: Db, private readonly casinoSession: ClientSession) {
    super(db, casinoSession);
    this.casinoPlayers = db.collection<Player>('players');
    this.records = db.collection<CasinoRecord>('casino_records');
    this.notices = db.collection<Notification>('notifications');
    this.casinoDealers = db.collection<DealerState>('dealer');
  }
  async setDirectorDraft(vkId: number, draft: DirectorDraft | null): Promise<void> {
    const result = await this.casinoPlayers.updateOne({ _id: vkId }, draft === null ? { $unset: { directorDraft: '' } } : { $set: { directorDraft: draft } }, { session: this.casinoSession });
    if (result.matchedCount !== 1) throw new Error('Missing director actor');
  }
  async casinoGet(id: string): Promise<CasinoRecord | null> {
    return this.records.findOne({ _id: id }, { session: this.casinoSession });
  }
  async casinoList(query: CasinoQuery, limit: number): Promise<CasinoRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > accountCapacity) throw new Error('Invalid casino query bound');
    let filter: Filter<CasinoRecord>;
    switch (query.kind) {
      case 'roulette_photo': filter = { kind: 'round', mode: 'roulette', stage: { $in: ['open', 'closed', 'waiting', 'settling', 'announcing'] }, _id: { $gt: query.after } }; break;
      case 'round': filter = { kind: 'round', stage: { $in: ['open', 'closed', 'waiting', 'settling', 'announcing'] }, dueAt: { $lte: query.dueAt } }; break;
      case 'election': filter = { kind: 'election', stage: { $in: ['refunds', 'broadcast'] }, dueAt: { $lte: query.dueAt } }; break;
      case 'credit': filter = { kind: 'credit', stage: 'pending', dueAt: { $lte: query.dueAt } }; break;
      case 'delivery': filter = { kind: 'delivery', stage: 'pending', dueAt: { $lte: query.dueAt } }; break;
      case 'bet': filter = { kind: 'bet', roundId: query.roundId, ...(query.vkId === undefined ? {} : { vkId: query.vkId }), ...(query.settled === undefined ? {} : { settled: query.settled }) }; break;
      case 'bid': filter = { kind: 'bid', electionId: query.electionId, ...(query.settled === undefined ? {} : { settled: query.settled }) }; break;
      case 'chat': filter = { kind: 'chat', active: true, _id: { $gt: query.after } }; break;
    }
    return this.records.find(filter, { session: this.casinoSession }).sort(query.kind === 'bet' || query.kind === 'bid' || query.kind === 'chat' || query.kind === 'roulette_photo' ? { _id: 1 } : { dueAt: 1, _id: 1 }).limit(limit).toArray();
  }
  async casinoInsert(record: CasinoRecord): Promise<void> {
    if (record.version !== 0) throw new Error('Invalid initial casino version');
    if (!(await this.records.insertOne(record, { session: this.casinoSession })).acknowledged) throw new Error('Casino insert failed');
  }
  async casinoSave(record: CasinoRecord, notAfter?: Date): Promise<void> {
    if (!Number.isSafeInteger(record.version) || record.version < 0 || record.version >= game.maxAmount) throw new Error('Invalid casino revision');
    if (notAfter !== undefined && !Number.isFinite(notAfter.getTime())) throw new Error('Invalid casino deadline');
    const result = await this.records.replaceOne({ _id: record._id, kind: record.kind, version: record.version, ...(notAfter === undefined ? {} : { $expr: { $lt: ['$$NOW', notAfter] } }) }, { ...record, version: record.version + 1 }, { session: this.casinoSession });
    if (result.matchedCount !== 1) throw new DuplicateWriteError();
    record.version += 1;
  }
  async casinoNotificationDone(id: string): Promise<boolean> {
    return await this.notices.findOne({ _id: id, state: { $in: ['sent', 'failed'] } }, { session: this.casinoSession, projection: { _id: 1 } }) !== null;
  }
  async casinoDealerIncome(vkId: number, amount: number): Promise<boolean> {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > game.maxAmount) throw new Error('Invalid casino income');
    const result = await this.casinoDealers.updateOne({ _id: 'casino', holderId: vkId, earnedKC: { $gte: 0, $lte: game.maxAmount - amount }, $expr: { $eq: ['$earnedKC', { $trunc: '$earnedKC' }] } }, { $inc: { earnedKC: amount } }, { session: this.casinoSession });
    return result.matchedCount === 1;
  }
}
