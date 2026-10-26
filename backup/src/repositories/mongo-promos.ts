import type { ClientSession, Db } from 'mongodb';
import { game } from '../config/game.js';
import { promoRedemptionId, promoTotal, validatePromo } from '../services/promo-rules.js';
import type { Player } from '../types/game.js';
import type { Promo, PromoActivation, PromoCreation, PromoDraft, PromoRedemption } from '../types/promo.js';

export class MongoPromoStore {
  private readonly promoPlayers;
  private readonly promoCodes;
  private readonly promoRedemptions;

  constructor(db: Db, private readonly promoSession: ClientSession) {
    this.promoPlayers = db.collection<Player>('players');
    this.promoCodes = db.collection<Promo>('promos');
    this.promoRedemptions = db.collection<PromoRedemption>('promo_redemptions');
  }

  async setPromoDraft(vkId: number, draft: PromoDraft | null): Promise<void> {
    const result = await this.promoPlayers.updateOne(
      { _id: vkId }, draft === null ? { $unset: { promoDraft: '' } } : { $set: { promoDraft: draft } },
      { session: this.promoSession }
    );
    if (result.matchedCount !== 1) {
      throw new Error('Promo owner was not found');
    }
  }

  async promo(name: string): Promise<Promo | null> {
    const value = await this.promoCodes.findOne({ _id: name }, { session: this.promoSession, collation: { locale: 'simple' } });
    if (value !== null) {
      validatePromo(value);
    }
    return value;
  }

  async promos(vkId: number, after: string | null): Promise<Promo[]> {
    const values = await this.promoCodes.find(
      { ownerId: vkId, ...(after === null ? {} : { _id: { $gt: after } }) },
      { session: this.promoSession, collation: { locale: 'simple' } }
    ).sort({ _id: 1 }).limit(game.promo.pageSize + 1).toArray();
    for (const value of values) {
      validatePromo(value);
    }
    return values;
  }

  async createPromo(player: Player, promo: Promo): Promise<PromoCreation> {
    validatePromo(promo);
    const total = promoTotal(promo.amount, promo.quantity);
    if (promo.ownerId !== player._id || promo.remaining !== promo.quantity || total === null) {
      throw new Error('Invalid promo funding');
    }
    if (await this.promo(promo._id) !== null) {
      return 'exists';
    }
    const debit = await this.promoPlayers.updateOne(
      { _id: player._id, [promo.currency]: { $gte: total, $lte: game.maxAmount } },
      { $inc: { [promo.currency]: -total } }, { session: this.promoSession }
    );
    if (debit.matchedCount !== 1) {
      return 'funds';
    }
    const result = await this.promoCodes.insertOne(promo, { session: this.promoSession });
    if (!result.acknowledged) {
      throw new Error('Promo creation was not acknowledged');
    }
    return 'created';
  }

  async activatePromo(player: Player, promo: Promo): Promise<PromoActivation> {
    validatePromo(promo);
    if (promo.ownerId === player._id) {
      return 'own';
    }
    const _id = promoRedemptionId(promo._id, player._id);
    if (await this.promoRedemptions.findOne({ _id }, { session: this.promoSession }) !== null) {
      return 'already';
    }
    if (promo.remaining === 0) {
      return 'empty';
    }
    const credit = await this.promoPlayers.updateOne(
      { _id: player._id, [promo.currency]: { $gte: 0, $lte: game.maxAmount - promo.amount } },
      { $inc: { [promo.currency]: promo.amount } }, { session: this.promoSession }
    );
    if (credit.matchedCount !== 1) {
      return 'balance_limit';
    }
    const used = await this.promoCodes.updateOne(
      { _id: promo._id, ownerId: { $ne: player._id }, remaining: { $gt: 0 } },
      { $inc: { remaining: -1 } }, { session: this.promoSession, collation: { locale: 'simple' } }
    );
    if (used.matchedCount !== 1) {
      throw new Error('Promo activation conflict');
    }
    const receipt = await this.promoRedemptions.insertOne({ _id, promoName: promo._id, vkId: player._id }, { session: this.promoSession });
    if (!receipt.acknowledged) {
      throw new Error('Promo activation was not acknowledged');
    }
    return 'redeemed';
  }
}
