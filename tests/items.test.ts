import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { itemConfig } from '../src/config/items.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { GameService } from '../src/services/game.js';
import { caseRewards, parseItemPrice, parsePlayerTarget } from '../src/services/item-rules.js';
import { caseResultText, itemDetails, itemTexts } from '../src/services/item-texts.js';
import type { Command, GameInput, KeyboardSpec } from '../src/types/game.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

async function fixture(roll: () => number = () => 0) {
  const db = new MemoryDatabase();
  let resolves = 0;
  let service = new GameService(db, undefined, async name => {
    resolves += 1;
    assert.equal(name, 'kreox_owner');
    await db.transaction(async () => {});
    return 2;
  }, roll);
  let sequence = 0;
  const send = (command: Command, vkId = 1, extra: Partial<GameInput> = {}) => service.handle({
    eventId: `items-${sequence++}`, vkId, command, ...extra
  }, async () => 'Игрок');
  const text = (value: string, vkId = 1, extra: Partial<GameInput> = {}) => send(parseCommand(value, undefined), vkId, { text: value, ...extra });
  for (const id of [1, 2, 3]) {
    await send({ kind: 'profile' }, id);
  }
  const grant = async (quantity = 1, vkId = 1, kind: 'zhdun_case' | 'referral_case' = 'referral_case') => db.transaction(async store => {
    assert.equal(await store.grantItems(vkId, kind, quantity), true);
  });
  const count = (id = 1) => db.state.items.filter(item => item.vkId === id).length;
  const startTransfer = async (mode: 'gift' | 'sale', quantity = 1, price = '10кк') => {
    await send({ kind: mode === 'gift' ? 'item_gift' : 'item_sell', itemKind: 'referral_case' });
    assert.match((await text('@id2')).text, /Введите число предметов/);
    let reply = await text(String(quantity));
    if (mode === 'sale') {
      assert.equal(reply.text, itemTexts.price);
      reply = await text(price);
    }
    assert.equal(reply.keyboard.kind, 'item_confirmation');
    if (reply.keyboard.kind !== 'item_confirmation') {
      throw new Error('Missing confirmation');
    }
    return { kind: 'item_confirm', token: reply.keyboard.token } as const;
  };
  const offer = async (quantity = 1, price = '10кк') => {
    const command = await startTransfer('sale', quantity, price);
    assert.equal((await send(command)).text, itemTexts.sent);
    const record = [...db.state.offers.values()].at(-1);
    assert.ok(record);
    return record;
  };
  return { db, send, text, grant, count, startTransfer, offer, resolves: () => resolves,
    restart: () => { service = new GameService(db, undefined, undefined, roll); } };
}

test('catalog/admin syntax keeps grant catalog IDs separate from personal inventory IDs', async () => {
  const { send, text, db } = await fixture();
  const catalog = await text('!itemlist', 888801846);
  assert.equal(catalog.text, '📖 ItemList:\n\n🆔 1 — 💼 Кейс «Ждун»\n\n🆔 2 — 👬 Кейс «Реферальный»');
  assert.equal((await text('!giveitem 0 2', 888801846)).text, 'Done.');
  assert.equal(db.state.items[0]?.vkId, 1);
  assert.equal(db.state.items[0]?.kind, 'referral_case');
  assert.equal((await text('!giveitem @id1 1', 888801846)).text, 'Done.');
  assert.equal(db.state.items[1]?.itemId, 2);
  assert.equal(db.state.items[1]?.kind, 'zhdun_case');
  assert.equal((await text('!takeitem 0 2', 888801846)).text, 'Done.');
  assert.equal(db.state.items.length, 1);
  assert.equal((await text('!takeitem 0 2', 888801846)).text, itemTexts.none);
  assert.equal(db.state.players.has(888801846), false);
  await assert.rejects(send(parseCommand('!giveitem @id1 2', undefined), 1));
  assert.deepEqual(parseCommand(undefined, { command: 'admin_item', operation: 'give', target: 1, catalogId: 2 }), { kind: 'development' });
});

