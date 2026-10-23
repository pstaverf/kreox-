import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { APIError, MessageContext, UpdateSource, VK, type APIRequest } from 'vk-io';
import { createMessageHandler } from '../src/handlers/messages.js';
import { GameService } from '../src/services/game.js';
import { labels, texts } from '../src/services/texts.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

function message(vk: VK, options: {
  peerId?: number;
  senderId?: number;
  messageId?: number;
  out?: number;
  text?: string;
  payload?: string;
  ref?: string;
} = {}): MessageContext {
  return new MessageContext({
    api: vk.api, upload: vk.upload, source: UpdateSource.WEBHOOK, updateType: 'message_new', groupId: 123,
    payload: {
      client_info: { button_actions: ['text'], keyboard: true, inline_keyboard: false, carousel: false, lang_id: 0 },
      message: {
        id: 0, conversation_message_id: options.messageId ?? 1, out: options.out ?? 0,
        peer_id: options.peerId ?? 1, from_id: options.senderId ?? 1,
        text: options.text ?? labels.profile, date: 1_792_713_600,
        random_id: 0, attachments: [], important: false,
        ...(options.payload === undefined ? {} : { payload: options.payload }),
        ...(options.ref === undefined ? {} : { ref: options.ref })
      }
    }
  });
}

test('VK handler uses real context types for DMs and chats and sends safe, deterministic replies', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const handle = createMessageHandler(vk, new GameService(database), 123);
  const sent: Record<string, unknown>[] = [];
  let userLookups = 0;
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    if (request.method === 'users.get') {
      userLookups += 1;
      return [{ id: 1, first_name: 'Александр', last_name: 'Тест' }];
    }
    if (request.method === 'messages.send') {
      const params: unknown = request.params;
      assert.ok(isRecord(params));
      sent.push(params);
      return [{ peer_id: params.peer_id, message_id: 1, conversation_message_id: 1 }];
    }
    throw new Error('Unexpected VK request');
  });
  context.after(() => api.mock.restore());
  await handle(message(vk));
  assert.equal(sent.at(-1)?.message, texts.welcome);
  assert.equal(userLookups, 1);
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 1, text: labels.bonus, payload: '{"vkId":999,"amount":-1}' }));
  assert.equal(sent.at(-1)?.peer_id, 2_000_000_001);
  assert.equal(sent.at(-1)?.random_id, 2);
  assert.equal(sent.at(-1)?.disable_mentions, true);
  assert.equal(sent.at(-1)?.dont_parse_links, true);
  assert.equal(database.player(1).kc, 250_000);
  assert.equal(database.state.players.has(999), false);
  assert.equal(userLookups, 1);
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 1, text: labels.bonus }));
  assert.equal(sent.at(-1)?.random_id, 2);
  assert.equal(database.player(1).kc, 250_000);
  const before = sent.length;
  await handle(message(vk, { out: 1 }));
  await handle(message(vk, { senderId: -123 }));
  assert.equal(sent.length, before);
});

test('closed messages do not roll back a committed bonus or leak VK tokens to logs', async context => {
  const vk = new VK({ token: 'test-secret' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  const api = mock.method(vk.api, 'callWithRequest', async () => {
    throw new APIError({ error_code: 901, error_msg: 'Forbidden test-secret', request_params: [{ key: 'access_token', value: 'test-secret' }] });
  });
  const logs: string[] = [];
  const logger = mock.method(console, 'error', (value: unknown) => { logs.push(String(value)); });
  context.after(() => { api.mock.restore(); logger.mock.restore(); });
  const handle = createMessageHandler(vk, service, 123);
  await handle(message(vk, { text: labels.bonus }));
  assert.equal(database.player().kc, 250_000);
  assert.equal(logs.length, 1);
  assert.ok(logs.every(line => !line.includes('test-secret')));
});


test('chat aliases send no keyboard, ignore unrelated conversation text and never trust payload referral IDs', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  const sent: Record<string, unknown>[] = [];
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    sent.push(params);
    return [];
  });
  context.after(() => api.mock.restore());
  const handle = createMessageHandler(vk, service, 123);
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 1, text: 'как дела' }));
  assert.equal(sent.length, 0);
  for (const [index, text] of ['я', 'и', 'инв', 'инвентарь'].entries()) {
    await handle(message(vk, { peerId: 2_000_000_001, messageId: index + 2, text }));
    const keyboard = sent.at(-1)?.keyboard;
    assert.equal(typeof keyboard, 'string');
    if (typeof keyboard !== 'string') {
      assert.fail('Missing keyboard reset');
    }
    const value: unknown = JSON.parse(keyboard);
    assert.ok(isRecord(value));
    assert.deepEqual(value.buttons, []);
  }
  assert.equal(sent.length, 4);
  assert.equal(database.state.registrations, 1);
});

