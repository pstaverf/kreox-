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
  replySenderId?: number;
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
        ...(options.ref === undefined ? {} : { ref: options.ref }),
        ...(options.replySenderId === undefined ? {} : { reply_message: {
          id: 100, conversation_message_id: 100, out: 0, peer_id: options.peerId ?? 1,
          random_id: 0, important: false, from_id: options.replySenderId, date: 1_792_713_600, text: 'Исходное сообщение', attachments: []
        } })
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
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 1, text: labels.bonus, payload: '{"command":"bonus","vkId":999,"amount":-1}' }));
  assert.equal(sent.at(-1)?.peer_id, 2_000_000_001);
  assert.equal(sent.at(-1)?.random_id, 2);
  assert.equal(sent.at(-1)?.disable_mentions, true);
  assert.equal(sent.at(-1)?.dont_parse_links, true);
  assert.equal(database.player(1).kc, 250_000);
  assert.equal(database.state.players.has(999), false);
  assert.equal(userLookups, 1);
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 1, text: labels.bonus, payload: '{"command":"bonus"}' }));
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
  await handle(message(vk, { text: labels.bonus, payload: '{"command":"bonus"}' }));
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

test('DM promo wizard forwards free text, sends inline confirmation and replays without a second debit', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  await service.handle({ eventId: 'promo-register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  database.player().kc = 5_000_000;
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
  let id = 1;
  for (const [text, action] of [
    [labels.promo, { command: 'promo' }], [labels.createPromo, { command: 'promo_create' }],
    ['KC', { command: 'promo_currency', currency: 'kc' }], ['Подарок', null], ['10.000', null], ['5', null]
  ] as const) {
    await handle(message(vk, { messageId: id++, text, ...(action === null ? {} : { payload: JSON.stringify(action) }) }));
  }
  const confirmation = sent.at(-1);
  assert.ok(confirmation);
  assert.equal(confirmation.message, '☑️ Подтвердите создание промокода.');
  assert.equal(typeof confirmation.keyboard, 'string');
  if (typeof confirmation.keyboard !== 'string') {
    assert.fail('Missing keyboard');
  }
  const keyboard: unknown = JSON.parse(confirmation.keyboard);
  assert.ok(isRecord(keyboard));
  assert.equal(keyboard.inline, true);
  const payload = JSON.stringify({ command: 'promo_confirm', token: '123:1:6', amount: 0, vkId: 999 });
  const input = message(vk, { messageId: id++, text: labels.confirmPromo, payload });
  await handle(input);
  assert.equal(sent.at(-1)?.message, '✅ Промокод создан');
  assert.equal(database.player().kc, 0);
  const randomId = sent.at(-1)?.random_id;
  await handle(input);
  assert.equal(sent.at(-1)?.random_id, randomId);
  assert.equal(database.player().kc, 0);
  assert.equal(database.state.promos.size, 1);
});

test('admin balance commands use the real VK reply author or mention, ignore spoofed payloads and silence non-admins', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  await service.handle({ eventId: 'balance-target', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
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
  const reply = message(vk, {
    senderId: 888801846, peerId: 2_000_000_001, text: '!set 100k', replySenderId: 1,
    payload: '{"targetId":999,"amount":1,"command":"profile"}'
  });
  await handle(reply);
  assert.equal(database.player(1).kc, 10_000_000);
  assert.equal(sent.at(-1)?.message, 'Done.');
  assert.equal(sent.at(-1)?.disable_mentions, true);
  const randomId = sent.at(-1)?.random_id;
  await handle(reply);
  assert.equal(sent.at(-1)?.random_id, randomId);
  assert.equal(database.player(1).kc, 10_000_000);
  await handle(message(vk, {
    senderId: 888801846, peerId: 888801846, messageId: 2,
    text: '!add [id1|Игрок Тест] 100', replySenderId: 999
  }));
  assert.equal(sent.at(-1)?.message, 'Done.');
  assert.equal(sent.at(-1)?.keyboard, undefined);
  assert.equal(database.player(1).kc, 10_010_000);
  assert.equal(database.state.players.has(888801846), false);
  const before = structuredClone(database.state);
  const count = sent.length;
  for (const peerId of [2, 2_000_000_001]) {
    await handle(message(vk, {
      senderId: 2, peerId, messageId: 3, text: '!add @id1 100k',
      payload: '{"vkId":888801846,"admin":true}'
    }));
    await handle(message(vk, { senderId: 2, peerId, messageId: 4, text: '!set -1' }));
  }
  assert.equal(sent.length, count);
  assert.deepEqual(database.state, before);
});

test('item admin commands are silent for non-admins and the real DM button flow opens a granted case', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database, undefined, undefined, () => 0);
  await service.handle({ eventId: 'item-register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
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
  const before = structuredClone(database.state);
  for (const text of ['!giveitem 0 2', '!takeitem 0 2', '!itemlist']) {
    await handle(message(vk, { text, messageId: sent.length + 1, senderId: 2, peerId: 2_000_000_001 }));
  }
  assert.equal(sent.length, 0);
  assert.deepEqual(database.state, before);
  await handle(message(vk, { text: '!giveitem @id1 2', messageId: 1, senderId: 888801846, peerId: 888801846 }));
  assert.equal(sent.at(-1)?.message, 'Done.');
  await handle(message(vk, { text: '🆔 1', messageId: 2, payload: '{"command":"item","itemId":1}' }));
  assert.match(String(sent.at(-1)?.message), /Предмет .*Реферальный.*x1/);
  await handle(message(vk, { text: '✅ Использовать', messageId: 3, payload: '{"command":"item_use","itemKind":"referral_case"}' }));
  const openMessage = message(vk, { text: 'x1', messageId: 4, payload: '{"command":"item_open","itemKind":"referral_case","quantity":1,"kc":999999}' });
  await handle(openMessage);
  assert.match(String(sent.at(-1)?.message), /\[id1\|Игрок\], 🎁 Вот что выпало:\n\n💰 1.500 KC/);
  assert.equal(database.player().kc, 150_000);
  await handle(openMessage);
  assert.equal(database.player().kc, 150_000);
  assert.equal(database.state.items.length, 0);
});

test('typed bonus labels and unrelated payloads never claim rewards, including after cooldown expires', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  await service.handle({ eventId: 'payload-register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
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
  let id = 1;
  for (const payload of [undefined, '{}', '[]', '{"vkId":1,"amount":999999}', '{"command":"unknown"}']) {
    await handle(message(vk, { messageId: id++, text: labels.bonus, ...(payload === undefined ? {} : { payload }) }));
    assert.equal(database.player().kc, 0);
    assert.equal(database.player().bitcoin, 0);
    assert.equal(database.player().bonusDay, 0);
  }
  const beforeChat = sent.length;
  await handle(message(vk, { peerId: 2_000_000_001, messageId: id++, text: labels.bonus }));
  assert.equal(sent.length, beforeChat);
  await handle(message(vk, { messageId: id++, text: 'подпись не используется', payload: '{"command":"bonus","vkId":999,"amount":999999}' }));
  assert.equal(database.player().kc, 250_000);
  assert.equal(database.player().bonusDay, 1);
  assert.equal(database.state.players.has(999), false);
  database.time = new Date(database.player().nextBonusAt);
  await handle(message(vk, { messageId: id++, text: labels.bonus }));
  assert.equal(database.player().kc, 250_000);
  assert.equal(database.player().bonusDay, 1);
  await handle(message(vk, { messageId: id++, text: labels.bonus, payload: '{"command":"bonus"}' }));
  assert.equal(database.player().kc, 750_000);
  assert.equal(sent.at(-1)?.message, '🎁 Бонус 2-го дня:\n\n💰 5.000 KC\n💠 2.5₿');
});

test('donate VK flow ignores DM theft, loads actual chat members outside transactions and rejects forged victim payloads', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database, undefined, undefined, undefined, (_purpose, maximum) => maximum - 1);
  for (const id of [1, 2, 3]) await service.handle({ eventId: `donate-register-${id}`, vkId: id, command: { kind: 'profile' } }, async () => 'Игрок');
  const handle = createMessageHandler(vk, service, 123);
  const sent: Record<string, unknown>[] = [];
  let memberCalls = 0;
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    if (request.method === 'messages.getConversationMembers') {
      const params: unknown = request.params;
      assert.ok(isRecord(params));
      assert.equal(params.peer_id, 2_000_000_001);
      await database.transaction(async () => {});
      memberCalls += 1;
      return { count: 3, items: [{ member_id: 1 }, { member_id: 2 }, { member_id: -123 }] };
    }
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    sent.push(params);
    return [];
  });
  context.after(() => api.mock.restore());
  const before = structuredClone(database.state);
  await handle(message(vk, { text: 'Вор' }));
  assert.equal(sent.length, 0);
  assert.deepEqual(database.state, before);
  await handle(message(vk, { messageId: 2, text: '🍩 Донат', payload: '{"command":"donate"}' }));
  assert.equal(sent.at(-1)?.message, '💶 Донат:');
  database.player().euro = 5_000;
  await handle(message(vk, { messageId: 3, text: '👤 Ник', payload: '{"command":"donate_nick"}' }));
  await handle(message(vk, { messageId: 4, text: "'felix" }));
  const draft = database.player().donateDraft;
  assert.ok(draft?.step === 'confirm_nickname');
  await handle(message(vk, { messageId: 5, payload: JSON.stringify({ command: 'donate_confirm', token: draft.token }) }));
  assert.equal(sent.at(-1)?.message, "[id1|'felix], отличный ник!");
  assert.equal(database.player().euro, 0);
  database.player().thiefUntil = new Date(database.time.getTime() + 86_400_000);
  database.player(2).kc = 500;
  database.player(3).kc = 999_900;
  const attempt = message(vk, { peerId: 2_000_000_001, messageId: 6, text: 'вор', payload: '{"victimId":3,"amount":999999999,"memberIds":[3]}' });
  await handle(attempt);
  assert.equal(sent.at(-1)?.message, "[id1|'felix] украл у игрока [id2|Игрок] 5 KC.");
  assert.equal(memberCalls, 1);
  assert.equal(database.player(3).kc, 999_900);
  assert.equal(database.player(2).kc, 0);
  await handle(attempt);
  assert.equal(memberCalls, 1);
  assert.equal(database.player().kc, 500);
});