test('item details show owned quantity and both case tables, not another player’s inventory', async () => {
  const { send, grant, db } = await fixture();
  await grant(3);
  const detail = await send({ kind: 'item', itemId: 1 });
  assert.match(detail.text, /📒 Предмет .*Реферальный.* \(x3\):/);
  for (const amount of ['1.500 KC', '2.500 KC', '15.000 KC', '1 евро', '2 евро', '5 евро']) {
    assert.ok(detail.text.includes(amount));
  }
  assert.equal((await send({ kind: 'item', itemId: 1 }, 2)).text, itemTexts.none);
  assert.equal((await send({ kind: 'item_use', itemKind: 'referral_case' })).keyboard.kind, 'item_use');
  assert.equal(db.state.items.length, 3);
});

test('drop boundaries implement exactly 90% KC / 10% euros with one reward per case', () => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let roll = 0; roll < 100; roll += 1) {
    const reward = caseRewards(1, () => roll);
    assert.equal(reward.counts.reduce((a, b) => a + b, 0), 1);
    reward.counts.forEach((count, index) => { counts[index] = (counts[index] ?? 0) + count; });
  }
  assert.deepEqual(counts, [30, 30, 30, 5, 3, 2]);
  assert.throws(() => caseRewards(1, () => 100));
  assert.throws(() => caseRewards(1001, () => 0));
});

test('opening consumes cases atomically, credits exact currency, and stops when empty', async () => {
  const { send, grant, db, count } = await fixture(() => 99);
  await grant(6);
  assert.match((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 5 })).text, /5 евро x5/);
  assert.equal(db.player().euro, 2500);
  assert.equal(count(), 1);
  await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 });
  assert.equal(db.player().euro, 3000);
  assert.equal(count(), 0);
  assert.equal((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 })).text, itemTexts.none);
  assert.equal((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 999 })).text, itemTexts.badQuantity);
});

test('custom opening validates input, supports cancellation and binds confirmation to one draft', async () => {
  const { send, text, grant, count } = await fixture();
  await grant(12);
  await send({ kind: 'item_custom', itemKind: 'referral_case' });
  for (const value of ['-1', '0', '1.5', '1001']) {
    assert.equal((await text(value)).text, itemTexts.badQuantity);
  }
  assert.equal((await text('13')).text, itemTexts.none);
  const confirmation = await text('12');
  assert.equal(confirmation.text, '📦 Держите!');
  assert.equal(confirmation.keyboard.kind, 'item_confirmation');
  if (confirmation.keyboard.kind !== 'item_confirmation') {
    assert.fail('Missing confirmation');
  }
  assert.equal(count(), 12);
  const command = { kind: 'item_open_confirm', token: confirmation.keyboard.token } as const;
  await send(command);
  assert.equal(count(), 0);
  assert.equal((await send(command)).text, itemTexts.stale);
  await grant();
  for (const cancel of ['отмена', 'ОТМЕНИТЬ']) {
    await send({ kind: 'item_custom', itemKind: 'referral_case' });
    const result = await text(cancel);
    assert.equal(result.text, 'Действие отменено.');
    assert.equal(result.keyboard.kind, 'main');
  }
});

test('open replay and parallel clicks never consume one case or award its rewards twice', async () => {
  const { send, grant, db, restart } = await fixture();
  await grant();
  const command = { kind: 'item_open', itemKind: 'referral_case', quantity: 1 } as const;
  const replies = await Promise.all(Array.from({ length: 8 }, () => send(command, 1, { eventId: 'same-open' })));
  assert.ok(replies.every(reply => reply.randomId === replies[0]?.randomId));
  assert.equal(db.player().kc, 150_000);
  restart();
  assert.deepEqual(await send(command, 1, { eventId: 'same-open' }), replies[0]);
  await grant();
  const distinct = await Promise.all(Array.from({ length: 8 }, () => send(command)));
  assert.equal(distinct.filter(reply => reply.text.includes('Вот что выпало')).length, 1);
  assert.equal(db.player().kc, 300_000);
});

