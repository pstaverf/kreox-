import { startBossWorker } from './handlers/boss-worker.js';
import { createMessagePhotoResolver } from './handlers/message-photos.js';
import { startDiceWorker } from './handlers/dice-worker.js';
import { startJackpotWorker } from './handlers/jackpot-worker.js';
import { startMailingWorker } from './handlers/mailing-worker.js';
import { startRoulettePhotoWorker } from './handlers/roulette-photo-worker.js';
import { MongoMessagePhotos } from './repositories/mongo-message-photos.js';
import { createRoulettePhotoResolver } from './handlers/roulette-photos.js';
import { startCasinoWorker } from './handlers/casino-worker.js';
import { startChatRegistry, syncChatRegistry, handleRegisteredMessage } from './handlers/chat-registry.js';
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
  let stopBoss: (() => Promise<void>) | undefined;
  let stopDice: (() => Promise<void>) | undefined;
  let stopJackpot: (() => Promise<void>) | undefined;
  let stopMailing: (() => Promise<void>) | undefined;
  let stopPhotos: (() => Promise<void>) | undefined;
  let stopCasino: (() => Promise<void>) | undefined;
  let stopChats: (() => Promise<void>) | undefined;
  let stopBank: (() => Promise<void>) | undefined;
  let stopNotifications: (() => Promise<void>) | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      try {
        await vk.updates.stop();
        await stopChats?.();
        await stopBoss?.();
        await stopDice?.();
        await stopJackpot?.();
        await stopCasino?.();
        await stopBank?.();
        await stopPhotos?.();
        await stopMailing?.();
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
    const resolvePhoto = createRoulettePhotoResolver(vk, new MongoMessagePhotos(client.db(env.mongoDb)), env.vkGroupId);
    const resolveMessagePhoto = createMessagePhotoResolver(vk, new MongoMessagePhotos(client.db(env.mongoDb)), env.vkGroupId);
    const notifications = startNotifications(database, vk, resolvePhoto, resolveMessagePhoto, (vkId, runId) => database.bossNotificationsAllowed(vkId, runId));
    stopBoss = startBossWorker(database, notifications.wake);
    const handle = createMessageHandler(vk, service, env.vkGroupId, notifications.wake, resolveMessagePhoto);
    stopPhotos = startRoulettePhotoWorker(database, resolvePhoto, resolveMessagePhoto);
    stopNotifications = notifications;
    stopMailing = startMailingWorker(database, notifications.wake);
    stopBank = startBankWorker(database, notifications.wake);
    stopCasino = startCasinoWorker(database, notifications.wake);
    stopDice = startDiceWorker(database, notifications.wake);
    stopJackpot = startJackpotWorker(database, notifications.wake);
    stopChats = startChatRegistry(vk, database, env.vkGroupId);
    vk.updates.on('message_new', async context => {
      if (stopping !== undefined) {
        return;
      }
      const task = handleRegisteredMessage(context, env.vkGroupId, database, handle);
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
