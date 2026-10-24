import { randomInt } from 'node:crypto';
import { isAdminItemCommand, isItemCommand, parsePlayerTarget } from './item-rules.js';
import { adminItems, itemAction, itemText, itemView } from './items.js';
import { itemTexts } from './item-texts.js';
import { adminBalanceAction } from './admin-balance.js';
import { adminIds } from '../config/admin.js';
import { game } from '../config/game.js';
import type { GameInput, PreparedReply, Reply } from '../types/game.js';
import { DuplicateWriteError, type GameDatabase, type GameStore } from '../types/storage.js';
import { assertNever, isPositiveId } from '../utils/validation.js';
import { bonusDay, normalizeName, rewardForDay } from './rules.js';
import { isPromoCommand } from './promo-rules.js';
import { promoAction, promoText } from './promos.js';
import { promoTexts } from './promo-texts.js';
import { miningAction } from './mining-actions.js';
import { rankingScore } from './rankings.js';
import { bonusText, cooldownText, inventoryText, mention, profileText, rankingText, referralRewardText, referralText, texts } from './texts.js';

export class GameService {
  constructor(
    private readonly database: GameDatabase,
    private readonly resolveReferralUrl?: (vkId: number) => Promise<string>,
    private readonly resolveItemTarget?: (screenName: string) => Promise<number | null>,
    private readonly caseRoll: () => number = () => randomInt(100)
  ) {}

  async handle(input: GameInput, resolveName: () => Promise<string>): Promise<PreparedReply> {
    if (!isPositiveId(input.vkId) || !input.eventId || input.eventId.length > 200) {
      throw new Error('Invalid event identity');
    }
    if (input.command.kind === 'delete_keyboards' && (!input.isChat || !adminIds.has(input.vkId))) {
      throw new Error('Administrator chat access is required');
    }
    if ((input.command.kind === 'admin_balance' || input.command.kind === 'admin_balance_invalid') && !adminIds.has(input.vkId)) {
      throw new Error('Administrator access is required');
    }
    if (isAdminItemCommand(input.command) && !adminIds.has(input.vkId)) {
      throw new Error('Administrator access is required');
    }
    let resolvedTarget: number | null | undefined;
    let rolls: number[] | undefined;
    let rollIndex = 0;
    const roll = (): number => {
      rolls ??= [];
      const value = rolls[rollIndex] ?? this.caseRoll();
      rolls[rollIndex++] = value;
      return value;
    };
    let name: string | null = null;
    let referralUrl: string | null = null;
    for (let attempt = 0; attempt < game.duplicateRetries;) {
      try {
        const reply = await this.database.transaction(async store => {
          const previous = await store.processed(input.eventId);
          if (previous !== null) {
            if (previous.vkId !== input.vkId) {
              throw new Error('Event sender mismatch');
            }
            return previous.reply;
          }
          rollIndex = 0;
          const reply = await this.execute(store, input, name, referralUrl, resolvedTarget, roll);
          if (typeof reply === 'string') {
            return reply;
          }
          return store.remember(input, input.isChat ? { ...reply, keyboard: { kind: 'none' } } : reply);
        });
        if (typeof reply !== 'string') {
          return reply;
        }
        if (reply === 'name') {
          name = normalizeName(await resolveName());
        } else if (reply === 'target') {
          const target = parsePlayerTarget(input.text ?? '');
          if (target?.kind !== 'screen' || this.resolveItemTarget === undefined) {
            throw new Error('Item target provider is unavailable');
          }
          resolvedTarget = await this.resolveItemTarget(target.name);
          if (resolvedTarget !== null && !isPositiveId(resolvedTarget)) {
            throw new Error('Invalid resolved VK identity');
          }
        } else {
          if (this.resolveReferralUrl === undefined) {
            throw new Error('Referral link provider is unavailable');
          }
          referralUrl = await this.resolveReferralUrl(input.vkId);
          const url = new URL(referralUrl);
          if (url.protocol !== 'https:' || url.hostname !== 'vk.cc' || url.username || url.password) {
            throw new Error('Invalid short referral URL');
          }
        }
      } catch (error: unknown) {
        attempt += 1;
        if (!(error instanceof DuplicateWriteError) || attempt === game.duplicateRetries) {
          throw error;
        }
        continue;
      }
    }
    throw new Error('Transaction retry limit reached');
  }