test('wallet overflow and a failed event record leave all cases and balances intact', async () => {
  const { send, grant, db, count } = await fixture();
  await grant();
  db.player().kc = game.maxAmount;
  assert.equal((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 })).text, itemTexts.limit);
  assert.equal(count(), 1);
  db.player().kc = 0;
  db.failRemember = true;
  const before = structuredClone(db.state);
  await assert.rejects(send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 }));
  assert.deepEqual(db.state, before);
});

test('gift moves exact quantities, allocates recipient IDs and queues one durable notification', async () => {
  const { send, grant, startTransfer, db, count } = await fixture();
  await grant(6);
  await grant(1, 2, 'zhdun_case');
  const command = await startTransfer('gift', 5);
  const replies = await Promise.all(Array.from({ length: 6 }, () => send(command)));
  assert.equal(replies.filter(reply => reply.text.startsWith('✅ Вы успешно')).length, 1);
  assert.equal(count(), 1);
  assert.equal(count(2), 6);
  assert.equal(db.player(2).nextItemId, 7);
  assert.equal(db.state.notifications.length, 1);
  assert.match(db.state.notifications[0]?.text ?? '', /подарил вам .* x5/);
  assert.equal(db.state.notifications[0]?.peerId, 2);
});

test('screen names resolve outside transactions; account IDs and explicit VK IDs are unambiguous', async () => {
  const { send, text, grant, resolves } = await fixture();
  assert.deepEqual(parsePlayerTarget('0'), { kind: 'number', id: 0 });
  assert.deepEqual(parsePlayerTarget('@id2'), { kind: 'vk', id: 2 });
  assert.deepEqual(parsePlayerTarget('https://vk.com/kreox_owner'), { kind: 'screen', name: 'kreox_owner' });
  await grant();
  await send({ kind: 'item_gift', itemKind: 'referral_case' });
  assert.equal((await text('0')).text, itemTexts.self);
  assert.equal((await text('@id999')).text, itemTexts.missing);
  assert.match((await text('@kreox_owner')).text, /Введите число предметов/);
  assert.equal(resolves(), 1);
});

test('sale price supports k and kk suffixes as total lot prices, not per-item prices', () => {
  assert.equal(parseItemPrice('10кк'), 1_000_000_000);
  assert.equal(parseItemPrice('100k'), 10_000_000);
  assert.equal(parseItemPrice('2КК'), 200_000_000);
  assert.equal(parseItemPrice('0'), 0);
  for (const text of ['-1', '1.5', '1e5', '10ккк', '90071992547410']) {
    assert.equal(parseItemPrice(text), null);
  }
});

test('sale reserves items, exchanges exact KC and ownership once, and sends the seller a notification', async () => {
  const { send, grant, offer, db, count } = await fixture();
  await grant(5);
  db.player(2).kc = 2_000_000_000;
  const record = await offer(5);
  assert.equal((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 })).text, itemTexts.reserved);
  assert.equal((await send({ kind: 'item_buy', offerId: record._id }, 3)).text, itemTexts.invalidOffer);
  const replies = await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'item_buy', offerId: record._id }, 2)));
  assert.equal(replies.filter(reply => reply.text.includes('сделка прошла успешно')).length, 1);
  assert.equal(count(), 0);
  assert.equal(count(2), 5);
  assert.equal(db.player().kc, 1_000_000_000);
  assert.equal(db.player(2).kc, 1_000_000_000);
  assert.equal(db.state.offers.get(record._id)?.state, 'completed');
  assert.equal(db.state.notifications.length, 2);
  assert.equal(db.state.notifications[0]?.keyboard?.kind, 'item_offer');
  assert.equal(db.state.notifications[1]?.keyboard?.kind, 'item_back');
});

