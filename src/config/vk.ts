import type { IAPIOptions } from 'vk-io';

export const vkApiOptions = {
  apiMode: 'parallel_selected',
  apiExecuteMethods: ['messages.send'],
  apiExecuteCount: 25,
  apiLimit: 20,
  apiRequestMode: 'sequential',
  apiRetryLimit: 2,
  apiWait: 1_000,
  apiTimeout: 10_000
} satisfies Partial<IAPIOptions>;
