import { progressDailyTask } from './tasks.js';
import { game } from '../config/game.js';
import type { MiningCommand, Player, Reply } from '../types/game.js';
import type { GameStore } from '../types/storage.js';
import { assertNever } from '../utils/validation.js';
import { initialFarm, nextUpgradeCost, randomMiningIncrease, settleFarm } from './mining.js';
import { miningOfferText, miningText, miningUpgradedText, miningWithdrawalText, texts } from './texts.js';

export async function miningAction(store: GameStore, player: Player, command: MiningCommand): Promise<Reply> {
  const now = await store.now();
  const farm = settleFarm(player.mining ?? initialFarm(), now);
  const hasAsic = await store.itemCount(player._id, 'asic', now) > 0;
  let text: string;
  switch (command.kind) {
    case 'mining':
      text = miningText(farm, now) + (hasAsic ? '\n\n💡 Вы можете использовать предмет для фермы!' : '');
      break;
    case 'mining_asic': {
      if (!hasAsic) {
        text = '⚠️ У вас нет данного предмета!';
      } else if (farm.activeUntil.getTime() > now.getTime()) {
        text = '💽 Ваша ферма еще работает!';
      } else {
        farm.activeUntil = new Date(now.getTime() + game.mining.asicDurationMs);
        const date = new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }).format(farm.activeUntil).replace(/ г\. в /u, ' ').replace(', ', ' ');
        const started = await store.saveMining(player, farm, 0);
        if (started) await progressDailyTask(store, player._id, 'farm_start', now);
        text = started ? `💽 Ваша ферма активирована до ${date}!` : texts.miningLimit;
      }
      break;
    }
    case 'mining_start':
      if (farm.activeUntil.getTime() > now.getTime()) {
        text = texts.miningAlreadyStarted;
      } else {
        farm.activeUntil = new Date(now.getTime() + game.mining.durationMs);
        const started = await store.saveMining(player, farm, 0);
        if (started) await progressDailyTask(store, player._id, 'farm_start', now);
        text = started ? texts.miningStarted : texts.miningLimit;
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
  return { text, keyboard: hasAsic ? { kind: 'mining', asic: true } : { kind: 'mining' } };
}
