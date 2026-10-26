import { game } from '../config/game.js';
import type { MiningCommand, Player, Reply } from '../types/game.js';
import type { GameStore } from '../types/storage.js';
import { assertNever } from '../utils/validation.js';
import { initialFarm, nextUpgradeCost, randomMiningIncrease, settleFarm } from './mining.js';
import { miningOfferText, miningText, miningUpgradedText, miningWithdrawalText, texts } from './texts.js';

export async function miningAction(store: GameStore, player: Player, command: MiningCommand): Promise<Reply> {
  const now = await store.now();
  const farm = settleFarm(player.mining ?? initialFarm(), now);
  let text: string;
  switch (command.kind) {
    case 'mining':
      text = miningText(farm, now);
      break;
    case 'mining_start':
      if (farm.activeUntil.getTime() > now.getTime()) {
        text = texts.miningAlreadyStarted;
      } else {
        farm.activeUntil = new Date(now.getTime() + game.mining.durationMs);
        text = await store.saveMining(player, farm, 0) ? texts.miningStarted : texts.miningLimit;
      }
      break;
    case 'mining_withdraw': {
      if (farm.balance < game.mining.minWithdrawal) {
        text = texts.miningEmpty;
        break;
      }
      const amount = farm.balance;
      farm.balance = 0;
      text = await store.saveMining(player, farm, amount)
        ? miningWithdrawalText(amount) : texts.miningLimit;
      break;
    }
    case 'mining_upgrade':
      return { text: miningOfferText(farm.upgradeCost), keyboard: { kind: 'mining_upgrade', level: farm.level } };
    case 'mining_confirm': {
      if (command.level !== farm.level || !Number.isSafeInteger(command.level) || command.level < 0) {
        text = texts.miningStaleOffer;
        break;
      }
      const cost = farm.upgradeCost;
      if (player.bitcoin < cost) {
        text = texts.miningInsufficient;
        break;
      }
      const nextCost = nextUpgradeCost(farm.level, cost);
      const increase = randomMiningIncrease();
      if (nextCost === null || farm.rate > game.maxAmount - increase || farm.level >= game.maxAmount) {
        text = texts.miningLimit;
        break;
      }
      farm.rate += increase;
      farm.level += 1;
      farm.upgradeCost = nextCost;
      text = await store.saveMining(player, farm, -cost) ? miningUpgradedText(farm, increase) : texts.miningLimit;
      break;
    }
    default:
      return assertNever(command);
  }
  return { text, keyboard: { kind: 'mining' } };
}