test('reservation expires exactly at ten minutes after restart and cannot be bought late', async () => {
  const { send, grant, offer, db, restart } = await fixture();
  await grant();
  db.player(2).kc = 2_000_000_000;
  const record = await offer();
  assert.equal(record.expiresAt.getTime() - db.time.getTime(), itemConfig.offerDurationMs);
  db.time = new Date(record.expiresAt.getTime());
  restart();
  assert.equal((await send({ kind: 'item_buy', offerId: record._id }, 2)).text, itemTexts.expired);
  assert.match((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 })).text, /Вот что выпало/);
  assert.equal(db.player(2).kc, 2_000_000_000);
});

test('failed purchases preserve the reservation and do not partially move KC or inventory', async () => {
  const { send, grant, offer, db, count } = await fixture();
  await grant();
  const record = await offer();
  assert.equal((await send({ kind: 'item_buy', offerId: record._id }, 2)).text, itemTexts.funds);
  assert.equal(count(), 1);
  assert.equal(count(2), 0);
  db.player(2).kc = 2_000_000_000;
  db.player().kc = game.maxAmount;
  assert.equal((await send({ kind: 'item_buy', offerId: record._id }, 2)).text, itemTexts.limit);
  db.player().kc = 0;
  db.failRemember = true;
  const before = structuredClone(db.state);
  await assert.rejects(send({ kind: 'item_buy', offerId: record._id }, 2));
  assert.deepEqual(db.state, before);
});

test('reserved cases cannot be taken, gifted or double-reserved and release without a cleanup timer', async () => {
  const { send, text, grant, startTransfer, offer, db } = await fixture();
  await grant(2);
  const gift = await startTransfer('gift', 2);
  const record = await offer(2);
  assert.equal((await send(gift)).text, itemTexts.stale);
  assert.equal((await text('!takeitem @id1 2', 888801846)).text, itemTexts.none);
  assert.equal((await send({ kind: 'item_sell', itemKind: 'referral_case' })).text, itemTexts.reserved);
  db.time = new Date(record.expiresAt.getTime());
  assert.equal((await text('!takeitem @id1 2', 888801846)).text, 'Done.');
});

test('forged payload economics, quantity and ownership never override server state', async () => {
  const { send, grant, startTransfer, db } = await fixture();
  await grant(3);
  const confirm = await startTransfer('gift', 1);
  assert.deepEqual(parseCommand(undefined, { command: 'item_open', itemKind: 'referral_case', quantity: 999999, vkId: 1 }), { kind: 'development' });
  assert.equal((await send(confirm, 3)).text, itemTexts.stale);
  const parsed = parseCommand(undefined, { command: 'item_confirm', token: confirm.token, targetId: 3, quantity: 3 });
  await send(parsed);
  assert.equal(db.state.items.filter(item => item.vkId === 2).length, 1);
  assert.equal(db.state.items.filter(item => item.vkId === 3).length, 0);
});

test('all new keyboards fit VK limits, use text buttons and keep payloads below 255 bytes', () => {
  const specs: KeyboardSpec[] = [
    { kind: 'item_detail', itemKind: 'referral_case' }, { kind: 'item_use', itemKind: 'referral_case' },
    { kind: 'item_back', itemKind: 'zhdun_case' }, { kind: 'item_offer', offerId: '1'.repeat(200) },
    ...(['gift', 'sale', 'open'] as const).map(mode => ({ kind: 'item_confirmation' as const, mode, token: '1'.repeat(200) }))
  ];
  for (const spec of specs) {
    const value: unknown = JSON.parse(buildKeyboard(spec).toString());
    assert.ok(isRecord(value));
    assert.ok(Array.isArray(value.buttons));
    assert.ok(value.buttons.length <= 10);
    for (const row of value.buttons) {
      assert.ok(Array.isArray(row));
      assert.ok(row.length <= 4);
      for (const button of row) {
        assert.ok(isRecord(button));
        assert.ok(isRecord(button.action));
        assert.equal(button.action.type, 'text');
        assert.equal(typeof button.action.payload, 'string');
        if (typeof button.action.payload === 'string') {
          assert.ok(Buffer.byteLength(button.action.payload) <= 255);
        }
      }
    }
  }
});


