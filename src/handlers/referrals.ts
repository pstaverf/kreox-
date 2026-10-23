import type { VK } from 'vk-io';
import { isPositiveId } from '../utils/validation.js';

export function createReferralLinkResolver(vk: VK, groupId: number): (vkId: number) => Promise<string> {
  return async vkId => {
    if (!isPositiveId(vkId) || !isPositiveId(groupId)) {
      throw new Error('Invalid referral identity');
    }
    const response = await vk.api.utils.getShortLink({
      url: `https://vk.me/club${groupId}?ref=kreox_${vkId}`,
      private: true
    });
    return response.short_url;
  };
}
