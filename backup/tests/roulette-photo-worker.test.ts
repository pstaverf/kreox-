import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { mock, test } from 'node:test';
import { startRoulettePhotoWorker } from '../src/handlers/roulette-photo-worker.js';
import { parseCommand } from '../src/handlers/commands.js';
import { GameService } from '../src/services/game.js';
import { settleCasino } from '../src/services/casino-worker.js';
import { roundKey } from '../src/services/casino-rules.js';
import { MemoryDatabase } from './memory.js';

async function fixture() {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, () => 0);
  await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  db.player().kc = 10_000_000;
  const bet = (peerId: number) => service.handle({ eventId: `bet:${peerId}`, peerId, vkId: 1, isChat: true, command: parseCommand('0 1000', undefined, true) }, async () => 'Игрок');
  return { db, bet };
}

test('photo preparation starts during open betting and does not hold a transaction or delay financial settlement', async context => {
  const { db, bet } = await fixture();
  const peerId = 2_000_000_001;
  await bet(peerId);
  const before = structuredClone(db.state);
  const started = Promise.withResolvers<void>();
  const uploaded = Promise.withResolvers<string | null>();
  const stop = startRoulettePhotoWorker(db, async (peer, number) => {
    assert.equal(peer, peerId);
    assert.equal(number, 0);
    started.resolve();
    return uploaded.promise;
  });
  context.after(async () => { uploaded.resolve(null); await stop(); });
  await started.promise;
  assert.deepEqual(db.state, before);
  const round = db.state.casino.get(roundKey(peerId, 'roulette'));
  assert.ok(round?.kind === 'round');
  assert.equal(round.stage, 'open');
  db.time = new Date(round.closesAt);
  await settleCasino(db);
  assert.equal(db.state.notifications.some(notice => notice._id.endsWith(':closed')), true);
  assert.equal(db.player().kc, 9_900_000);
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  await setImmediate();
  assert.equal(stopped, false);
  uploaded.resolve('photo-123_9');
  await stopping;
});

test('preparation is bounded to two uploads, paginates all active rounds and recovers them after restart', async context => {
  const { db, bet } = await fixture();
  for (let index = 1; index <= 5; index += 1) await bet(2_000_000_000 + index);
  const excluded = db.state.casino.get(roundKey(2_000_000_005, 'roulette'));
  assert.ok(excluded?.kind === 'round');
  excluded.stage = 'finished';
  const firstBatch = Promise.withResolvers<void>();
  const release = Promise.withResolvers<string | null>();
  const peers: number[] = [];
  const stop = startRoulettePhotoWorker(db, async peer => {
    peers.push(peer);
    if (peers.length === 2) firstBatch.resolve();
    return release.promise;
  });
  context.after(async () => { release.resolve(null); await stop(); });
  await firstBatch.promise;
  stop.wake();
  await setImmediate();
  assert.equal(peers.length, 2);
  release.resolve('photo-123_9');
  await setImmediate();
  stop.wake();
  await setImmediate();
  assert.deepEqual(peers, [2_000_000_001, 2_000_000_002, 2_000_000_003, 2_000_000_004]);
  await stop();
  const restartedPeers: number[] = [];
  const stopRestarted = startRoulettePhotoWorker(db, async peer => { restartedPeers.push(peer); return null; });
  context.after(stopRestarted);
  await setImmediate();
  assert.deepEqual(restartedPeers, [2_000_000_001, 2_000_000_002]);
  await stopRestarted();
});

test('a failed preparation cannot stop another chat or expose an unhandled rejection', async context => {
  const { db, bet } = await fixture();
  await bet(2_000_000_001);
  await bet(2_000_000_002);
  const logged: string[] = [];
  const logger = mock.method(console, 'error', (value: unknown) => { logged.push(String(value)); });
  context.after(() => logger.mock.restore());
  const peers: number[] = [];
  const stop = startRoulettePhotoWorker(db, async peer => {
    peers.push(peer);
    if (peer === 2_000_000_001) throw new Error('secret');
    return null;
  });
  context.after(stop);
  await setImmediate();
  await stop();
  assert.equal(peers.length, 2);
  assert.equal(logged.length, 1);
  assert.ok(logged.every(line => !line.includes('secret')));
});