test('theft loads all membership pages with group token parameters instead of considering only the first page', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database, undefined, undefined, undefined, (_purpose, maximum) => maximum - 1);
  for (const id of [1, 1002]) await service.handle({ eventId: `page-register-${id}`, vkId: id, command: { kind: 'profile' } }, async () => 'Игрок');
  database.player().thiefUntil = new Date(database.time.getTime() + 86_400_000);
  database.player(1002).kc = 700;
  let calls = 0;
  const sent: Record<string, unknown>[] = [];
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    if (request.method === 'messages.getConversationMembers') {
      assert.equal(params.peer_id, 2_000_000_001);
      assert.equal(params.group_id, 123);
      assert.equal(params.count, 1000);
      assert.equal(params.offset, calls * 1000);
      const offset = calls++ * 1000;
      return { count: 1002, items: Array.from({ length: offset === 0 ? 1000 : 2 }, (_, i) => ({ member_id: offset + i + 1 })) };
    }
    assert.equal(request.method, 'messages.send');
    sent.push(params);
    return [];
  });
  context.after(() => api.mock.restore());
  await createMessageHandler(vk, service, 123)(message(vk, { peerId: 2_000_000_001, text: 'вор' }));
  assert.equal(calls, 2);
  assert.match(String(sent.at(-1)?.message), /у игрока \[id1002\|Игрок\] 7 KC/);
  assert.equal(database.player().kc, 700);
  assert.equal(database.player(1002).kc, 0);
});

