import type { VK } from 'vk-io';
import { donateConfig } from '../config/donate.js';
import { isPositiveId } from '../utils/validation.js';

export async function loadChatMembers(vk: VK, peerId: number, groupId: number): Promise<number[]> {
  const ids = new Set<number>();
  let offset = 0;
  let total: number | undefined;
  const pages = Math.ceil(donateConfig.maxChatMembers / donateConfig.chatPageSize);
  for (let page = 0; page < pages; page += 1) {
    const response = await vk.api.messages.getConversationMembers({ peer_id: peerId, group_id: groupId, count: donateConfig.chatPageSize, offset });
    if (!Number.isSafeInteger(response.count) || response.count < 0 || response.count > donateConfig.maxChatMembers
      || (total !== undefined && response.count !== total) || response.items.length > donateConfig.chatPageSize) throw new Error('Invalid chat membership response');
    total = response.count;
    for (const member of response.items) {
      if (!Number.isSafeInteger(member.member_id) || member.member_id === 0) throw new Error('Invalid chat member');
      if (isPositiveId(member.member_id)) ids.add(member.member_id);
    }
    offset += response.items.length;
    if (offset >= total) return [...ids];
    if (response.items.length === 0) throw new Error('Incomplete chat membership response');
  }
  throw new Error('Chat membership limit exceeded');
}
