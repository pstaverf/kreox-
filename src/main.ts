import { startCasinoWorker } from './handlers/casino-worker.js';
import { startChatRegistry, syncChatRegistry } from './handlers/chat-registry.js';
import { startBankWorker } from './handlers/bank-worker.js';
import { createItemTargetResolver } from './handlers/item-targets.js';
import { MongoClient } from 'mongodb';
import { VK } from 'vk-io';
import { readEnvironment } from './config/env.js';
import { vkApiOptions } from './config/vk.js';
import { createMessageHandler } from './handlers/messages.js';
import { createReferralLinkResolver } from './handlers/referrals.js';
import { startNotifications } from './handlers/notifications.js';
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
    ...vkApiOptions
  });
  const pending = new Set<Promise<void>>();
  let stopping: Promise<void> | undefined;
  let stopCasino: (() => Promise<void>) | undefined;
  let stopChats: (() => Promise<void>) | undefined;
  let stopBank: (() => Promise<void>) | undefined;
  let stopNotifications: (() => Promise<void>) | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      try {
        await vk.updates.stop();
        await stopChats?.();
        await stopCasino?.();
        await stopBank?.();
        await stopNotifications?.();
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
    await syncChatRegistry(vk, database, env.vkGroupId).catch((error: unknown) => { logError('chat_registry', error); });
    const service = new GameService(database, createReferralLinkResolver(vk, env.vkGroupId), createItemTargetResolver(vk));
    const handle = createMessageHandler(vk, service, env.vkGroupId);
    const notifications = startNotifications(database, vk);
    stopNotifications = notifications;
    stopBank = startBankWorker(database);
    stopCasino = startCasinoWorker(database, notifications.wake);
    stopChats = startChatRegistry(vk, database, env.vkGroupId);
    vk.updates.on('message_new', async context => {
      if (stopping !== undefined) {
        return;
      }
      const task = (async () => {
        if (context.isChat) await database.recordChat(context.peerId, !(context.eventType === 'chat_kick_user' && context.eventMemberId === -env.vkGroupId));
        await handle(context);
      })();
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