test('wallet admin commands use VK reply sender and explicit numeric IDs, while non-admins stay silent', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  for (const id of [1, 2]) await service.handle({ eventId: `wallet-register-${id}`, vkId: id, command: { kind: 'profile' } }, async () => 'Игрок');
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
  for (const text of ['!setdonut 1 50', '!adddonut 1 50', '!takedonut 1 50', '!setbit 1 1', '!addbit 1 1', '!takebit 1 1']) {
    await handle(message(vk, { text, senderId: 2, messageId: 1, peerId: 2_000_000_001 }));
  }
  assert.equal(sent.length, 0);
  await handle(message(vk, { text: '!setdonut 50', senderId: 888801846, replySenderId: 1, messageId: 2, peerId: 2_000_000_001 }));
  assert.equal(sent.at(-1)?.message, 'Done.');
  assert.equal(database.player().euro, 5000);
  await handle(message(vk, { text: '!setbit 2 1.116', senderId: 888801846, replySenderId: 1, messageId: 3, peerId: 2_000_000_001 }));
  assert.equal(sent.at(-1)?.message, 'Done.');
  assert.equal(database.player(2).bitcoin, 111_600_000);
  assert.equal(database.player().bitcoin, 0);
  assert.equal(database.state.players.has(888801846), false);
});

