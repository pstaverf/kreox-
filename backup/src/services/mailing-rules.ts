import type { ProcessedMessage } from '../types/game.js';
import { isPositiveId } from '../utils/validation.js';

export function historicalPrivateRecipient(message: Pick<ProcessedMessage, '_id' | 'vkId'>): number | null {
  const parts = message._id.split(':');
  if (parts.length !== 3 || !parts.every(part => /^[1-9]\d{0,15}$/.test(part))) return null;
  const [groupId, peerId, messageId] = parts.map(Number);
  return groupId !== undefined && peerId !== undefined && messageId !== undefined && isPositiveId(groupId) && isPositiveId(messageId)
    && isPositiveId(message.vkId) && peerId === message.vkId ? message.vkId : null;
}
