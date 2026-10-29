import { roundKc } from '../services/kc-money.js';
import type { ClientSession, Db } from 'mongodb';
import { donateConfig } from '../config/donate.js';
import { game } from '../config/game.js';
import { validDonateMoney, validNickname } from '../services/donate-rules.js';
import type { DealerPurchase, DealerState, DonateDraft, DonatePurchase } from '../types/donate.js';
import type { InventoryItem, Player } from '../types/game.js';
import { MongoItemStore } from './mongo-items.js';

export class MongoDonateStore extends MongoItemStore {
  private readonly donatePlayers;
  private readonly donateItems;
  private readonly dealers;
  constructor(db: Db, private readonly donateSession: ClientSession) {
    super(db, donateSession);
    this.donatePlayers = db.collection<Player>('players');
    this.donateItems = db.collection<InventoryItem>('inventory');
    this.dealers = db.collection<DealerState>('dealer');
  }
  async setDonateDraft(vkId: number, draft: DonateDraft | null): Promise<void> {
    const result = await this.donatePlayers.updateOne({ _id: vkId }, draft === null ? { $unset: { donateDraft: '' } } : { $set: { donateDraft: draft } }, { session: this.donateSession });
    if (result.matchedCount !== 1) throw new Error('Missing donate actor');
  }
  async changeNickname(player: Player, nickname: string): Promise<DonatePurchase> {
    if (!validNickname(nickname)) throw new Error('Invalid nickname');
    if (!validDonateMoney(player.euro)) return 'limit';
    const result = await this.donatePlayers.updateOne({ _id: player._id, euro: { $gte: donateConfig.nicknameCost, $lte: game.maxAmount }, $expr: { $eq: ['$euro', { $trunc: '$euro' }] } }, {
      $inc: { euro: -donateConfig.nicknameCost }, $set: { name: nickname }, $unset: { donateDraft: '' }
    }, { session: this.donateSession });
    return result.matchedCount === 1 ? 'ok' : 'funds';
  }
  async buyThief(player: Player, now: Date): Promise<DonatePurchase | 'active'> {
    if (player.thiefUntil !== undefined && player.thiefUntil > now) return 'active';
    if (!validDonateMoney(player.euro)) return 'limit';
    const result = await this.donatePlayers.updateOne({
      _id: player._id, euro: { $gte: donateConfig.subscriptionCost, $lte: game.maxAmount },
      $expr: { $eq: ['$euro', { $trunc: '$euro' }] },
      $or: [{ thiefUntil: { $exists: false } }, { thiefUntil: { $lte: now } }]
    }, { $inc: { euro: -donateConfig.subscriptionCost }, $set: { thiefUntil: new Date(now.getTime() + donateConfig.subscriptionMs) }, $unset: { donateDraft: '' } }, { session: this.donateSession });
    return result.matchedCount === 1 ? 'ok' : 'funds';
  }
  async theftTargetCount(actorId: number, memberIds: readonly number[]): Promise<number> {
    return this.donatePlayers.countDocuments({ _id: { $in: [...memberIds], $ne: actorId } }, { session: this.donateSession });
  }
  async theftTarget(actorId: number, memberIds: readonly number[], offset: number): Promise<Player | null> {
    return this.donatePlayers.find({ _id: { $in: [...memberIds], $ne: actorId } }, { session: this.donateSession }).sort({ _id: 1 }).skip(offset).limit(1).next();
  }
  async steal(actor: Player, victim: Player, amount: number, now: Date): Promise<boolean> {
    if (actor._id === victim._id || !Number.isSafeInteger(amount) || amount < 0 || amount > game.maxAmount || amount % game.kcScale !== 0) throw new Error('Invalid theft');
    if (!validDonateMoney(actor.kc) || !validDonateMoney(actor.stolenKC ?? 0) || !validDonateMoney(victim.kc)) return false;
    if (actor.kc > game.maxAmount - amount || (actor.stolenKC ?? 0) > game.maxAmount - amount) return false;
    const credit = await this.donatePlayers.updateOne({
      _id: actor._id, thiefUntil: { $gt: now },
      $expr: { $and: [
        { $eq: ['$kc', { $trunc: '$kc' }] },
        { $eq: [{ $ifNull: ['$stolenKC', 0] }, { $trunc: { $ifNull: ['$stolenKC', 0] } }] }
      ] },
      $and: [{ $or: [{ nextTheftAt: { $exists: false } }, { nextTheftAt: { $lte: now } }] },
        { $or: [{ stolenKC: { $exists: false } }, { stolenKC: { $gte: 0, $lte: game.maxAmount - amount } }] }],
      kc: { $gte: 0, $lte: game.maxAmount - amount }
    }, { $inc: { kc: amount, stolenKC: amount }, $set: { nextTheftAt: new Date(now.getTime() + donateConfig.theftCooldownMs) } }, { session: this.donateSession });
    if (credit.matchedCount !== 1) return false;
    const debit = await this.donatePlayers.updateOne({ _id: victim._id, kc: { $gte: amount, $lte: game.maxAmount }, $expr: { $eq: ['$kc', { $trunc: '$kc' }] } }, { $inc: { kc: -amount } }, { session: this.donateSession });
    if (debit.matchedCount !== 1) throw new Error('Theft conflict');
    return true;
  }
  async dealer(): Promise<DealerState> {
    const state = await this.dealers.findOne({ _id: 'casino' }, { session: this.donateSession });
    if (state === null || !Number.isSafeInteger(state.earnedKC) || state.earnedKC < 0 || state.earnedKC > game.maxAmount || !(state.nextChangeAt instanceof Date) || !Number.isFinite(state.nextChangeAt.getTime()) || (state.holderId !== null && (!Number.isSafeInteger(state.holderId) || state.holderId <= 0))) throw new Error('Invalid dealer state');
    return state;
  }
  async hasCroupier(vkId: number): Promise<boolean> {
    return await this.donateItems.findOne({ vkId, kind: 'croupier' }, { session: this.donateSession, projection: { _id: 1 } }) !== null;
  }
  async buyDealer(player: Player, previous: Player | null, state: DealerState, now: Date): Promise<DealerPurchase> {
    const income = roundKc(state.earnedKC);
    if (state.holderId === player._id) return 'self';
    if (state.holderId === null && previous !== null) return 'limit';
    if (!validDonateMoney(player.euro) || !validDonateMoney(state.earnedKC) || (previous !== null && !validDonateMoney(previous.kc))) return 'limit';
    if (state.nextChangeAt > now && !await this.hasCroupier(player._id)) return 'cooldown';
    if (state.holderId !== null && (previous === null || previous._id !== state.holderId || previous.kc > game.maxAmount - income)) return 'limit';
    const debit = await this.donatePlayers.updateOne({ _id: player._id, euro: { $gte: donateConfig.dealerCost, $lte: game.maxAmount }, $expr: { $eq: ['$euro', { $trunc: '$euro' }] } }, { $inc: { euro: -donateConfig.dealerCost }, $unset: { donateDraft: '' } }, { session: this.donateSession });
    if (debit.matchedCount !== 1) return 'funds';
    if (previous !== null) {
      const credit = await this.donatePlayers.updateOne({ _id: previous._id, kc: { $gte: 0, $lte: game.maxAmount - income }, $expr: { $eq: ['$kc', { $trunc: '$kc' }] } }, { $inc: { kc: income } }, { session: this.donateSession });
      if (credit.matchedCount !== 1) throw new Error('Dealer payout conflict');
    }
    const changed = await this.dealers.updateOne({ _id: 'casino', holderId: state.holderId, earnedKC: state.earnedKC, nextChangeAt: state.nextChangeAt }, { $set: {
      holderId: player._id, earnedKC: 0, nextChangeAt: new Date(now.getTime() + donateConfig.dealerCooldownMs)
    } }, { session: this.donateSession });
    if (changed.matchedCount !== 1) throw new Error('Dealer change conflict');
    return 'ok';
  }
}
