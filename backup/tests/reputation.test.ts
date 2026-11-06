import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand } from '../src/handlers/commands.js';
import { GameService } from '../src/services/game.js';
import type { Command, GameInput } from '../src/types/game.js';
import { MemoryDatabase } from './memory.js';

async function fixture() {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, () => 1);
  let sequence = 0;
  const send = (command: Command, vkId = 1, extra: Partial<GameInput> = {}) => service.handle({
    eventId: `rep-${sequence++}`, vkId, command, isChat: true, peerId: 2_000_000_001, ...extra
  }, async () => `Игрок ${vkId}`);
  const text = (value: string, vkId = 1, extra: Partial<GameInput> = {}) => send(parseCommand(value, undefined, true), vkId, { text: value, ...extra });
  for (const id of [1, 2, 3]) await send({ kind: 'profile' }, id);
  return { db, service, send, text };
}

test('reputation parses chat-only replies, internal IDs and explicit VK IDs without ambiguous fallbacks', () => {
  assert.deepEqual(parseCommand('+реп', undefined, true), { kind: 'reputation', direction: 1 });
  assert.deepEqual(parseCommand('-РЕП 10', undefined, true), { kind: 'reputation', direction: -1, target: { kind: 'number', id: 10 } });
  assert.deepEqual(parseCommand('+реп @id123456', undefined, true), { kind: 'reputation', direction: 1, target: { kind: 'vk', id: 123456 } });
  assert.deepEqual(parseCommand('-реп [id123|Имя игрока]', undefined, true), { kind: 'reputation', direction: -1, target: { kind: 'vk', id: 123 } });
  for (const value of ['+реп @unknown', '+реп -1', '-реп id0', '+реп 1 2']) {
    assert.deepEqual(parseCommand(value, undefined, true), { kind: 'reputation_invalid' });
  }
  assert.deepEqual(parseCommand('+реп 10', undefined, false), { kind: 'development' });
});

test('positive and negative reputation use correct target, notification, per-pair one-hour cooldown and event deduplication', async () => {
  const { db, service, text } = await fixture();
  assert.equal((await text('+реп')).text, '⚠️ Укажите игрока для взаимодействия!');
  assert.equal((await text('+реп 999')).text, '⚠️ Укажите игрока для взаимодействия!');
  assert.equal((await text('+реп @unknown', 1, { replySenderId: 2 })).text, '⚠️ Укажите игрока для взаимодействия!');

  const input = { eventId: 'rep-identical', vkId: 1, isChat: true, peerId: 2_000_000_001,
    command: parseCommand('+реп 1', undefined, true) } as const;
  const reply = await service.handle(input, async () => 'Игрок');
  assert.equal(reply.text, '👍 Вы успешно повысили репутацию игрока [id2|Игрок 2].\n\n😎 Репутация: 2 (+2)');
  assert.equal(db.player(2).reputation, 2);
  assert.equal(db.player(1).reputation, 0);
  assert.equal(db.state.notifications.length, 1);
  assert.equal(db.state.notifications[0]?.peerId, 2);
  assert.equal(db.state.notifications[0]?.text, '[id1|Игрок 1] повысил вам репутацию.');
  assert.deepEqual(await service.handle(input, async () => 'Игрок'), reply);
  assert.equal(db.player(2).reputation, 2);
  assert.equal(db.state.notifications.length, 1);
  assert.equal((await text('-реп @id2')).text, '⚠️ Подождите 60 мин. 0 сек. до следующей смены репутации.');

  assert.match((await text('-реп', 1, { replySenderId: 3 })).text, /😎 Репутация: -2 \(-2\)$/u);
  assert.equal(db.state.notifications[1]?.text, '[id1|Игрок 1] понизил вам репутацию.');
  assert.match((await text('+реп @id2', 3)).text, /Репутация: 4 \(\+2\)$/u);
  db.time = new Date(db.time.getTime() + 3_599_001);
  assert.equal((await text('-реп @id2')).text, '⚠️ Подождите 0 мин. 1 сек. до следующей смены репутации.');
  db.time = new Date(db.time.getTime() + 999);
  assert.match((await text('-реп @id2')).text, /😎 Репутация: 2 \(-2\)$/u);
  assert.equal(db.player(2).reputation, 2);
});

test('concurrent reputation messages, negative rankings and rollback are safe', async () => {
  const { db, text } = await fixture();
  db.failRemember = true;
  await assert.rejects(text('-реп @id2', 1, { eventId: 'failed-rep' }));
  assert.equal(db.player(2).reputation, 0);
  assert.equal(db.state.notifications.length, 0);
  assert.equal(db.state.reputationCooldowns.size, 0);
  db.failRemember = false;
  const replies = await Promise.all(Array.from({ length: 12 }, () => text('-реп @id2')));
  assert.equal(replies.filter(reply => reply.text.startsWith('👎')).length, 1);
  assert.equal(replies.filter(reply => reply.text.startsWith('⚠️ Подождите')).length, 11);
  assert.equal(db.player(2).reputation, -2);
  assert.equal(db.state.notifications.length, 1);
  const ranking = await text('топ реп');
  assert.match(ranking.text, /\[id2\|Игрок 2\] — -2/u);
});

test('the other random outcome changes reputation by one', async () => {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, () => 0);
  for (const id of [1, 2]) await service.handle({ eventId: `one-register-${id}`, vkId: id, command: { kind: 'profile' } }, async () => `Игрок ${id}`);
  const reply = await service.handle({ eventId: 'one-rep', vkId: 1, isChat: true,
    command: { kind: 'reputation', direction: 1, target: { kind: 'vk', id: 2 } } }, async () => 'Игрок');
  assert.match(reply.text, /😎 Репутация: 1 \(\+1\)$/u);
  assert.equal(db.player(2).reputation, 1);
});

test('a first-time actor is registered and the reputation command is handled in the same event', async () => {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, () => 0);
  await service.handle({ eventId: 'register-target', vkId: 2, command: { kind: 'profile' } }, async () => 'Цель');
  const reply = await service.handle({ eventId: 'new-actor', vkId: 1, isChat: true, replySenderId: 2,
    command: { kind: 'reputation', direction: 1 } }, async () => 'Автор');
  assert.equal(reply.text, '👍 Вы успешно повысили репутацию игрока [id2|Цель].\n\n😎 Репутация: 1 (+1)');
  assert.equal(db.player(2).reputation, 1);
  assert.equal(db.state.notifications[0]?.text, '[id1|Автор] повысил вам репутацию.');
  const missing = await service.handle({ eventId: 'new-actor-no-target', vkId: 3, isChat: true,
    command: { kind: 'reputation', direction: -1 } }, async () => 'Новичок');
  assert.equal(missing.text, '⚠️ Укажите игрока для взаимодействия!');
});
