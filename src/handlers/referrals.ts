import { APIError, type VK } from 'vk-io';
import { logError } from '../utils/log.js';
import { isPositiveId } from '../utils/validation.js';

export function createReferralLinkResolver(vk: VK, groupId: number): (vkId: number) => Promise<string> {
  return async vkId => {
    if (!isPositiveId(vkId) || !isPositiveId(groupId)) {
      throw new Error('Invalid referral identity');
    }
    try {
      const response = await vk.api.utils.getShortLink({
        url: `https://vk.me/club${groupId}?ref=kreox_${vkId}`,
        private: 1
      });
      return response.short_url;
    } catch (error: unknown) {
      const parameterHint = error instanceof APIError && error.code === 100
        ? /\b(private|url)\b/i.exec(error.message)?.[1]?.toLowerCase() : undefined;
      logError('referral_short_link', error, {
        method: 'utils.getShortLink',
        ...(parameterHint === undefined ? {} : { parameterHint })
      });
      throw error;
    }
  };
}
