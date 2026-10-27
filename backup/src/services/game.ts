import { logError } from '../utils/log.js';
import type { GiveawayState } from '../types/giveaway.js';
import { claimGiveaway, giveawayAdminAction, prepareGiveawayClaim } from './giveaway.js';
import { isGiveawayCommand, isGiveawayAdminCommand } from './giveaway-rules.js';
import { diceAction, diceButtonActive } from './dice.js';
import { isDiceCommand } from './dice-rules.js';
import { privateCasinoAction } from './private-casino.js';
import { isPrivateCasinoCommand } from './private-casino-rules.js';
import { coinState, coinReply, coinStakeInput } from './coin.js';
import { coinActive } from './coin-rules.js';
import { privateCasinoTexts } from './private-casino-texts.js';
import { mailingAction } from './mailing.js';
import { casinoAction } from './casino.js';
import { directorTextInput } from './director.js';
import { casinoRandom, cachedCasinoRandom } from './casino-rules.js';
import type { CasinoRandom } from '../types/casino.js';
import { bankAction, bankText } from './bank.js';
import { bankTexts } from './bank-texts.js';
import { isBankCommand } from './bank-rules.js';
import { donateConfig } from '../config/donate.js';
import { donateAction, donateText, type DonateRandom } from './donate.js';
import { isDonateCommand } from './donate-rules.js';
import { donateTexts } from './donate-texts.js';
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
    private readonly caseRoll: () => number = () => randomInt(100),
    private readonly donateRoll: DonateRandom = (_purpose, maximum) => randomInt(maximum),
    private readonly bankRoll: (maximum: number) => number = maximum => randomInt(maximum),
    private readonly casinoRoll: CasinoRandom = casinoRandom
  ) {}

  async handle(input: GameInput, resolveName: () => Promise<string>, resolveChatMembers?: () => Promise<number[]>, wakeNotifications?: () => void): Promise<PreparedReply> {
    if (!isPositiveId(input.vkId) || !input.eventId || input.eventId.length > 200) {
      throw new Error('Invalid event identity');
    }
    if (isGiveawayAdminCommand(input.command) && !adminIds.has(input.vkId)) throw new Error('Administrator access is required');
    if (input.command.kind === 'delete_keyboards' && (!input.isChat || !adminIds.has(input.vkId))) {
      throw new Error('Administrator chat access is required');
    }
    if ((input.command.kind === 'admin_balance' || input.command.kind === 'admin_balance_invalid') && !adminIds.has(input.vkId)) {
      throw new Error('Administrator access is required');
    }
    if (isAdminItemCommand(input.command) && !adminIds.has(input.vkId)) {
      throw new Error('Administrator access is required');
    }
    if ((input.command.kind === 'mailing' || input.command.kind === 'mailing_invalid') && !adminIds.has(input.vkId)) throw new Error('Administrator access is required');
    if (input.command.kind === 'theft' && !input.isChat) throw new Error('Theft is chat-only');
    const casinoRoll = cachedCasinoRandom(this.casinoRoll);
    const bankRolls = new Map<number, number>();
    const bankRandom = (maximum: number): number => {
      const value = bankRolls.get(maximum) ?? this.bankRoll(maximum);
      if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) throw new Error('Invalid bank roll');
      bankRolls.set(maximum, value);
      return value;
    };
    let members: number[] | undefined;
    const donationRolls = new Map<string, number>();
    const donationRandom: DonateRandom = (purpose, maximum) => {
      const key = `${purpose}:${maximum}`;
      const value = donationRolls.get(key) ?? this.donateRoll(purpose, maximum);
      if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) throw new Error('Invalid donate random value');
      donationRolls.set(key, value);
      return value;
    };
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
        const outcome = await this.database.transaction(async store => {
          const previous = await store.processed(input.eventId);
          if (previous !== null) {
            if (previous.vkId !== input.vkId) {
              throw new Error('Event sender mismatch');
            }
            return { reply: previous.reply, wake: false };
          }
          if (!input.isChat && input.peerId === input.vkId) await store.joinMailing(input.vkId);
          rollIndex = 0;
          const reply = await this.execute(store, input, name, referralUrl, resolvedTarget, roll, members, donationRandom, bankRandom, casinoRoll);
          if (typeof reply === 'string') {
            return { reply, wake: false };
          }
          const prepared = await store.remember(input, input.isChat && reply.keyboard.kind !== 'dice_game' && reply.keyboard.kind !== 'giveaway' ? { ...reply, keyboard: { kind: 'none' } } : reply);
          return { reply: prepared, wake: store.notificationsQueued() };
        });
        const reply = outcome.reply;
        if (typeof reply !== 'string') {
          if (outcome.wake) {
            try { wakeNotifications?.(); } catch (error: unknown) { logError('notification_wake', error); }
          }
          return reply;
        }
        if (reply === 'name') {
          name = normalizeName(await resolveName());
        } else if (reply === 'members') {
          if (resolveChatMembers === undefined || !input.isChat || input.command.kind !== 'theft') throw new Error('Chat members provider is unavailable');
          const ids = await resolveChatMembers();
          if (ids.length > donateConfig.maxChatMembers || ids.some(id => !isPositiveId(id))) throw new Error('Invalid chat members');
          members = [...new Set(ids)];
        } else if (reply === 'target') {
          const target = input.command.kind === 'bank_transfer' ? input.command.target : parsePlayerTarget(input.text ?? '');
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

  private async execute(store: GameStore, input: GameInput, name: string | null, referralUrl: string | null, resolvedTarget: number | null | undefined, roll: () => number, members: readonly number[] | undefined, donateRandom: DonateRandom, bankRandom: (maximum: number) => number, casinoRoll: CasinoRandom): Promise<Reply | 'name' | 'link' | 'target' | 'members'> {
    if (input.command.kind === 'mailing' || input.command.kind === 'mailing_invalid') return mailingAction(store, input, input.command);
    if (input.command.kind === 'delete_keyboards') {
      return { text: texts.keyboardsDeleted, keyboard: { kind: 'none' } };
    }
    if (input.command.kind === 'admin_balance' || input.command.kind === 'admin_balance_invalid') {
      return adminBalanceAction(store, input, input.command);
    }
    if (isAdminItemCommand(input.command)) {
      return adminItems(store, input.command);
    }
    let giveawayState: GiveawayState | undefined;
    if (isGiveawayCommand(input.command)) {
      if (input.command.kind !== 'giveaway_claim') return giveawayAdminAction(store, input, input.command);
      const prepared = await prepareGiveawayClaim(store, input, input.command);
      if ('text' in prepared) return prepared;
      giveawayState = prepared;
    }
    if (isDiceCommand(input.command)) {
      if (!await diceButtonActive(store, input, input.command)) return { text: '', keyboard: { kind: 'none' } };
      if (input.command.kind === 'dice_leave' || input.command.kind === 'dice_list' || input.command.kind === 'dice_invalid') return diceAction(store, input, null, input.command, casinoRoll);
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
      if (registered !== null && input.command.kind === 'giveaway_claim') return claimGiveaway(store, input, registered, input.command, giveawayState);
      return { text: registered === null ? texts.registrationLimit : texts.welcome, keyboard: { kind: 'main' } };
    }
    const command = input.command;
    if (isGiveawayCommand(command)) {
      if (command.kind === 'giveaway_claim') return claimGiveaway(store, input, player, command, giveawayState);
      return giveawayAdminAction(store, input, command);
    }
    if (isDiceCommand(command)) return diceAction(store, input, player, command, casinoRoll);
    if (!input.isChat && player.coinOpen === true) {
      if (!input.hasPayload && command.kind === 'development' && input.text !== undefined) return coinStakeInput(store, player, input);
      const state = await coinState(store, player._id);
      const coinCommand = command.kind === 'coin' || command.kind === 'coin_flip' || command.kind === 'coin_cashout';
      if (state !== null && coinActive(state) && !coinCommand) return coinReply(privateCasinoTexts.active, state);
      if (!coinCommand) await store.setCoinOpen(player._id, false);
    }
    if (isPrivateCasinoCommand(command)) {
      if (!input.isChat) {
        if (player.bankDraft !== undefined) await store.setBankDraft(player._id, null);
        if (player.donateDraft !== undefined) await store.setDonateDraft(player._id, null);
        if (player.promoDraft !== undefined) await store.setPromoDraft(player._id, null);
        if (player.itemDraft !== undefined) await store.setItemDraft(player._id, null);
        if (player.directorDraft !== undefined) await store.setDirectorDraft(player._id, null);
      }
      return privateCasinoAction(store, player, command, input, casinoRoll);
    }
    if (command.kind === 'casino_bets' || command.kind === 'casino_log' || command.kind === 'director_view' || command.kind === 'director_bid' || command.kind === 'director_confirm' || command.kind === 'city_director') {
      if (!input.isChat) {
        await store.setBankDraft(player._id, null);
        await store.setDonateDraft(player._id, null);
        await store.setPromoDraft(player._id, null);
        await store.setItemDraft(player._id, null);
      }
      return casinoAction(store, player, command, input, casinoRoll);
    }
    if (!input.isChat && !input.hasPayload && command.kind === 'development' && player.directorDraft !== undefined && input.text !== undefined) return directorTextInput(store, player, input);
    if (!input.isChat && player.directorDraft !== undefined) await store.setDirectorDraft(player._id, null);
    if (!input.isChat && !input.hasPayload && command.kind === 'development' && player.bankDraft !== undefined && input.text !== undefined) {
      return bankText(store, player, player.bankDraft, input, resolvedTarget);
    }
    if (isBankCommand(command)) {
      if (input.isChat && command.kind !== 'bank_transfer' && command.kind !== 'bank_transfer_invalid') return { text: bankTexts.private, keyboard: { kind: 'none' } };
      if (!input.isChat) {
        await store.setItemDraft(player._id, null);
        await store.setPromoDraft(player._id, null);
        await store.setDonateDraft(player._id, null);
      }
      return bankAction(store, player, command, input, resolvedTarget, bankRandom);
    }
    if (!input.isChat && player.bankDraft !== undefined) await store.setBankDraft(player._id, null);

    if (!input.isChat && !input.hasPayload && command.kind === 'development' && player.donateDraft !== undefined && input.text !== undefined) {
      return donateText(store, player, player.donateDraft, input);
    }
    if (isDonateCommand(command)) {
      if (input.isChat && command.kind !== 'dealer_buy' && command.kind !== 'dealer_view' && command.kind !== 'theft') return { text: donateTexts.private, keyboard: { kind: 'none' } };
      if (!input.isChat) {
        await store.setItemDraft(player._id, null);
        await store.setPromoDraft(player._id, null);
      }
      return donateAction(store, player, command, input, members, donateRandom);
    }
    if (!input.isChat && player.donateDraft !== undefined) await store.setDonateDraft(player._id, null);

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
      case 'profile':
        return { text: profileText(player, input.isChat ? undefined : await store.now()), keyboard: { kind: 'profile' } };
      case 'menu':
        return { text: `${mention(player)}, меню:\n\n${profileText(player, input.isChat ? undefined : await store.now())}`, keyboard: { kind: 'main' } };
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