test('item cards and use screens have exactly one blank line, only after the drop heading', () => {
  const drops = '💰 1.500 KC\n💰 2.500 KC\n💰 15.000 KC\n💶 1 евро\n💶 2 евро\n💶 5 евро';
  for (const entry of itemConfig.catalog) {
    assert.equal(itemDetails(entry.kind, 1), `📒 Предмет "${entry.name}" (x1):\nМожет выпасть:\n\n${drops}`);
    assert.equal(itemDetails(entry.kind, 5, true), `«${entry.name}» (доступно: 5 шт.):\nМожет выпасть:\n\n${drops}`);
  }
});

test('giveitem accepts an optional quantity, defaults to one, and handles mentions containing spaces or numbers', () => {
  for (const [text, quantity] of [
    ['!giveitem 0 1 10', 10], ['!giveitem 0 1 1', 1], ['!giveitem @id1 2 1000', 1000],
    ['!giveitem [id1|Имя 1 2] 1 10', 10], ['!giveitem 0 1', 1]
  ] as const) {
    const command = parseCommand(text, undefined);
    assert.equal(command.kind, 'admin_item');
    if (command.kind !== 'admin_item') {
      assert.fail('Invalid give command');
    }
    assert.equal(command.operation, 'give');
    assert.equal(command.quantity, quantity);
  }
  for (const text of ['!giveitem 0 1 0', '!giveitem 0 1 -1', '!giveitem 0 1 1.5', '!giveitem 0 1 1001',
    '!giveitem 0 1 999999999999999999', '!giveitem 0 1 1k', '!giveitem 0 1 10 20', '!takeitem 0 1 10']) {
    assert.deepEqual(parseCommand(text, undefined), { kind: 'admin_item_invalid' });
  }
});