test('referral attribution comes from the VK event ref and not from button payload', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  await service.handle({ eventId: 'inviter', vkId: 10, command: { kind: 'profile' } }, async () => 'Пригласивший');
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    if (request.method === 'users.get') {
      return [{ id: 1, first_name: 'Игрок', last_name: 'Тест' }];
    }
    assert.equal(request.method, 'messages.send');
    return [];
  });
  context.after(() => api.mock.restore());
  await createMessageHandler(vk, service, 123)(message(vk, {
    ref: 'kreox_10', payload: '{"referrerId":999}', text: 'привет'
  }));
  assert.equal(database.player(10).referrals, 1);
  assert.equal(database.player(10).kc, 1_500_000);
  assert.equal(database.state.players.has(999), false);
});

test('/dk clears the chat keyboard only for the configured admin and does not register a player', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  const handle = createMessageHandler(vk, service, 123);
  const sent: Record<string, unknown>[] = [];
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    sent.push(params);
    return [];
  });
  context.after(() => api.mock.restore());
  const adminMessage = message(vk, { peerId: 2_000_000_001, senderId: 888801846, text: '/dk' });
  await handle(adminMessage);
  assert.equal(sent.length, 1);
  const first = sent[0];
  assert.ok(first);
  assert.equal(first.message, 'Done.');
  assert.equal(first.peer_id, 2_000_000_001);
  assert.equal(typeof first.keyboard, 'string');
  if (typeof first.keyboard !== 'string') {
    assert.fail('Missing keyboard reset');
  }
  const keyboard: unknown = JSON.parse(first.keyboard);
  assert.ok(isRecord(keyboard));
  assert.deepEqual(keyboard.buttons, []);
  await handle(adminMessage);
  assert.equal(sent.at(-1)?.random_id, first.random_id);
  assert.equal(database.state.players.size, 0);
  assert.equal(database.state.registrations, 0);
  assert.equal(database.state.items.length, 0);
  assert.equal(database.state.messages.size, 1);
  const count = sent.length;
  await handle(message(vk, { peerId: 2_000_000_001, senderId: 1, messageId: 2, text: '/dk', payload: '{"vkId":888801846}' }));
  await handle(message(vk, { peerId: 888801846, senderId: 888801846, text: '/dk' }));
  await handle(message(vk, { peerId: 2_000_000_001, senderId: 1, messageId: 3, text: 'обычный текст', payload: '{"command":"delete_keyboards","vkId":888801846}' }));
  assert.equal(sent.length, count);
  assert.equal(database.state.messages.size, 1);
});

test('/dk permissions are enforced by the service too, even for a previously processed event', async () => {
  const database = new MemoryDatabase();
  const service = new GameService(database);
  const input = { eventId: 'admin-dk', vkId: 888801846, isChat: true, command: { kind: 'delete_keyboards' } } as const;
  const resolveName = async (): Promise<string> => { throw new Error('Admin command must not load a name'); };
  assert.equal((await service.handle(input, resolveName)).text, 'Done.');
  await assert.rejects(service.handle({ ...input, isChat: false }, resolveName));
  await assert.rejects(service.handle({ ...input, vkId: 1 }, resolveName));
  assert.equal(database.state.players.size, 0);
  assert.equal(database.state.messages.size, 1);
});
