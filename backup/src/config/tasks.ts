import { game } from './game.js';

export const taskConfig = {
  count: 5,
  rewardKC: 100_000 * game.kcScale,
  rewardBitcoin: 100 * game.bitcoinScale
} as const;