test('batch give is atomic and deduplicated, allocates consecutive IDs and shows one stack', async () => {
  const { text, send, db } = await fixture();
  const first = await text('!giveitem 0 1 10', 888801846, { eventId: 'batch-give' });
  assert.equal(first.text, 'Done.');
  assert.equal(db.state.items.length, 10);
  assert.deepEqual(db.state.items.map(item => item.itemId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(db.player().nextItemId, 11);
  assert.deepEqual(await text('!giveitem 0 1 10', 888801846, { eventId: 'batch-give' }), first);
  assert.equal(db.state.items.length, 10);
  const inventory = await send({ kind: 'inventory', page: 0 });
  assert.equal(inventory.text, '🎒 Ваш инвентарь:\n\n🆔 1 — 💼 Кейс «Ждун» (10 шт.)');
  assert.deepEqual(inventory.keyboard, { kind: 'inventory', page: 0, itemIds: [1], hasNext: false });
  const chat = await send({ kind: 'inventory', page: 0 }, 1, { isChat: true });
  assert.equal(chat.text, inventory.text);
  assert.deepEqual(chat.keyboard, { kind: 'none' });
  const before = structuredClone(db.state);
  db.failRemember = true;
  await assert.rejects(text('!giveitem 0 1 10', 888801846));
  assert.deepEqual(db.state, before);
});

test('batch give refuses an exhausted ID range without partial allocation', async () => {
  const { text, db } = await fixture();
  db.player().nextItemId = game.maxAmount - 5;
  assert.equal((await text('!giveitem 0 1 10', 888801846)).text, itemTexts.limit);
  assert.equal(db.state.items.length, 0);
  assert.equal(db.player().nextItemId, game.maxAmount - 5);
});

test('a single referral case is displayed with its personal ID and explicit quantity', async () => {
  const { grant, send } = await fixture();
  await grant(1, 1, 'zhdun_case');
  await grant(1);
  const inventory = await send({ kind: 'inventory', page: 0 });
  assert.equal(inventory.text, '🎒 Ваш инвентарь:\n\n🆔 1 — 💼 Кейс «Ждун» (1 шт.)\n🆔 2 — 👬 Кейс «Реферальный» (1 шт.)');
});


test('legacy IDs 4 to 7 form one four-unit stack with one working button and update after use', async () => {
  const { db, send, text, grant } = await fixture();
  db.state.items = [7, 5, 4, 6].map(itemId => ({
    _id: `1:${itemId}`, vkId: 1, itemId, kind: 'referral_case'
  }));
  db.player().nextItemId = 8;
  await grant(20, 2);
  const before = structuredClone(db.state.items);
  const inventory = await send({ kind: 'inventory', page: 0 });
  assert.equal(inventory.text, '🎒 Ваш инвентарь:\n\n🆔 4 — 👬 Кейс «Реферальный» (4 шт.)');
  assert.deepEqual(inventory.keyboard, { kind: 'inventory', page: 0, itemIds: [4], hasNext: false });
  assert.equal((await send({ kind: 'inventory', page: 0 }, 1, { isChat: true })).text, inventory.text);
  assert.deepEqual(db.state.items, before);
  assert.equal((await send({ kind: 'item', itemId: 4 })).text, itemDetails('referral_case', 4));
  await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 });
  assert.equal((await send({ kind: 'inventory', page: 0 })).text,
    '🎒 Ваш инвентарь:\n\n🆔 5 — 👬 Кейс «Реферальный» (3 шт.)');
  assert.equal((await text('!takeitem 0 2', 888801846)).text, 'Done.');
  assert.equal((await text('!giveitem 0 2', 888801846)).text, 'Done.');
  assert.equal((await send({ kind: 'inventory', page: 0 })).text,
    '🎒 Ваш инвентарь:\n\n🆔 6 — 👬 Кейс «Реферальный» (3 шт.)');
});

test('gifts and purchases merge with existing stacks while reservations remain unavailable for use', async () => {
  const { send, grant, startTransfer, offer } = await fixture();
  await grant(4);
  await grant(2, 2);
  const confirmation = await startTransfer('gift', 2);
  await send(confirmation);
  assert.equal((await send({ kind: 'inventory', page: 0 }, 2)).text,
    '🎒 Ваш инвентарь:\n\n🆔 1 — 👬 Кейс «Реферальный» (4 шт.)');
  const sale = await offer(1, '0');
  assert.equal((await send({ kind: 'inventory', page: 0 })).text,
    '🎒 Ваш инвентарь:\n\n🆔 3 — 👬 Кейс «Реферальный» (2 шт.)');
  assert.equal((await send({ kind: 'item', itemId: 3 })).text, itemDetails('referral_case', 1));
  await send({ kind: 'item_buy', offerId: sale._id }, 2);
  assert.equal((await send({ kind: 'inventory', page: 0 }, 2)).text,
    '🎒 Ваш инвентарь:\n\n🆔 1 — 👬 Кейс «Реферальный» (5 шт.)');
  const inventory = await send({ kind: 'inventory', page: 0 });
  assert.equal(inventory.text, '🎒 Ваш инвентарь:\n\n🆔 4 — 👬 Кейс «Реферальный» (1 шт.)');
  assert.deepEqual(inventory.keyboard, { kind: 'inventory', page: 0, itemIds: [4], hasNext: false });
});