test('city and savings DM wizard use real VK payloads while chat transfers use the real reply sender', async context => {
  const vk = new VK({ token: 'test-token' });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  for (const id of [1, 2]) await service.handle({ eventId: `bank-register-${id}`, vkId: id, command: { kind: 'profile' } }, async () => 'Игрок');
  database.player().kc = 20_000;
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
  await handle(message(vk, { messageId: 1, text: '🏙️ Город', payload: '{"command":"city"}' }));
  assert.equal(sent.at(-1)?.message, '🏙️ Город:');
  await handle(message(vk, { messageId: 2, payload: '{"command":"bank"}' }));
  assert.equal(sent.at(-1)?.message, '🏛️ Банк:');
  await handle(message(vk, { messageId: 3, payload: '{"command":"bank_deposit_money"}' }));
  await handle(message(vk, { messageId: 4, text: '100' }));
  assert.equal(database.player().savingsBalance, 10_000);
  const transfer = message(vk, { peerId: 2_000_000_001, messageId: 5, text: 'монеты 100', replySenderId: 2, payload: '{"targetId":999,"amount":999999}' });
  await handle(transfer);
  assert.equal(sent.at(-1)?.message, 'Вы успешно передали 95 KC игроку [id2|Игрок].');
  assert.equal(database.player().kc, 0);
  assert.equal(database.player(2).kc, 9500);
  await handle(transfer);
  assert.equal(database.player(2).kc, 9500);
  assert.equal(database.state.notifications.length, 1);
});

test('chat leaderboards, director and mixed casino lines use authenticated real VK contexts without keyboards', async context => {
  const vk = new VK({ token: 'test-token' });
  const db = new MemoryDatabase();
  const service = new GameService(db);
  await service.handle({ eventId: 'register-games', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  db.player().kc = 1_000_000;
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
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 1, text: 'Топ биткоин' }));
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 2, text: 'директор' }));
  assert.match(String(sent.at(-1)?.message), /Директор: Государство/);
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 3, text: 'краш 1.7 1000\nдрим 20 1000' }));
  assert.equal(sent.length, 3);
  assert.match(String(sent.at(-1)?.message), /1.000 KC на x1.7\n✅/);
  assert.match(String(sent.at(-1)?.message), /на сектор 20/);
  assert.equal(db.player().kc, 800_000);
  await handle(message(vk, { peerId: 2_000_000_001, messageId: 3, text: 'краш 1.7 1000\nдрим 20 1000' }));
  assert.equal(db.player().kc, 800_000);
  assert.equal(sent.at(-1)?.random_id, sent.at(-2)?.random_id);
  for (const params of sent) {
    assert.equal(typeof params.keyboard, 'string');
    if (typeof params.keyboard !== 'string') throw new Error('Expected serialized keyboard');
    const keyboard: unknown = JSON.parse(params.keyboard);
    assert.ok(isRecord(keyboard));
    assert.deepEqual(keyboard.buttons, []);
  }
});
