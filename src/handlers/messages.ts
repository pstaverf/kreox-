import { randomInt } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { ExecuteError, type MessageContext, type VK } from 'vk-io';
import { adminIds } from '../config/admin.js';
import type { GameService } from '../services/game.js';
import { labels, texts } from '../services/texts.js';
import { logError } from '../utils/log.js';
import { isPositiveId } from '../utils/validation.js';
import { game as limits } from '../config/game.js';
import type { PreparedReply, Reply } from '../types/game.js';
import { parseCommand, parseReferrer } from './commands.js';
import { buildKeyboard } from './keyboards.js';

export async function sendReply(vk: VK, peerId: number, randomId: number, reply: Reply, clearKeyboard = false): Promise<void> {
  if (reply.text.length > limits.maxMessageLength) {
    throw new Error('Reply is too long');
  }
  const params = {
    peer_id: peerId,
    random_id: randomId,
    message: reply.text,
    ...(reply.keyboard.kind === 'none' && !clearKeyboard ? {} : { keyboard: buildKeyboard(reply.keyboard).toString() }),
    disable_mentions: true,
    dont_parse_links: true
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      await vk.api.messages.send(params);
      return;
    } catch (error: unknown) {
      if (!(error instanceof ExecuteError) || error.code !== 6 || attempt >= 2) {
        throw error;
      }
      await setTimeout(1_000 * (attempt + 1));
    }
  }
}

export function createMessageHandler(vk: VK, game: GameService, groupId: number): (context: MessageContext) => Promise<void> {
  return async context => {
    if (context.isOutbox || context.isEvent || !isPositiveId(context.senderId)) {
      return;
    }
    const messageId = context.conversationMessageId;
    if (messageId === undefined || !isPositiveId(messageId) || messageId > limits.maxRandomId || !isPositiveId(context.peerId)) {
      logError('invalid_message_identity', new Error('Invalid message identity'));
      return;
    }
    const eventId = `${groupId}:${context.peerId}:${messageId}`;
    let reply: PreparedReply;
    try {
      const payload: unknown = context.messagePayload;
      const command = parseCommand(context.text, payload, context.isChat);
      if (command.kind === 'delete_keyboards' && (!context.isChat || !adminIds.has(context.senderId))) {
        return;
      }
      if (context.isChat && command.kind === 'development' && !Object.values(labels).some(label => label === context.text?.trim())) {
        return;
      }
      const referrerId = context.isChat ? undefined : parseReferrer(context.referralValue, context.senderId);
      reply = await game.handle({
        eventId,
        vkId: context.senderId,
        command,
        ...(payload === undefined || payload === null ? {} : { hasPayload: true }),
        ...(context.text === undefined ? {} : { text: context.text }),
        ...(context.isChat ? { isChat: true } : {}),
        ...(referrerId === undefined ? {} : { referrerId })
      }, async () => {
        const users = await vk.api.users.get({ user_ids: [context.senderId] });
        const user = users[0];
        if (user === undefined || user.id !== context.senderId) {
          throw new Error('VK user is unavailable');
        }
        return user.first_name;
      });
    } catch (error: unknown) {
      logError('message_processing', error, { eventId, vkId: context.senderId });
      try {
        await sendReply(vk, context.peerId, -randomInt(1, limits.maxRandomId + 1), { text: texts.error, keyboard: { kind: context.isChat ? 'none' : 'main' } }, context.isChat);
      } catch (sendError: unknown) {
        logError('error_reply', sendError, { eventId });
      }
      return;
    }
    try {
      await sendReply(vk, context.peerId, reply.randomId, reply, context.isChat);
    } catch (error: unknown) {
      logError('vk_reply', error, { eventId, vkId: context.senderId });
    }
  };
}