test('case results have only one blank line after the heading and consecutive reward rows', async () => {
  const { db } = await fixture();
  assert.equal(caseResultText(db.player(), { kc: 1_750_000, euro: 0, counts: [0, 1, 1, 0, 0, 0] }),
    '[id1|Игрок], 🎁 Вот что выпало:\n\n💰 2.500 KC\n💰 15.000 KC');
  const rolls = [30, 60, 30, 60, 90];
  let index = 0;
  const { grant, send } = await fixture(() => {
    const value = rolls[index++];
    assert.ok(value !== undefined);
    return value;
  });
  await grant(5);
  assert.equal((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 5 })).text,
    '[id1|Игрок], 🎁 Вот что выпало:\n\n💰 2.500 KC x2\n💰 15.000 KC x2\n💶 1 евро');
});

test('gift and sale target prompts use consecutive lines and the explicit VK mention', async () => {
  const { grant, send, text } = await fixture();
  await grant();
  for (const kind of ['item_gift', 'item_sell'] as const) {
    assert.equal((await send({ kind, itemKind: 'referral_case' })).text,
      '👤 Введите ссылку на игрока.\n💡 Например [id888801846|@kreox_owner]');
    await text('отмена');
  }
});

test('fully reserved stacks show the exact warning on all item entry points until the expiry boundary', async () => {
  const { grant, offer, send, db, restart } = await fixture();
  await grant();
  const sale = await offer(1, '0');
  const warning = '⚠️ У вас есть активная сделка на данный предмет!\n\n⏳ Подождите принятия сделки или аннулирование сделки.';
  const before = structuredClone(db.state.items);
  assert.equal((await send({ kind: 'item', itemId: 1 })).text, warning);
  for (const kind of ['item_detail', 'item_use', 'item_custom', 'item_gift', 'item_sell'] as const) {
    assert.equal((await send({ kind, itemKind: 'referral_case' })).text, warning);
  }
  assert.equal((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 })).text, warning);
  assert.equal(db.player().kc, 0);
  assert.deepEqual(db.state.items, before);
  assert.equal((await send({ kind: 'item_detail', itemKind: 'zhdun_case' })).text, itemTexts.none);
  assert.equal((await send({ kind: 'item_detail', itemKind: 'referral_case' }, 3)).text, itemTexts.none);
  db.time = new Date(sale.expiresAt.getTime() - 1);
  restart();
  assert.equal((await send({ kind: 'item', itemId: 1 })).text, warning);
  db.time = new Date(sale.expiresAt.getTime());
  assert.equal((await send({ kind: 'item', itemId: 1 })).text, itemDetails('referral_case', 1));
  assert.match((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 })).text, /Вот что выпало/);
  assert.equal((await send({ kind: 'item_detail', itemKind: 'referral_case' })).text, itemTexts.none);
});

test('one of two cases can be opened while the other stays reserved and can still be purchased', async () => {
  const { grant, offer, send, db } = await fixture();
  await grant(2);
  const sale = await offer(1, '0');
  const reserved = structuredClone(db.state.items.find(item => item.offerId === sale._id));
  assert.ok(reserved);
  assert.equal((await send({ kind: 'item', itemId: reserved.itemId })).text, itemDetails('referral_case', 1));
  assert.equal((await send({ kind: 'item_use', itemKind: 'referral_case' })).text, itemDetails('referral_case', 1, true));
  assert.match((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 })).text, /Вот что выпало/);
  assert.equal(db.player().kc, 150_000);
  assert.deepEqual(db.state.items, [reserved]);
  assert.equal((await send({ kind: 'item', itemId: reserved.itemId })).text, itemTexts.reserved);
  assert.equal((await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 })).text, itemTexts.reserved);
  await send({ kind: 'item_buy', offerId: sale._id }, 2);
  assert.equal(db.state.items.filter(item => item.vkId === 1).length, 0);
  assert.equal(db.state.items.filter(item => item.vkId === 2).length, 1);
  assert.equal((await send({ kind: 'item_detail', itemKind: 'referral_case' })).text, itemTexts.none);
});
