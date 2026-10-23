import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { APIRequest, ExecuteError, MessageContext, UpdateSource, VK } from 'vk-io';
import { vkApiOptions } from '../src/config/vk.js';
import { createMessageHandler } from '../src/handlers/messages.js';
import { GameService } from '../src/services/game.js';
import { labels } from '../src/services/texts.js';
import { MemoryDatabase } from './memory.js';

test('VK transport batches sends, with at most 25 per execute and the group rate limit', async context => {
  const vk = new VK({ token: 'test-token', ...vkApiOptions });
  const batchSizes: number[] = [];
  const requests = mock.method(APIRequest.prototype, 'make', async function (this: APIRequest) {
    assert.equal(this.method, 'execute');
    const code: unknown = this.params.code;
    assert.equal(typeof code, 'string');
    if (typeof code !== 'string') {
      assert.fail('Missing execute code');
    }
    const size = (code.match(/API\.messages\.send\(/g) ?? []).length;
    batchSizes.push(size);
    return { response: Array.from({ length: size }, () => []) };
  });
  context.after(() => requests.mock.restore());
  assert.equal(vkApiOptions.apiLimit, 20);
  assert.equal(vkApiOptions.apiRequestMode, 'sequential');
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => vk.api.messages.send({
    peer_id: index + 1, random_id: index + 1, message: 'тест'
  })));
  assert.equal(results.length, 30);
  assert.deepEqual(batchSizes, [25, 5]);
});

test('a per-message error in execute remains an API error with its code', async context => {
  const vk = new VK({ token: 'test-token', ...vkApiOptions });
  const requests = mock.method(APIRequest.prototype, 'make', async function (this: APIRequest) {
    assert.equal(this.method, 'execute');
    return {
      response: [false],
      execute_errors: [{ error_code: 901, error_msg: 'Forbidden', method: 'messages.send' }]
    };
  });
  context.after(() => requests.mock.restore());
  await assert.rejects(vk.api.messages.send({ peer_id: 1, random_id: 1, message: 'тест' }),
    (error: unknown) => error instanceof ExecuteError && error.code === 901);
});

test('rate-limited send in execute retries with the same random ID without awarding a second bonus', async context => {
  const vk = new VK({ token: 'test-token', ...vkApiOptions });
  const database = new MemoryDatabase();
  const service = new GameService(database);
  await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  const codes: string[] = [];
  const requests = mock.method(APIRequest.prototype, 'make', async function (this: APIRequest) {
    assert.equal(this.method, 'execute');
    const code: unknown = this.params.code;
    if (typeof code !== 'string') {
      assert.fail('Missing execute code');
    }
    codes.push(code);
    if (codes.length === 1) {
      return {
        response: [false],
        execute_errors: [{ error_code: 6, error_msg: 'Too many requests', method: 'messages.send' }]
      };
    }
    return { response: [[]] };
  });
  context.after(() => requests.mock.restore());
  const message = new MessageContext({
    api: vk.api, upload: vk.upload, source: UpdateSource.WEBHOOK, updateType: 'message_new', groupId: 123,
    payload: {
      client_info: { button_actions: ['text'], keyboard: true, inline_keyboard: false, carousel: false, lang_id: 0 },
      message: {
        id: 0, conversation_message_id: 2, out: 0, peer_id: 1, from_id: 1,
        text: labels.bonus, date: 1_792_713_600, random_id: 0, attachments: [], important: false
      }
    }
  });
  await createMessageHandler(vk, service, 123)(message);
  assert.equal(codes.length, 2);
  assert.equal(codes[0], codes[1]);
  assert.equal(database.player().kc, 250_000);
  assert.equal(database.player().bonusDay, 1);
  assert.equal(database.state.responses, 2);
});
