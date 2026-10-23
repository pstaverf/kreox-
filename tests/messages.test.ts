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
        ...(options.payload === undefined ? {} : { payload: options.payload })
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
