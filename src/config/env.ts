export interface Environment {
  vkToken: string;
  vkGroupId: number;
  mongoUri: string;
  mongoDb: string;
}

export function readEnvironment(env: NodeJS.ProcessEnv): Environment {
  const vkToken = env.VK_TOKEN?.trim();
  const group = env.VK_GROUP_ID?.trim();
  const mongoUri = env.MONGODB_URI?.trim();
  const mongoDb = env.MONGODB_DB?.trim();
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
  return { vkToken, vkGroupId, mongoUri, mongoDb };
}
