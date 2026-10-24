import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { GameService } from '../src/services/game.js';
import { texts } from '../src/services/texts.js';
import type { Command } from '../src/types/game.js';
import type { GameStore } from '../src/types/storage.js';
import { MemoryDatabase } from './memory.js';

async function fixture() {
  const database = new MemoryDatabase();
  const service = new GameService(database);
  let sequence = 0;
  const send = (command: Command, vkId = 1, eventId = `event-${sequence++}`) => service.handle(
    { eventId, vkId, command }, async () => 'Александр'
  );
  await send({ kind: 'development' });
  return { database, service, send };
}

test('first interaction only registers and welcomes; duplicate does not register again', async () => {
  const database = new MemoryDatabase();
  const service = new GameService(database);
  const input = { eventId: 'first', vkId: 1, command: { kind: 'bonus' } } as const;
  const first = await service.handle(input, async () => '[id2|@all]\nАлександр');
  assert.equal(first.text, texts.welcome);
  assert.equal(database.player().accountId, 0);
  assert.equal(database.player().kc, 0);
  assert.equal(database.player().nextItemId, 1);
  assert.equal(database.player().name, 'id2allАлександр');
  assert.deepEqual(await service.handle(input, async () => { throw new Error('Should not fetch name'); }), first);
  assert.equal(database.state.registrations, 1);
});

test('profile, menu, empty inventory and navigation have requested text and keyboards', async () => {
  const { send } = await fixture();
  const profile = await send({ kind: 'profile' });
  assert.equal(profile.text, '👤Ник: [id1|Александр]\n💸 Баланс: 0 KC\n💶 Евро: 0\n💠 Биткоин: 0₿\n👍 Репутация: 0\n🏆 Задания: 0/0 [0.00%]\n🆔0');
  assert.deepEqual(profile.keyboard, { kind: 'profile' });
  assert.equal((await send({ kind: 'menu' })).text, `[id1|Александр], меню:\n\n${profile.text}`);
  const inventory = await send({ kind: 'inventory', page: 0 });
  assert.equal(inventory.text, '🎒 Ваш инвентарь:\n\nВаш инвентарь пуст.');
  assert.deepEqual(inventory.keyboard, { kind: 'inventory', page: 0, itemIds: [], hasNext: false });
  assert.equal((await send({ kind: 'development' })).text, texts.development);
  assert.equal((await send({ kind: 'item', itemId: 1 })).text, '⚠️ У вас нет данного предмета!');
});

test('bonus is immediate, blocked until exactly four hours, then advances', async () => {
  const { database, send } = await fixture();
  assert.equal((await send({ kind: 'bonus' })).text, '🎁 Бонус 1-го дня:\n\n💰 2.500 KC\n💠 1.5₿');
  assert.equal(database.player().kc, 250_000);
  assert.equal(database.player().bitcoin, 150_000_000);
  assert.equal((await send({ kind: 'bonus' })).text, '⏳ Подожди ещё 4 ч. 0 мин. 0 сек.');
  database.time = new Date(database.time.getTime() + game.bonusIntervalMs - 1);
  assert.equal((await send({ kind: 'bonus' })).text, '⏳ Подожди ещё 0 ч. 0 мин. 1 сек.');
  database.time = new Date(database.time.getTime() + 1);
  assert.match((await send({ kind: 'bonus' })).text, /Бонус 2-го дня/);
  assert.equal(database.player().kc, 750_000);
});

test('reset boundary is 24 hours since the last successful claim, not since a failed click', async () => {
  const { database, send } = await fixture();
  await send({ kind: 'bonus' });
  const original = database.time.getTime();
  database.time = new Date(original + game.bonusIntervalMs - 1);
  await send({ kind: 'bonus' });
  database.time = new Date(original + game.bonusResetMs);
  assert.match((await send({ kind: 'bonus' })).text, /Бонус 1-го дня/);
  assert.equal(database.player().kc, 500_000);
});

test('a claim just before the 24-hour boundary advances instead of resetting', async () => {
  const { database, send } = await fixture();
  await send({ kind: 'bonus' });
  database.time = new Date(database.time.getTime() + game.bonusResetMs - 1);
  assert.match((await send({ kind: 'bonus' })).text, /Бонус 2-го дня/);
});

