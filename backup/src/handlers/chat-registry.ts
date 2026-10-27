import { casinoConfig } from '../config/casino.js';
import type { MessageContext, VK } from 'vk-io';
import { isRecord } from '../utils/validation.js';
import { logError } from '../utils/log.js';

export interface ChatRegistry { recordChat(peerId: number, active?: boolean): Promise<void> }
export async function syncChatRegistry(vk: VK, registry: ChatRegistry, groupId: number, stopped: () => boolean = () => false): Promise<void> {
  let offset = 0;
  while (!stopped()) {
    const response: unknown = await vk.api.messages.getConversations({ group_id: groupId, filter: 'all', count: casinoConfig.chatPageSize, offset });
    if (!isRecord(response) || !Array.isArray(response.items) || response.items.length > casinoConfig.chatPageSize || !Number.isSafeInteger(response.count) || typeof response.count !== 'number' || response.count < 0) throw new Error('Invalid conversations response');
    for (const item of response.items) {
      if (!isRecord(item) || !isRecord(item.conversation)) throw new Error('Invalid conversation');
      const conversation = item.conversation;
      if (!isRecord(conversation.peer) || conversation.peer.type !== 'chat') continue;
      const peerId = conversation.peer.id;
      if (typeof peerId !== 'number' || !Number.isSafeInteger(peerId) || peerId <= 2_000_000_000 || peerId > Number.MAX_SAFE_INTEGER) throw new Error('Invalid conversation peer');
      const state = isRecord(conversation.chat_settings) ? conversation.chat_settings.state : undefined;
      const writable = isRecord(conversation.can_write) ? conversation.can_write.allowed : undefined;
      await registry.recordChat(peerId, state !== 'left' && state !== 'kicked' && writable !== false && writable !== 0);
    }
    offset += response.items.length;
    if (response.items.length === 0 || offset >= response.count) return;
  }
}
export function startChatRegistry(vk: VK, registry: ChatRegistry, groupId: number): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> | undefined;
  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = syncChatRegistry(vk, registry, groupId, () => stopped).catch((error: unknown) => { logError('chat_registry', error); }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, casinoConfig.chatSyncMs);
  timer.unref();
  return async () => { stopped = true; clearInterval(timer); await running; };
}

export async function handleRegisteredMessage(context: MessageContext, groupId: number, registry: ChatRegistry, handle: (context: MessageContext) => Promise<void>): Promise<void> {
  const [handled] = await Promise.allSettled([
    handle(context),
    context.isChat ? registry.recordChat(context.peerId, !(context.eventType === 'chat_kick_user' && context.eventMemberId === -groupId))
      .catch((error: unknown) => { logError('chat_registry', error); }) : Promise.resolve()
  ]);
  if (handled.status === 'rejected') {
    const error: unknown = handled.reason;
    throw error;
  }
}