  private async execute(store: GameStore, input: GameInput, name: string | null, referralUrl: string | null, resolvedTarget: number | null | undefined, roll: () => number): Promise<Reply | 'name' | 'link' | 'target'> {
    if (input.command.kind === 'delete_keyboards') {
      return { text: texts.keyboardsDeleted, keyboard: { kind: 'none' } };
    }
    if (input.command.kind === 'admin_balance' || input.command.kind === 'admin_balance_invalid') {
      return adminBalanceAction(store, input, input.command);
    }
    if (isAdminItemCommand(input.command)) {
      return adminItems(store, input.command);
    }
    const player = await store.player(input.vkId);
    if (player === null) {
      if (name === null) {
        return 'name';
      }
      const registered = await store.register(input.vkId, name);
      if (registered !== null && input.referrerId !== undefined && isPositiveId(input.referrerId) && input.referrerId !== input.vkId) {
        const inviter = await store.player(input.referrerId);
        if (inviter !== null) {
          await store.rewardReferral(inviter, registered, referralRewardText(registered));
        }
      }
      return { text: registered === null ? texts.registrationLimit : texts.welcome, keyboard: { kind: 'main' } };
    }
    const command = input.command;
    if (!input.isChat && !input.hasPayload && player.itemDraft !== undefined && input.text !== undefined
      && command.kind !== 'menu' && command.kind !== 'inventory' && command.kind !== 'profile' && command.kind !== 'item') {
      return itemText(store, player, player.itemDraft, input, resolvedTarget);
    }
    if (isItemCommand(command)) {
      if (input.isChat) {
        return { text: itemTexts.private, keyboard: { kind: 'none' } };
      }
      if (player.promoDraft !== undefined) {
        await store.setPromoDraft(player._id, null);
      }
      return itemAction(store, player, command, input, roll);
    }
    if (!input.isChat && player.itemDraft !== undefined) {
      await store.setItemDraft(player._id, null);
    }
    if (!input.isChat && !input.hasPayload && player.promoDraft !== undefined && input.text !== undefined) {
      return promoText(store, player, player.promoDraft, input);
    }
    if (isPromoCommand(command)) {
      return input.isChat ? { text: promoTexts.private, keyboard: { kind: 'none' } } : promoAction(store, player, command);
    }
    if (!input.isChat && player.promoDraft !== undefined) {
      await store.setPromoDraft(player._id, null);
    }
    switch (command.kind) {
      case 'city':
        return { text: texts.city, keyboard: { kind: 'main' } };
      case 'profile':
        return { text: profileText(player), keyboard: { kind: 'profile' } };
      case 'menu':
        return { text: `${mention(player)}, меню:\n\n${profileText(player)}`, keyboard: { kind: 'main' } };
      case 'bonus': {
        const now = await store.now();
        const remaining = player.nextBonusAt.getTime() - now.getTime();
        if (remaining > 0) {
          return { text: cooldownText(remaining), keyboard: { kind: 'main' } };
        }
        const day = bonusDay(player, now);
        const reward = rewardForDay(day);
        const claimed = await store.claim(player, day, reward, now);
        return { text: claimed ? bonusText(day, reward) : texts.balanceLimit, keyboard: { kind: 'main' } };
      }
      case 'mining':
      case 'mining_start':
      case 'mining_withdraw':
      case 'mining_upgrade':
      case 'mining_confirm':
        return miningAction(store, player, command);
      case 'ranking': {
        const ranking = await store.ranking(command.metric, player);
        return { text: rankingText(command.metric, ranking, player, rankingScore(player, command.metric)), keyboard: { kind: 'ranking' } };
      }
      case 'referrals': {
        const url = player.referralUrl ?? referralUrl;
        if (url === null) {
          return 'link';
        }
        if (player.referralUrl === undefined) {
          await store.saveReferralUrl(player._id, url);
        }
        return { text: referralText(url, player.referrals ?? 0), keyboard: { kind: 'referrals' } };
      }
      case 'inventory': {
        if (input.isChat) {
          const items = await store.inventoryAll(input.vkId);
          const text = inventoryText(items);
          return {
            text: items.length > game.chatInventoryLimit || text.length > game.maxMessageLength ? texts.inventoryTooLarge : text,
            keyboard: { kind: 'none' }
          };
        }
        if (!Number.isSafeInteger(command.page) || command.page < 0
          || command.page > Math.floor(game.maxAmount / game.inventoryPageSize) - 1) {
          throw new Error('Invalid inventory page');
        }
        const items = await store.inventory(input.vkId, command.page);
        const visible = items.slice(0, game.inventoryPageSize);
        return {
          text: inventoryText(visible),
          keyboard: {
            kind: 'inventory',
            page: command.page,
            itemIds: visible.map(item => item.itemId),
            hasNext: items.length > game.inventoryPageSize
          }
        };
      }
      case 'item': {
        if (input.isChat) {
          return { text: itemTexts.private, keyboard: { kind: 'none' } };
        }
        const item = await store.ownedItem(player._id, command.itemId);
        return item === null ? { text: itemTexts.none, keyboard: { kind: 'profile' } } : itemView(store, player, item.kind);
      }
      case 'development':
        return { text: texts.development, keyboard: { kind: 'main' } };
      default:
        return assertNever(command);
    }
  }
}