test('seven claims give exactly one case, the eighth starts a new cycle', async () => {
  const { database, send } = await fixture();
  for (let day = 1; day <= 7; day += 1) {
    const reply = await send({ kind: 'bonus' });
    assert.match(reply.text, new RegExp(`Бонус ${day}-го дня`));
    if (day === 7) {
      assert.match(reply.text, /💼 Кейс «Ждун»/);
    }
    database.time = new Date(database.time.getTime() + game.bonusIntervalMs);
  }
  assert.equal(database.player().kc, game.rewards.reduce((sum, reward) => sum + reward.kc, 0));
  assert.equal(database.player().bitcoin, game.rewards.reduce((sum, reward) => sum + reward.bitcoin, 0));
  assert.deepEqual(database.state.items, [{ _id: '1:1', vkId: 1, itemId: 1, kind: 'zhdun_case' }]);
  assert.equal(database.player().nextItemId, 2);
  assert.equal((await send({ kind: 'inventory', page: 0 })).text, '🎒 Ваш инвентарь:\n\n🆔 1 — 💼 Кейс «Ждун» (1 шт.)');
  assert.match((await send({ kind: 'bonus' })).text, /Бонус 1-го дня/);
  assert.equal(database.state.items.length, 1);
});

test('parallel distinct messages cannot award two bonuses', async () => {
  const { database, send } = await fixture();
  const replies = await Promise.all(Array.from({ length: 20 }, () => send({ kind: 'bonus' })));
  assert.equal(replies.filter(reply => reply.text.startsWith('🎁')).length, 1);
  assert.equal(replies.filter(reply => reply.text.startsWith('⏳')).length, 19);
  assert.equal(database.player().kc, 250_000);
});

test('redelivery remains idempotent after the cooldown and a service restart', async () => {
  const { database, service } = await fixture();
  const input = { eventId: 'bonus', vkId: 1, command: { kind: 'bonus' } } as const;
  const first = await service.handle(input, async () => 'Игрок');
  database.time = new Date(database.time.getTime() + game.bonusIntervalMs);
  assert.deepEqual(await new GameService(database).handle(input, async () => 'Игрок'), first);
  assert.equal(database.player().kc, 250_000);
  assert.equal(database.player().bonusDay, 1);
});

test('failure after award rolls back balance, case, day and event, allowing a safe retry', async () => {
  const { database, send } = await fixture();
  database.player().bonusDay = 6;
  database.player().lastBonusAt = new Date(database.time.getTime() - game.bonusIntervalMs);
  database.failRemember = true;
  await assert.rejects(send({ kind: 'bonus' }, 1, 'failure'));
  assert.equal(database.player().kc, 0);
  assert.equal(database.player().bonusDay, 6);
  assert.equal(database.state.items.length, 0);
  assert.equal(database.state.messages.has('failure'), false);
  database.failRemember = false;
  assert.match((await send({ kind: 'bonus' }, 1, 'failure')).text, /Бонус 7-го дня/);
  assert.equal(database.player().kc, 10_000_000);
  assert.equal(database.state.items.length, 1);
});

test('failure during registration leaves neither a player nor an ID gap', async () => {
  const database = new MemoryDatabase();
  const service = new GameService(database);
  const input = { eventId: 'register', vkId: 1, command: { kind: 'profile' } } as const;
  database.failRemember = true;
  await assert.rejects(service.handle(input, async () => 'Игрок'));
  assert.equal(database.state.players.size, 0);
  assert.equal(database.state.registrations, 0);
  database.failRemember = false;
  await service.handle(input, async () => 'Игрок');
  assert.equal(database.player().accountId, 0);
});

test('overflow refuses the whole reward without advancing the cooldown', async () => {
  const { database, send } = await fixture();
  database.player().kc = game.maxAmount - 1;
  const before = structuredClone(database.player());
  assert.equal((await send({ kind: 'bonus' })).text, texts.balanceLimit);
  assert.deepEqual(database.player(), before);
  assert.equal(database.state.items.length, 0);
});

test('inventory groups all owned units before pagination and excludes another player’s items', async () => {
  const { database, send } = await fixture();
  database.state.items = Array.from({ length: 10 }, (_, index) => ({
    _id: `1:${10 - index}`, vkId: 1, itemId: 10 - index, kind: 'zhdun_case'
  }));
  database.state.items.push({ _id: '2:1', vkId: 2, itemId: 1, kind: 'zhdun_case' });
  assert.deepEqual((await send({ kind: 'inventory', page: 0 })).keyboard,
    { kind: 'inventory', page: 0, itemIds: [1], hasNext: false });
  assert.equal((await send({ kind: 'inventory', page: 0 })).text, '🎒 Ваш инвентарь:\n\n🆔 1 — 💼 Кейс «Ждун» (10 шт.)');
  assert.deepEqual((await send({ kind: 'inventory', page: 1 })).keyboard,
    { kind: 'inventory', page: 1, itemIds: [], hasNext: false });
});

test('invalid identity and inventory pages cause no write', async () => {
  const { service, send, database } = await fixture();
  for (const vkId of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(service.handle({ eventId: 'invalid', vkId, command: { kind: 'bonus' } }, async () => 'Игрок'));
  }
  for (const page of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(send({ kind: 'inventory', page }));
  }
  assert.equal(database.state.messages.size, 1);
});

