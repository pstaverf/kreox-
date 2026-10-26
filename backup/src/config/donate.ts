import { game } from './game.js';

export const donateConfig = {
  nicknameCost: 50 * game.euroScale,
  nicknameMin: 4,
  nicknameMax: 20,
  subscriptionCost: 200 * game.euroScale,
  subscriptionMs: 30 * 24 * 60 * 60 * 1000,
  theftCooldownMs: 60 * 60 * 1000,
  dealerCost: 15 * game.euroScale,
  dealerCooldownMs: 15 * 60 * 1000,
  maxChatMembers: 10_000,
  chatPageSize: 1000,
  timeZone: 'Europe/Moscow'
} as const;
