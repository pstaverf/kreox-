import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { VK, type APIRequest } from 'vk-io';
import { isRecord } from '../src/utils/validation.js';
import { syncChatRegistry } from '../src/handlers/chat-registry.js';

test('conversation discovery paginates outside transactions and excludes left, kicked and unwritable chats', async context => {
  const vk = new VK({ token: 'test-token' });
  const recorded: [number, boolean][] = [];
  let requests = 0;
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.getConversations');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.group_id, 123);
    assert.equal(params.count, 200);
    requests += 1;
    if (requests === 1) {
      assert.equal(params.offset, 0);
      return { count: 5, items: [
        { conversation: { peer: { type: 'chat', id: 2_000_000_001 }, chat_settings: { state: 'in' } } },
        { conversation: { peer: { type: 'user', id: 1 } } }
      ] };
    }
    assert.equal(params.offset, 2);
    return { count: 5, items: [
      { conversation: { peer: { type: 'chat', id: 2_000_000_002 }, chat_settings: { state: 'left' } } },
      { conversation: { peer: { type: 'chat', id: 2_000_000_003 }, chat_settings: { state: 'kicked' } } },
      { conversation: { peer: { type: 'chat', id: 2_000_000_004 }, can_write: { allowed: false } } }
    ] };
  });
  context.after(() => api.mock.restore());
  await syncChatRegistry(vk, { recordChat: async (peerId, active = true) => { recorded.push([peerId, active]); } }, 123);
  assert.equal(requests, 2);
  assert.deepEqual(recorded, [[2_000_000_001, true], [2_000_000_002, false], [2_000_000_003, false], [2_000_000_004, false]]);
});

test('malformed conversation discovery does not silently mark arbitrary peers as eligible for broadcasts', async context => {
  const vk = new VK({ token: 'test-token' });
  const api = mock.method(vk.api, 'callWithRequest', async () => ({ count: 1, items: [{ conversation: { peer: { type: 'chat', id: 1 } } }] }));
  context.after(() => api.mock.restore());
  await assert.rejects(syncChatRegistry(vk, { recordChat: async () => { throw new Error('Should not record invalid peer'); } }, 123), /Invalid conversation peer/);
});
