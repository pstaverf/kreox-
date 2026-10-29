import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { storageConfig } from '../src/config/storage.js';
import { ChatRegistryCache } from '../src/repositories/chat-registry-cache.js';
import { ResponseIds } from '../src/utils/response-ids.js';
import { TransactionClock } from '../src/utils/transaction-clock.js';

test('response ID ranges remove per-message reservations and remain unique across concurrent pools and restarts', async () => {
  let counter = 0;
  let writes = 0;
  const reserve = async () => {
    const first = counter + 1;
    counter += storageConfig.responseIdBlockSize;
    writes += 1;
    return { first, last: counter };
  };
  const first = new ResponseIds(reserve);
  const second = new ResponseIds(reserve);
  const ids = await Promise.all(Array.from({ length: 2000 }, (_, index) => (index % 2 === 0 ? first : second).take()));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => Number.isSafeInteger(id) && id > 0 && id <= game.maxRandomId));
  assert.equal(writes, 8);
  const restarted = new ResponseIds(reserve);
  const next = await restarted.take();
  assert.equal(next, 2049);
  assert.ok(!ids.includes(next));
});

test('response ID allocation failure is shared by waiters and can recover without reusing any issued ID', async () => {
  let fail = true;
  let calls = 0;
  const ids = new ResponseIds(async () => {
    calls += 1;
    if (fail) throw new Error('Reservation failed');
    return { first: 1, last: 3 };
  });
  const failed = await Promise.allSettled(Array.from({ length: 10 }, () => ids.take()));
  assert.equal(calls, 1);
  assert.ok(failed.every(result => result.status === 'rejected'));
  fail = false;
  assert.deepEqual(await Promise.all([ids.take(), ids.take(), ids.take()]), [1, 2, 3]);
  await assert.rejects(ids.take(), /Invalid response ID range/);
});

test('response IDs allow a partial final block but never wrap or accept corrupt ranges', async () => {
  const ids = new ResponseIds(async () => ({ first: game.maxRandomId - 1, last: game.maxRandomId }));
  assert.equal(await ids.take(), game.maxRandomId - 1);
  assert.equal(await ids.take(), game.maxRandomId);
  await assert.rejects(ids.take(), /Invalid response ID range/);
  for (const range of [{ first: 0, last: 1 }, { first: 2, last: 1 }, { first: 1.5, last: 2 }, { first: 1, last: game.maxRandomId + 1 }]) {
    await assert.rejects(new ResponseIds(async () => range).take(), /Invalid response ID range/);
  }
});

test('transaction clock reads server time once and returns independent dates; a new transaction obtains new time', async () => {
  let reads = 0;
  const read = async () => { reads += 1; return new Date(1000 * reads); };
  const clock = new TransactionClock(read);
  const dates = await Promise.all(Array.from({ length: 20 }, () => clock.now()));
  assert.equal(reads, 1);
  assert.ok(dates.every(date => date.getTime() === 1000));
  dates[0]?.setTime(99_999);
  assert.equal((await clock.now()).getTime(), 1000);
  assert.equal((await new TransactionClock(read).now()).getTime(), 2000);
  assert.equal(reads, 2);
});

test('transaction clock never falls back to local time or retries a failed read inside the same transaction', async () => {
  let reads = 0;
  const clock = new TransactionClock(async () => { reads += 1; throw new Error('Database unavailable'); });
  await assert.rejects(clock.now(), /Database unavailable/);
  await assert.rejects(clock.now(), /Database unavailable/);
  assert.equal(reads, 1);
  await assert.rejects(new TransactionClock(async () => new Date(NaN)).now(), /Database time is unavailable/);
});

test('chat registry suppresses repeated active states for one minute, but immediately persists changes and expiry', async () => {
  let time = 0;
  const writes: [number, boolean][] = [];
  const registry = new ChatRegistryCache(async (peer, active) => { writes.push([peer, active]); }, () => time);
  const peer = 2_000_000_001;
  await Promise.all(Array.from({ length: 100 }, () => registry.recordChat(peer)));
  assert.deepEqual(writes, [[peer, true]]);
  time = storageConfig.chatCacheTtlMs - 1;
  await registry.recordChat(peer);
  assert.equal(writes.length, 1);
  time += 1;
  await registry.recordChat(peer);
  assert.equal(writes.length, 2);
  await registry.recordChat(peer, false);
  await registry.recordChat(peer, false);
  await registry.recordChat(peer, true);
  assert.deepEqual(writes.slice(2), [[peer, false], [peer, true]]);
});

test('chat registry orders updates behind pending writes so a kick or rejoin is not lost', async () => {
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const writes: boolean[] = [];
  const registry = new ChatRegistryCache(async (_peer, active) => {
    writes.push(active);
    if (writes.length === 1) { started.resolve(); await release.promise; }
  });
  const peer = 2_000_000_001;
  const first = registry.recordChat(peer);
  await started.promise;
  const kick = registry.recordChat(peer, false);
  const rejoin = registry.recordChat(peer, true);
  assert.deepEqual(writes, [true]);
  release.resolve();
  await Promise.all([first, kick, rejoin]);
  assert.deepEqual(writes, [true, false, true]);
  await registry.recordChat(peer);
  assert.equal(writes.length, 3);
});

test('uncertain or failed registry writes invalidate cache and do not prevent queued updates or future retries', async () => {
  let fail = false;
  const writes: boolean[] = [];
  const registry = new ChatRegistryCache(async (_peer, active) => {
    writes.push(active);
    if (fail) { fail = false; throw new Error('Write failed'); }
  });
  const peer = 2_000_000_001;
  await registry.recordChat(peer);
  fail = true;
  const failure = assert.rejects(registry.recordChat(peer, false), /Write failed/);
  const retry = registry.recordChat(peer);
  await Promise.all([failure, retry]);
  assert.deepEqual(writes, [true, false, true]);
  await registry.recordChat(peer);
  assert.equal(writes.length, 3);
  for (const invalid of [1, 2_000_000_000, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(registry.recordChat(invalid), /Invalid chat peer/);
  }
});

test('chat registry cache is bounded and evicted peers are refreshed instead of being silently forgotten', async () => {
  let writes = 0;
  const registry = new ChatRegistryCache(async () => { writes += 1; });
  const first = 2_000_000_001;
  for (let index = 0; index <= storageConfig.chatCacheLimit; index += 1) await registry.recordChat(first + index);
  assert.equal(writes, storageConfig.chatCacheLimit + 1);
  await registry.recordChat(first + storageConfig.chatCacheLimit);
  assert.equal(writes, storageConfig.chatCacheLimit + 1);
  await registry.recordChat(first);
  assert.equal(writes, storageConfig.chatCacheLimit + 2);
});
