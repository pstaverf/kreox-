import { MongoClient } from 'mongodb';
import { VK } from 'vk-io';
import { readEnvironment } from './config/env.js';
import { createMessageHandler } from './handlers/messages.js';
import { MongoGameDatabase } from './repositories/mongo.js';
import { GameService } from './services/game.js';
import { logError } from './utils/log.js';

async function main(): Promise<void> {
  const env = readEnvironment(process.env);
  const client = new MongoClient(env.mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    maxPoolSize: 10,
    retryWrites: true
  });
  const vk = new VK({
    token: env.vkToken,
    pollingGroupId: env.vkGroupId,
    apiMode: 'sequential',
    apiRequestMode: 'sequential',
    apiRetryLimit: 2,
    apiWait: 1_000,
    apiTimeout: 10_000
  });
  const pending = new Set<Promise<void>>();
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      try {
        await vk.updates.stop();
        await Promise.allSettled([...pending]);
      } finally {
        await client.close();
      }
    })();
    return stopping;
  };
  const onSignal = (): void => {
    void stop().catch((error: unknown) => {
      logError('shutdown', error);
      process.exitCode = 1;
    });
  };
  try {
    await client.connect();
    const database = new MongoGameDatabase(client, env.mongoDb);
    await database.initialize();
    const handle = createMessageHandler(vk, new GameService(database), env.vkGroupId);
    vk.updates.on('message_new', async context => {
      if (stopping !== undefined) {
        return;
      }
      const task = handle(context);
      pending.add(task);
      try {
        await task;
      } catch (error: unknown) {
        logError('message_boundary', error);
      } finally {
        pending.delete(task);
      }
    });
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    await vk.updates.startPolling();
    if (stopping !== undefined) {
      await vk.updates.stop();
    } else {
      console.info('Kreox Bot запущен.');
    }
  } catch (error: unknown) {
    await stop();
    throw error;
  }
}

process.on('unhandledRejection', (error: unknown) => {
  logError('unhandled_rejection', error);
});

await main().catch((error: unknown) => {
  logError('startup', error);
  process.exitCode = 1;
});
