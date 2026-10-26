import { APIError, type VK } from 'vk-io';
import { isPositiveId } from '../utils/validation.js';

export function createItemTargetResolver(vk: VK): (screenName: string) => Promise<number | null> {
  return async screenName => {
    if (!/^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/.test(screenName)) {
      return null;
    }
    try {
      const users = await vk.api.users.get({ user_ids: [screenName] });
      const user = users[0];
      return user !== undefined && isPositiveId(user.id) ? user.id : null;
    } catch (error: unknown) {
      if (error instanceof APIError && error.code === 113) {
        return null;
      }
      throw error;
    }
  };
}
