import type { ClientSession, Db } from 'mongodb';
import type { BossDamage } from '../types/boss.js';
import type { Ranking } from '../types/game.js';
import { MongoCasinoStore } from './mongo-casino.js';
export class MongoBossStore extends MongoCasinoStore {
  private readonly damage;
  constructor(db: Db, private readonly bossSession: ClientSession) {
    super(db, bossSession);
    this.damage = db.collection<BossDamage>('casino_records');
  }
  async bossRanking(runId: string, vkId: number): Promise<Ranking> {
    const personal = await this.damage.findOne({ _id: `boss-damage:${runId}:${vkId}`, kind: 'boss_damage' }, { session: this.bossSession });
    const leaders = await this.damage.find({ kind: 'boss_damage', runId }, { session: this.bossSession }).sort({ damage: -1, accountId: 1 }).limit(10).toArray();
    const place = await this.damage.countDocuments({ kind: 'boss_damage', runId, $or: [{ damage: { $gt: personal?.damage ?? 0 } }, { damage: personal?.damage ?? 0, accountId: { $lt: personal?.accountId ?? 0 } }] }, { session: this.bossSession });
    return { leaders: leaders.map(value => ({ _id: value.vkId, name: value.name, accountId: value.accountId, score: value.damage })), place: place + 1 };
  }
}
