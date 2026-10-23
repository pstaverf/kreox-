import { randomInt } from 'node:crypto';
import type { MessageContext, VK } from 'vk-io';
import type { GameService } from '../services/game.js';
import { texts } from '../services/texts.js';
import { logError } from '../utils/log.js';
import { isPositiveId } from '../utils/validation.js';
import { game as limits } from '../config/game.js';
import type { PreparedReply, Reply } from '../types/game.js';
import { parseCommand } from './commands.js';
import { buildKeyboard } from './keyboards.js';

async function sendReply(vk: VK, peerId: number, randomId: number, reply: Reply): Promise<void> {
  if (reply.text.length > 4_096) {
    throw new Error('Reply is too long');
  }
  const params = {
    peer_id: peerId,
    random_id: randomId,
    message: reply.text,
    keyboard: buildKeyboard(reply.keyboard).toString(),
    disable_mentions: true,
    dont_parse_links: true
  };
  await vk.api.messages.send(params);
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
      reply = await game.handle({
        eventId,
        vkId: context.senderId,
        command: parseCommand(context.text, payload)
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
        await sendReply(vk, context.peerId, -randomInt(1, limits.maxRandomId + 1), { text: texts.error, keyboard: { kind: 'main' } });
      } catch (sendError: unknown) {
        logError('error_reply', sendError, { eventId });
      }
      return;
    }
    try {
      await sendReply(vk, context.peerId, reply.randomId, reply);
    } catch (error: unknown) {
      logError('vk_reply', error, { eventId, vkId: context.senderId });
    }
  };
}
