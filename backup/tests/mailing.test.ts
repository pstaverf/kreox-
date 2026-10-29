import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminIds } from '../src/config/admin.js';
import { mailingConfig } from '../src/config/mailing.js';
import { startMailingWorker } from '../src/handlers/mailing-worker.js';
import { parseCommand } from '../src/handlers/commands.js';
import { GameService } from '../src/services/game.js';
import { historicalPrivateRecipient } from '../src/services/mailing-rules.js';
import { queueMailingBatch } from '../src/services/mailing.js';
import { mailingTexts } from '../src/services/mailing-texts.js';
import { MemoryDatabase } from './memory.js';

const admin = 888801846;

function fixture() {
  const db = new MemoryDatabase();
  const service = new GameService(db);
  let index = 0;
  const send = (text: string, vkId = admin, isChat = false, eventId = `mailing-test:${index++}`) => service.handle({ eventId, vkId,
    peerId: isChat ? 2_000_000_001 : vkId, isChat, text, command: parseCommand(text, undefined, isChat) }, async () => 'Игрок');
  return { db, service, send };
}

test('/mailing parses literal multiline text before casino commands, with an exact bounded nonempty body', () => {
  assert.deepEqual(parseCommand('/mailing Привет!\nч1 10к\nкраш 2 1000', undefined, true), { kind: 'mailing', text: 'Привет!\nч1 10к\nкраш 2 1000' });
  assert.deepEqual(parseCommand(' /MAILING\nТекст ', undefined), { kind: 'mailing', text: 'Текст' });
  for (const text of ['/mailing', '/mailing \n', `/mailing ${'x'.repeat(mailingConfig.maxTextLength + 1)}`]) {
    assert.deepEqual(parseCommand(text, undefined), { kind: 'mailing_invalid' });
  }
  assert.equal(parseCommand('/mailings text', undefined).kind, 'development');
  assert.equal(parseCommand(undefined, { command: 'mailing', text: 'forged' }).kind, 'development');
  assert.deepEqual(parseCommand(`/mailing ${'x'.repeat(mailingConfig.maxTextLength)}`, undefined), { kind: 'mailing', text: 'x'.repeat(mailingConfig.maxTextLength) });
});

test('only private senders join, once; a chat-only player joins after a later private message', async () => {
  const f = fixture();
  await f.send('начать', 1);
  const joinedAt = f.db.state.mailingAudience.get(1);
  assert.ok(joinedAt);
  f.db.time = new Date(f.db.time.getTime() + 1000);
  await f.send('ещё сообщение', 1);
  await f.send('я', 2, true);
  assert.deepEqual([...f.db.state.mailingAudience], [[1, joinedAt]]);
  await f.send('привет', 2);
  assert.deepEqual([...f.db.state.mailingAudience.keys()], [1, 2]);
  assert.equal(f.db.player(1).kc, 0);
});

test('admin mailing is queued atomically and replayed without duplicate campaigns or registration', async () => {
  const f = fixture();
  assert.ok(adminIds.has(admin));
  const first = await f.send('/mailing Новости\nВторая строка', admin, true, 'admin:campaign');
  assert.equal(first.text, mailingTexts.queued);
  assert.equal(first.keyboard.kind, 'none');
  assert.equal(f.db.state.players.size, 0);
  const replay = await f.send('/mailing другой текст', admin, true, 'admin:campaign');
  assert.deepEqual(replay, first);
  assert.equal(f.db.state.mailingCampaigns.size, 1);
  assert.equal([...f.db.state.mailingCampaigns.values()][0]?.text, 'Новости\nВторая строка');
  await assert.rejects(f.send('/mailing секрет', 1, true, 'admin:campaign'), /Administrator access/);
  assert.equal(f.db.state.mailingCampaigns.size, 1);
});

