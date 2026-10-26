import { game } from '../config/game.js';
import type { RankedPlayer, RankingMetric } from '../types/game.js';
import { assertNever } from '../utils/validation.js';

export const rankingFields = {
  kc: 'kc', bitcoin: 'bitcoin', mining: 'mining.rate', euro: 'euro',
  referrals: 'referrals', reputation: 'reputation', stolenKC: 'stolenKC'
} as const satisfies Record<RankingMetric, string>;

export function rankingScore(player: RankedPlayer, metric: RankingMetric): number {
  switch (metric) {
    case 'mining': return player.mining?.rate ?? game.mining.initialRate;
    case 'kc': return player.kc ?? 0;
    case 'bitcoin': return player.bitcoin ?? 0;
    case 'euro': return player.euro ?? 0;
    case 'referrals': return player.referrals ?? 0;
    case 'reputation': return player.reputation ?? 0;
    case 'stolenKC': return player.stolenKC ?? 0;
    default: return assertNever(metric);
  }
}

export function isRankingMetric(value: unknown): value is RankingMetric {
  return typeof value === 'string' && Object.hasOwn(rankingFields, value);
}