test('bonuses for different users are independent', async () => {
  const { database, send } = await fixture();
  await send({ kind: 'development' }, 2);
  await Promise.all([send({ kind: 'bonus' }, 1), send({ kind: 'bonus' }, 2)]);
  assert.equal(database.player(1).kc, 250_000);
  assert.equal(database.player(2).kc, 250_000);
  assert.equal(database.player(2).accountId, 1);
});

test('parallel deliveries of the seventh claim share one reply ID and one case', async () => {
  const { database, send } = await fixture();
  database.player().bonusDay = 6;
  database.player().lastBonusAt = new Date(database.time.getTime() - game.bonusIntervalMs);
  const replies = await Promise.all(Array.from({ length: 12 }, () => send({ kind: 'bonus' }, 1, 'seventh-duplicate')));
  assert.equal(new Set(replies.map(reply => reply.randomId)).size, 1);
  assert.equal(database.player().kc, 10_000_000);
  assert.equal(database.state.items.length, 1);
  assert.equal(database.player().nextItemId, 2);
});

test('bitcoin overflow and an exhausted inventory sequence refuse all parts of the reward', async () => {
  for (const resource of ['bitcoin', 'nextItemId'] as const) {
    const { database, send } = await fixture();
    database.player().bonusDay = 6;
    database.player().lastBonusAt = new Date(database.time.getTime() - game.bonusIntervalMs);
    database.player()[resource] = game.maxAmount;
    const before = structuredClone(database.player());
    assert.equal((await send({ kind: 'bonus' })).text, texts.balanceLimit);
    assert.deepEqual(database.player(), before);
    assert.equal(database.state.items.length, 0);
  }
});

test('registration resolves the VK name outside a transaction, with no preflight query on subsequent commands', async () => {
  class CountingDatabase extends MemoryDatabase {
    activeTransactions = 0;
    transactionCount = 0;

    override async hasPlayer(): Promise<boolean> {
      throw new Error('Unexpected preflight query');
    }

    override async transaction<T>(action: (store: GameStore) => Promise<T>): Promise<T> {
      this.transactionCount += 1;
      return super.transaction(async store => {
        this.activeTransactions += 1;
        try {
          return await action(store);
        } finally {
          this.activeTransactions -= 1;
        }
      });
    }
  }
  const database = new CountingDatabase();
  const service = new GameService(database);
  let nameLookups = 0;
  const resolveName = async (): Promise<string> => {
    assert.equal(database.activeTransactions, 0);
    nameLookups += 1;
    return 'Александр';
  };
  await service.handle({ eventId: 'register-fast', vkId: 1, command: { kind: 'profile' } }, resolveName);
  assert.equal(database.transactionCount, 2);
  assert.equal(nameLookups, 1);
  database.transactionCount = 0;
  const input = { eventId: 'profile-fast', vkId: 1, command: { kind: 'profile' } } as const;
  const profile = await service.handle(input, resolveName);
  assert.equal(database.transactionCount, 1);
  assert.equal(nameLookups, 1);
  database.transactionCount = 0;
  assert.deepEqual(await service.handle(input, resolveName), profile);
  assert.equal(database.transactionCount, 1);
  assert.equal(nameLookups, 1);
});

test('failed VK name lookup leaves registration and event untouched', async () => {
  const database = new MemoryDatabase();
  const service = new GameService(database);
  const input = { eventId: 'name-failure', vkId: 1, command: { kind: 'profile' } } as const;
  await assert.rejects(service.handle(input, async () => { throw new Error('VK unavailable'); }));
  assert.equal(database.state.players.size, 0);
  assert.equal(database.state.messages.size, 0);
  assert.equal(database.state.registrations, 0);
  assert.equal(database.state.responses, 0);
  assert.equal((await service.handle(input, async () => 'Игрок')).text, texts.welcome);
});


test('funded profile matches the compact Felix example and only menu adds an empty line', async () => {
  const { database, send } = await fixture();
  const player = database.player();
  player._id = 888801846;
  player.name = "'felix";
  player.kc = 250_000;
  player.bitcoin = 150_000_000;
  database.state.players.delete(1);
  database.state.players.set(player._id, player);
  const expected = [
    "👤Ник: [id888801846|'felix]",
    '💸 Баланс: 2.500 KC',
    '💶 Евро: 0',
    '💠 Биткоин: 1.5₿',
    '👍 Репутация: 0',
    '🏆 Задания: 0/0 [0.00%]',
    '🆔0'
  ].join('\n');
  const profile = await send({ kind: 'profile' }, player._id);
  assert.equal(profile.text, expected);
  assert.equal(profile.text.includes('\n\n'), false);
  assert.equal(profile.text.split('\n').length, 7);
  const menu = await send({ kind: 'menu' }, player._id);
  assert.equal(menu.text, `[id888801846|'felix], меню:\n\n${expected}`);
  assert.equal(menu.text.split('\n\n').length, 2);
});