test('invalid input, unauthorized typed requests and failures recording the command cannot create a mailing', async () => {
  const f = fixture();
  assert.equal((await f.send('/mailing')).text, mailingTexts.usage);
  assert.equal(f.db.state.mailingCampaigns.size, 0);
  await assert.rejects(f.service.handle({ eventId: 'forged', vkId: 1, command: { kind: 'mailing', text: 'text' } }, async () => 'Игрок'), /Administrator access/);
  f.db.failRemember = true;
  await assert.rejects(f.send('/mailing text', admin, true), /Simulated database failure/);
  assert.equal(f.db.state.mailingCampaigns.size, 0);
  assert.equal(f.db.state.notifications.length, 0);
});

test('mailing pages survive restart, retain every recipient once and exclude chat-only and later private senders', async () => {
  const f = fixture();
  for (let vkId = 1; vkId <= 45; vkId += 1) await f.send('начать', vkId);
  await f.send('я', 100, true);
  await f.send('/mailing Важные новости\nПолный текст', admin, true, 'campaign');
  assert.equal(await queueMailingBatch(f.db), 20);
  f.db.time = new Date(f.db.time.getTime() + 1000);
  await f.send('начать', 101);
  assert.equal(await queueMailingBatch(f.db), 20);
  assert.equal(await queueMailingBatch(f.db), 5);
  assert.equal(await queueMailingBatch(f.db), 0);
  assert.equal(await queueMailingBatch(f.db), 0);
  const notices = f.db.state.notifications;
  assert.equal(notices.length, 45);
  assert.equal(new Set(notices.map(notice => notice._id)).size, 45);
  assert.equal(new Set(notices.map(notice => notice.randomId)).size, 45);
  assert.deepEqual(notices.map(notice => notice.peerId), Array.from({ length: 45 }, (_, index) => index + 1));
  assert.ok(notices.every(notice => notice.text === 'Важные новости\nПолный текст' && notice.priority === 1 && notice.keyboard === undefined));
  const restarted = new GameService(f.db);
  const reply = await restarted.handle({ eventId: 'campaign', vkId: admin, isChat: true, command: { kind: 'mailing', text: 'other' } }, async () => 'Игрок');
  assert.equal(reply.text, mailingTexts.queued);
  assert.equal(f.db.state.mailingCampaigns.size, 1);
  assert.ok([...f.db.state.mailingCampaigns.values()].every(campaign => campaign.state === 'queued'));
});

test('a failed recipient enqueue rolls back the entire page and cursor for a safe retry', async () => {
  const f = fixture();
  await f.send('начать', 1);
  await f.send('начать', 2);
  await f.send('/mailing Текст', admin, true);
  const campaign = [...f.db.state.mailingCampaigns.values()][0];
  assert.ok(campaign);
  const duplicateId = `${campaign._id}:2`;
  f.db.state.notifications.push({ _id: duplicateId, peerId: 2, text: 'existing', randomId: 999, state: 'pending', nextAttemptAt: new Date(0), attempts: 0 });
  await assert.rejects(queueMailingBatch(f.db), /Duplicate mailing/);
  assert.equal(f.db.state.mailingCampaigns.get(campaign._id)?.afterVkId, 0);
  assert.equal(f.db.state.notifications.length, 1);
  f.db.state.notifications = [];
  assert.equal(await queueMailingBatch(f.db), 2);
});

test('historical recipients come only from genuine private peer identities, not every registered player', () => {
  assert.equal(historicalPrivateRecipient({ _id: '123:456:789', vkId: 456 }), 456);
  assert.equal(historicalPrivateRecipient({ _id: '123:2000000001:789', vkId: 456 }), null);
  for (const id of ['test', '0:456:789', '123:456:0', '123:456:789:extra', '123:0456:789', '123:456:Infinity']) {
    assert.equal(historicalPrivateRecipient({ _id: id, vkId: 456 }), null);
  }
});

test('the background mailing worker enqueues a bounded page and wakes delivery only after committing', async context => {
  const f = fixture();
  await f.send('начать', 1);
  await f.send('/mailing Новости', admin, true);
  const committed = Promise.withResolvers<void>();
  const stop = startMailingWorker(f.db, () => {
    assert.equal(f.db.state.notifications.length, 1);
    assert.equal([...f.db.state.mailingCampaigns.values()][0]?.afterVkId, 1);
    committed.resolve();
  });
  context.after(stop);
  await committed.promise;
  await stop();
});
