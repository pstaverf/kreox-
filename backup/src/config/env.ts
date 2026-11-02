export interface Environment {
  vkToken: string;
  vkGroupId: number;
  mongoUri: string;
  mongoDb: string;
  vkCallbackSecret: string;
  vkCallbackConfirmation: string;
  port: number;
}

export function readEnvironment(env: NodeJS.ProcessEnv): Environment {
  const vkToken = env.VK_TOKEN?.trim();
  const group = env.VK_GROUP_ID?.trim();
  const mongoUri = env.MONGODB_URI?.trim();
  const mongoDb = env.MONGODB_DB?.trim();
  const vkCallbackSecret = env.VK_CALLBACK_SECRET?.trim();
  const vkCallbackConfirmation = env.VK_CALLBACK_CONFIRMATION?.trim();
  const rawPort = env.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (!vkToken || !/^[A-Za-z0-9._-]+$/.test(vkToken)) {
    throw new Error('Invalid VK_TOKEN');
  }
  const vkGroupId = Number(group);
  if (!group || !/^\d+$/.test(group) || !Number.isSafeInteger(vkGroupId) || vkGroupId <= 0) {
    throw new Error('Invalid VK_GROUP_ID');
  }
  if (!mongoUri || !/^mongodb(?:\+srv)?:\/\/\S+$/.test(mongoUri)) {
    throw new Error('Invalid MONGODB_URI');
  }
  if (!mongoDb || !/^[A-Za-z0-9_-]{1,63}$/.test(mongoDb)) {
    throw new Error('Invalid MONGODB_DB');
  }
  if (!vkCallbackSecret || vkCallbackSecret.length > 128 || !/^[^\s]+$/.test(vkCallbackSecret)) {
    throw new Error('Invalid VK_CALLBACK_SECRET');
  }
  if (!vkCallbackConfirmation || vkCallbackConfirmation.length > 256 || !/^[^\s]+$/.test(vkCallbackConfirmation)) {
    throw new Error('Invalid VK_CALLBACK_CONFIRMATION');
  }
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid PORT');
  }
  return { vkToken, vkGroupId, mongoUri, mongoDb, vkCallbackSecret, vkCallbackConfirmation, port };
}
