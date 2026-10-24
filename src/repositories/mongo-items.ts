import type { ClientSession, Db } from 'mongodb';
import { game } from '../config/game.js';
import type { InventoryItem, Player } from '../types/game.js';
import type { CaseRewards, ItemDraft, ItemKind, ItemOffer, ItemResult, PurchaseResult } from '../types/items.js';
import { isItemKind, validItemQuantity, validateOffer } from '../services/item-rules.js';
import { MongoPromoStore } from './mongo-promos.js';

export class MongoItemStore extends MongoPromoStore {
  private readonly itemPlayers;
  private readonly itemUnits;
  private readonly offers;
  constructor(db: Db, private readonly itemSession: ClientSession) {
    super(db, itemSession);
    this.itemPlayers = db.collection<Player>('players');
    this.itemUnits = db.collection<InventoryItem>('inventory');
    this.offers = db.collection<ItemOffer>('item_offers');
  }
  async playerByAccountId(accountId: number): Promise<Player | null> {
    return this.itemPlayers.findOne({ accountId }, { session: this.itemSession });
  }
  async ownedItem(vkId: number, itemId: number): Promise<InventoryItem | null> {
    return this.itemUnits.findOne({ vkId, itemId }, { session: this.itemSession });
  }
  private available(vkId: number, kind: ItemKind, now: Date) {
    if (!isItemKind(kind)) {
      throw new Error('Invalid item kind');
    }
    return { vkId, kind, $or: [{ reservedUntil: { $exists: false } }, { reservedUntil: { $lte: now } }] };
  }
  async itemCount(vkId: number, kind: ItemKind, now: Date): Promise<number> {
    return this.itemUnits.countDocuments(this.available(vkId, kind, now), { session: this.itemSession });
  }
  async setItemDraft(vkId: number, draft: ItemDraft | null): Promise<void> {
    const result = await this.itemPlayers.updateOne({ _id: vkId }, draft === null
      ? { $unset: { itemDraft: '' } } : { $set: { itemDraft: draft } }, { session: this.itemSession });
    if (result.matchedCount !== 1) {
      throw new Error('Item actor was not found');
    }
  }
  private async select(vkId: number, kind: ItemKind, quantity: number, now: Date): Promise<InventoryItem[]> {
    if (!validItemQuantity(quantity)) {
      throw new Error('Invalid item quantity');
    }
    return this.itemUnits.find(this.available(vkId, kind, now), { session: this.itemSession })
      .sort({ itemId: 1 }).limit(quantity).toArray();
  }
  async grantItems(vkId: number, kind: ItemKind, quantity: number): Promise<boolean> {
    if (!isItemKind(kind) || !validItemQuantity(quantity)) {
      throw new Error('Invalid item grant');
    }
    const player = await this.itemPlayers.findOneAndUpdate({
      _id: vkId, nextItemId: { $gte: 1, $lte: game.maxAmount - quantity },
      $expr: { $eq: ['$nextItemId', { $trunc: '$nextItemId' }] }
    }, { $inc: { nextItemId: quantity } }, { session: this.itemSession, returnDocument: 'before', includeResultMetadata: false });
    if (player === null) {
      return false;
    }
    await this.insertUnits(vkId, kind, quantity, player.nextItemId);
    return true;
  }
  private async insertUnits(vkId: number, kind: ItemKind, quantity: number, firstId: number): Promise<void> {
    const result = await this.itemUnits.insertMany(Array.from({ length: quantity }, (_, index) => ({
      _id: `${vkId}:${firstId + index}`, vkId, kind, itemId: firstId + index
    })), { session: this.itemSession });
    if (!result.acknowledged || result.insertedCount !== quantity) {
      throw new Error('Item insert failed');
    }
  }
  private async deleteUnits(units: InventoryItem[]): Promise<void> {
    const result = await this.itemUnits.deleteMany({ _id: { $in: units.map(unit => unit._id) } }, { session: this.itemSession });
    if (result.deletedCount !== units.length) {
      throw new Error('Item consumption conflict');
    }
  }
  async removeItems(vkId: number, kind: ItemKind, quantity: number, now: Date): Promise<boolean> {
    const units = await this.select(vkId, kind, quantity, now);
    if (units.length !== quantity) {
      return false;
    }
    await this.deleteUnits(units);
    return true;
  }
  async openItems(player: Player, kind: ItemKind, quantity: number, rewards: CaseRewards, now: Date): Promise<ItemResult> {
    if (![rewards.kc, rewards.euro].every(value => Number.isSafeInteger(value) && value >= 0 && value <= game.maxAmount)) {
      throw new Error('Invalid case rewards');
    }
    if (![player.kc, player.euro].every(value => Number.isSafeInteger(value) && value >= 0 && value <= game.maxAmount)) {
      return 'limit';
    }
    const units = await this.select(player._id, kind, quantity, now);
    if (units.length !== quantity) {
      return 'items';
    }
    const result = await this.itemPlayers.updateOne({
      _id: player._id, kc: { $gte: 0, $lte: game.maxAmount - rewards.kc }, euro: { $gte: 0, $lte: game.maxAmount - rewards.euro }
    }, { $inc: { kc: rewards.kc, euro: rewards.euro } }, { session: this.itemSession });
    if (result.matchedCount !== 1) {
      return 'limit';
    }
    await this.deleteUnits(units);
    return 'ok';
  }
  async giftItems(sender: Player, receiver: Player, kind: ItemKind, quantity: number, now: Date): Promise<ItemResult> {
    if (sender._id === receiver._id) {
      throw new Error('Self transfer');
    }
    const units = await this.select(sender._id, kind, quantity, now);
    if (units.length !== quantity) {
      return 'items';
    }
    if (!await this.grantItems(receiver._id, kind, quantity)) {
      return 'limit';
    }
    await this.deleteUnits(units);
    return 'ok';
  }
  async reserveOffer(offer: ItemOffer, now: Date): Promise<boolean> {
    validateOffer(offer);
    if (offer.state !== 'pending' || offer.expiresAt <= now) {
      throw new Error('Invalid offer reservation');
    }
    const units = await this.select(offer.sellerId, offer.itemKind, offer.quantity, now);
    if (units.length !== offer.quantity) {
      return false;
    }
    const result = await this.itemUnits.updateMany({ _id: { $in: units.map(unit => unit._id) } }, {
      $set: { reservedUntil: offer.expiresAt, offerId: offer._id }
    }, { session: this.itemSession });
    if (result.matchedCount !== offer.quantity) {
      throw new Error('Reservation conflict');
    }
    if (!(await this.offers.insertOne(offer, { session: this.itemSession })).acknowledged) {
      throw new Error('Offer insert failed');
    }
    return true;
  }
  async itemOffer(id: string): Promise<ItemOffer | null> {
    const offer = await this.offers.findOne({ _id: id }, { session: this.itemSession });
    if (offer !== null) {
      validateOffer(offer);
    }
    return offer;
  }
  async purchaseOffer(offer: ItemOffer, buyer: Player, seller: Player, now: Date): Promise<PurchaseResult> {
    validateOffer(offer);
    if (offer.buyerId !== buyer._id || offer.sellerId !== seller._id || offer.state !== 'pending') {
      return 'invalid';
    }
    if (offer.expiresAt <= now) {
      await this.offers.updateOne({ _id: offer._id, state: 'pending' }, { $set: { state: 'expired' } }, { session: this.itemSession });
      return 'expired';
    }
    const units = await this.itemUnits.find({
      vkId: seller._id, kind: offer.itemKind, offerId: offer._id, reservedUntil: { $gt: now }
    }, { session: this.itemSession }).limit(offer.quantity).toArray();
    if (units.length !== offer.quantity) {
      return 'items';
    }
    if (!Number.isSafeInteger(seller.kc) || seller.kc < 0 || seller.kc > game.maxAmount - offer.price) {
      return 'limit';
    }
    if (!Number.isSafeInteger(buyer.kc) || buyer.kc < 0 || buyer.kc > game.maxAmount) {
      return 'limit';
    }
    if (buyer.kc < offer.price) {
      return 'funds';
    }
    const debit = await this.itemPlayers.findOneAndUpdate({
      _id: buyer._id, kc: { $gte: offer.price, $lte: game.maxAmount }, nextItemId: { $gte: 1, $lte: game.maxAmount - offer.quantity },
      $expr: { $eq: ['$nextItemId', { $trunc: '$nextItemId' }] }
    }, { $inc: { kc: -offer.price, nextItemId: offer.quantity } }, {
      session: this.itemSession, returnDocument: 'before', includeResultMetadata: false
    });
    if (debit === null) {
      return 'limit';
    }
    const credit = await this.itemPlayers.updateOne({ _id: seller._id, kc: { $gte: 0, $lte: game.maxAmount - offer.price } }, {
      $inc: { kc: offer.price }
    }, { session: this.itemSession });
    const completed = await this.offers.updateOne({ _id: offer._id, state: 'pending', expiresAt: { $gt: now }, $expr: { $gt: ['$expiresAt', '$$NOW'] } }, {
      $set: { state: 'completed' }
    }, { session: this.itemSession });
    if (credit.matchedCount !== 1 || completed.matchedCount !== 1) {
      throw new Error('Purchase conflict');
    }
    await this.deleteUnits(units);
    await this.insertUnits(buyer._id, offer.itemKind, offer.quantity, debit.nextItemId);
    return 'ok';
  }
}
