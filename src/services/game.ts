import { game } from '../config/game.js';
import type { GameInput, PreparedReply, Reply } from '../types/game.js';
import { DuplicateWriteError, type GameDatabase, type GameStore } from '../types/storage.js';
import { assertNever, isPositiveId } from '../utils/validation.js';
import { bonusDay, normalizeName, rewardForDay } from './rules.js';
import { bonusText, cooldownText, inventoryText, mention, profileText, texts } from './texts.js';

export class GameService {
  constructor(private readonly database: GameDatabase) {}

  async handle(input: GameInput, resolveName: () => Promise<string>): Promise<PreparedReply> {
    if (!isPositiveId(input.vkId) || !input.eventId || input.eventId.length > 200) {
      throw new Error('Invalid event identity');
    }
    let name: string | null = null;
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
          const reply = await this.execute(store, input, name);
          return reply === null ? null : store.remember(input, reply);
        });
        if (reply !== null) {
          return reply;
        }
      } catch (error: unknown) {
        attempt += 1;
        if (!(error instanceof DuplicateWriteError) || attempt === game.duplicateRetries) {
          throw error;
        }
        continue;
      }
      name = normalizeName(await resolveName());
    }
    throw new Error('Transaction retry limit reached');
  }

  private async execute(store: GameStore, input: GameInput, name: string | null): Promise<Reply | null> {
    const player = await store.player(input.vkId);
    if (player === null) {
      if (name === null) {
        return null;
      }
      const registered = await store.register(input.vkId, name);
      return { text: registered === null ? texts.registrationLimit : texts.welcome, keyboard: { kind: 'main' } };
    }
    const command = input.command;
    switch (command.kind) {
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
      case 'inventory': {
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
      case 'item':
        return { text: texts.development, keyboard: { kind: 'profile' } };
      case 'development':
        return { text: texts.development, keyboard: { kind: 'main' } };
      default:
        return assertNever(command);
    }
  }
}
