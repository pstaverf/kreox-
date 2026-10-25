import assert from 'node:assert/strict';
import { test } from 'node:test';
import { donateConfig } from '../src/config/donate.js';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { GameService } from '../src/services/game.js';
import { validNickname } from '../src/services/donate-rules.js';
import { donateTexts, moscowDate } from '../src/services/donate-texts.js';
import type { DonateRandom } from '../src/services/donate.js';
import type { Command, GameInput, KeyboardSpec } from '../src/types/game.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

async function fixture(random: DonateRandom = (_purpose, maximum) => maximum - 1) {
  const db = new MemoryDatabase();
  let service = new GameService(db, undefined, undefined, undefined, random);
  let sequence = 0;
  let memberCalls = 0;
  let members = [1, 2];
  const send = (command: Command, id = 1, extra: Partial<GameInput> = {}) => service.handle({
    eventId: `donate-${sequence++}`, vkId: id, command, ...extra
  }, async () => `Игрок ${id}`, async () => {
    memberCalls += 1;
    await db.transaction(async () => {});
    return members;
  });
  const text = (value: string, id = 1, chat = false) => send(parseCommand(value, undefined, chat), id, { text: value, isChat: chat });
  for (const id of [1, 2, 3]) await send({ kind: 'profile' }, id);
  const confirmation = async (kind: 'donate_thief' | 'donate_dealer', id = 1) => {
    const reply = await send({ kind }, id);
    assert.equal(reply.keyboard.kind, 'donate_confirmation');
    if (reply.keyboard.kind !== 'donate_confirmation') throw new Error('Missing donate confirmation');
    return { kind: 'donate_confirm', token: reply.keyboard.token } as const;
  };
  const subscribe = async () => {
    db.player().euro = donateConfig.subscriptionCost;
    await send(await confirmation('donate_thief'));
  };
  return { db, send, text, confirmation, subscribe, memberCalls: () => memberCalls,
    members: (ids: number[]) => { members = ids; }, restart: () => { service = new GameService(db, undefined, undefined, undefined, random); } };
}

test('donate keyboards have payloads, correct colors and only dealer confirmations are inline', () => {
  const specs: KeyboardSpec[] = [{ kind: 'donate' }, { kind: 'donate_back' },
    { kind: 'donate_confirmation', token: 'test', inline: false }, { kind: 'donate_confirmation', token: 'test', inline: true }];
  for (const spec of specs) {
    const value: unknown = JSON.parse(buildKeyboard(spec).toString());
    assert.ok(isRecord(value));
    assert.ok(Array.isArray(value.buttons));
    assert.equal(Boolean(value.inline), spec.kind === 'donate_confirmation' && spec.inline);
    for (const row of value.buttons) {
      assert.ok(Array.isArray(row));
      for (const button of row) {
        assert.ok(isRecord(button));
        assert.ok(isRecord(button.action));
        assert.equal(button.action.type, 'text');
        assert.equal(typeof button.action.payload, 'string');
        if (typeof button.action.payload !== 'string') throw new Error('Missing payload');
        assert.ok(Buffer.byteLength(button.action.payload) <= 255);
        assert.notEqual(parseCommand(undefined, button.action.payload).kind, 'development');
        if (spec.kind === 'donate_confirmation') assert.equal(button.color, button.action.label === '✅ Подтвердить' ? 'positive' : 'negative');
      }
    }
  }
  assert.deepEqual(parseCommand('купитькрупье', undefined), { kind: 'dealer_buy' });
  assert.deepEqual(parseCommand('Купить крупье', undefined, true), { kind: 'dealer_buy' });
  assert.deepEqual(parseCommand('ВОР', undefined, true), { kind: 'theft' });
  assert.deepEqual(parseCommand('вор', undefined), { kind: 'development' });
  assert.deepEqual(parseCommand('Крупье', undefined, true), { kind: 'dealer_view' });
  for (const label of ['🍩 Донат', '👤 Ник', '🥷 Вор', '🤵‍♂️ Крупье', '✅ Подтвердить', '💢 Отмена']) assert.deepEqual(parseCommand(label, undefined), { kind: 'development' });
});

test('nickname wizard validates length and mention safety, charges once, survives restart and updates all mentions', async () => {
  const { send, text, db, restart } = await fixture();
  db.player().euro = 2_417_800;
  assert.equal((await send({ kind: 'donate' })).text, '💶 Донат:');
  assert.equal((await send({ kind: 'donate_nick' })).text, '👤 Введите новый ник. Смена ника стоит 50 💶 (у вас: 24.178 💶).');
  for (const value of ['abc', 'x'.repeat(21)]) assert.equal((await text(value)).text, donateTexts.length);
  for (const value of ['[id2|Name]', '@all', 'abc\ndef', '*club123', 'ab\u202ecd']) assert.equal(validNickname(value), false);
  const offered = await text("'felix");
  assert.equal(offered.text, "Вы уверены, что хотите сменить свой ник на: 'felix?");
  assert.equal(offered.keyboard.kind, 'donate_confirmation');
  if (offered.keyboard.kind !== 'donate_confirmation') throw new Error('Missing confirmation');
  assert.equal(db.player().euro, 2_417_800);
  restart();
  const command = { kind: 'donate_confirm', token: offered.keyboard.token } as const;
  const reply = await send(command, 1, { eventId: 'rename-once' });
  assert.equal(reply.text, "[id1|'felix], отличный ник!");
  assert.equal(db.player().euro, 2_412_800);
  assert.equal(db.player().name, "'felix");
  assert.deepEqual(await send(command, 1, { eventId: 'rename-once' }), reply);
  assert.equal((await send(command)).text, donateTexts.stale);
  assert.equal((await send(command, 2)).text, donateTexts.stale);
  assert.match((await send({ kind: 'profile' })).text, /\[id1\|'felix\]/);
  assert.match((await send({ kind: 'ranking', metric: 'kc' })).text, /\[id1\|'felix\]/);
  assert.equal(validNickname('😀😀😀😀'), true);
});

test('cancel and insufficient funds never change the nickname or debit euros; failed remember rolls back', async () => {
  const { send, text, db } = await fixture();
  const prepare = async () => {
    await send({ kind: 'donate_nick' });
    const reply = await text('Новый ник');
    if (reply.keyboard.kind !== 'donate_confirmation') throw new Error('Missing confirmation');
    return reply.keyboard.token;
  };
  const first = await prepare();
  assert.equal((await send({ kind: 'donate_cancel', token: first })).text, 'Действие отменено.');
  assert.equal((await send({ kind: 'donate_confirm', token: first })).text, donateTexts.stale);
  const token = await prepare();
  assert.equal((await send({ kind: 'donate_confirm', token })).text, donateTexts.funds);
  db.player().euro = 50 * game.euroScale;
  db.failRemember = true;
  const before = structuredClone(db.state);
  await assert.rejects(send({ kind: 'donate_confirm', token }));
  assert.deepEqual(db.state, before);
});

test('thief subscription lasts exactly 30 days, formats Moscow date, cannot double-charge, and has no implicit renewal', async () => {
  const { send, confirmation, db, restart } = await fixture();
  db.time = new Date('2026-10-24T22:05:00Z');
  db.player().euro = 40_000;
  const command = await confirmation('donate_thief');
  const replies = await Promise.all(Array.from({ length: 8 }, () => send(command)));
  assert.equal(replies.filter(reply => reply.text.startsWith('✅ Подписка на команду «вор» была приобретена.')).length, 1);
  assert.equal(db.player().euro, 20_000);
  assert.equal(db.player().thiefUntil?.getTime(), db.time.getTime() + donateConfig.subscriptionMs);
  assert.ok(replies.some(reply => reply.text.endsWith('📆 Подписка активна до 24.11.2026 01:05')));
  assert.equal(moscowDate(new Date('2026-12-31T21:00:00Z')), '01.01.2027 00:00');
  restart();
  const active = await send({ kind: 'donate_thief' });
  assert.equal(active.keyboard.kind, 'donate_back');
  assert.match(active.text, /активна/);
  assert.equal(db.player().euro, 20_000);
  const until = db.player().thiefUntil;
  assert.ok(until);
  db.time = new Date(until);
  await send(await confirmation('donate_thief'));
  assert.equal(db.player().euro, 0);
});

test('theft is chat-only, takes full whole KC only from registered chat members, and persists one-hour cooldown', async () => {
  const { subscribe, text, send, db, members, memberCalls, restart } = await fixture();
  assert.match((await text('вор', 1, true)).text, /купите подписку/);
  assert.equal(memberCalls(), 0);
  await subscribe();
  db.player(2).kc = 12_345;
  db.player(3).kc = 999_999;
  members([1, 2, 777]);
  const first = await text('вор', 1, true);
  assert.equal(first.text, '[id1|Игрок 1] украл у игрока [id2|Игрок 2] 123 KC.');
  assert.equal(db.player(2).kc, 45);
  assert.equal(db.player(3).kc, 999_999);
  assert.equal(db.player().kc, 12_300);
  assert.equal(db.player().stolenKC, 12_300);
  assert.equal(db.state.notifications.length, 1);
  assert.equal(db.state.notifications[0]?.text, '[id1|Игрок 1] украл у тебя 123 KC');
  restart();
  assert.equal((await text('вор', 1, true)).text, '[id1|Игрок 1], своровать можно будет через 60 мин. 0 сек.');
  assert.equal(memberCalls(), 1);
  await assert.rejects(send({ kind: 'theft' }));
  db.time = new Date(db.time.getTime() + donateConfig.theftCooldownMs - 1);
  assert.match((await text('вор', 1, true)).text, /через 0 мин. 1 сек\./);
  db.time = new Date(db.time.getTime() + 1);
  assert.match((await text('вор', 1, true)).text, / 0 KC\.$/);
  assert.equal(db.player(2).kc, 45);
  assert.equal(db.state.notifications.length, 2);
  const ranking = await send({ kind: 'ranking', metric: 'stolenKC' });
  assert.match(ranking.text, /123 KC/);
});

test('zero thefts set cooldown; expired subscriptions, missing victims and overflow are safe', async () => {
  const { subscribe, text, db, members } = await fixture(() => 0);
  await subscribe();
  db.player(2).kc = 200;
  assert.match((await text('вор', 1, true)).text, / 0 KC\.$/);
  assert.equal(db.player(2).kc, 200);
  assert.ok(db.player().nextTheftAt);
  const until = db.player().thiefUntil;
  assert.ok(until);
  db.time = new Date(until);
  assert.match((await text('вор', 1, true)).text, /купите подписку/);
  await subscribe();
  members([1, 999]);
  assert.equal((await text('вор', 1, true)).text, donateTexts.noVictim);
  const other = await fixture();
  await other.subscribe();
  other.db.player().kc = game.maxAmount;
  other.db.player(2).kc = 100;
  assert.equal((await other.text('вор', 1, true)).text, donateTexts.limit);
  assert.equal(other.db.player(2).kc, 100);
  assert.equal(other.db.player().nextTheftAt, undefined);
});

test('theft replay, parallel requests and failed outbox/event transaction cannot duplicate or lose KC', async () => {
  const { subscribe, send, db } = await fixture();
  await subscribe();
  db.player(2).kc = 1_000;
  const input = { isChat: true, eventId: 'same-theft' };
  const replies = await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'theft' }, 1, input)));
  assert.ok(replies.every(reply => reply.randomId === replies[0]?.randomId));
  assert.equal(db.player().kc, 1000);
  assert.equal(db.player(2).kc, 0);
  assert.equal(db.state.notifications.length, 1);
  db.time = new Date(db.time.getTime() + donateConfig.theftCooldownMs);
  db.player(2).kc = 500;
  db.failRemember = true;
  const before = structuredClone(db.state);
  await assert.rejects(send({ kind: 'theft' }, 1, { isChat: true }));
  assert.deepEqual(db.state, before);
});

test('dealer has one global cooldown; replaces role, pays the old holder once and queues an outbox message', async () => {
  const { send, text, confirmation, db, restart } = await fixture();
  db.player().euro = 3_000;
  db.player(2).euro = 3_000;
  assert.match((await text('Крупье', 1, true)).text, /Государство/);
  const command = await confirmation('donate_dealer');
  assert.equal((await send(command)).text, '[id1|Игрок 1], вы успешно стали новым крупье.');
  assert.equal(db.player().euro, 1_500);
  assert.equal(db.state.dealer.holderId, 1);
  assert.equal((await text('Купитькрупье')).text, donateTexts.self);
  assert.equal((await text('Купить крупье', 2, true)).text, '⚠️ Вы уже недавно становились крупье! Подождите еще 15 мин. 0 сек.');
  db.state.dealer.earnedKC = 12_345;
  assert.equal((await text('Крупье', 2, true)).text, '🤑 Крупье: [id1|Игрок 1] (заработал: 123.45 KC)');
  restart();
  db.time = new Date(db.time.getTime() + donateConfig.dealerCooldownMs);
  const replies = await Promise.all(Array.from({ length: 8 }, () => text('купитькрупье', 2, true)));
  assert.equal(replies.filter(reply => reply.text.includes('вы успешно стали')).length, 1);
  assert.equal(db.player(2).euro, 1_500);
  assert.equal(db.player().kc, 12_345);
  assert.equal(db.state.dealer.holderId, 2);
  assert.equal(db.state.dealer.earnedKC, 0);
  assert.equal(db.state.notifications[0]?.text, '[id2|Игрок 2] стал новым крупье. Вы успели заработать: 123.45 KC');
});

test('croupier item ID 3 bypasses global cooldown without consumption and cannot be opened as a case', async () => {
  const { send, text, db } = await fixture();
  db.player().euro = 1_500;
  db.player(2).euro = 3_000;
  await text('купитькрупье');
  assert.equal((await text('!giveitem @id2 3', 888801846)).text, 'Done.');
  assert.match((await send({ kind: 'inventory', page: 0 }, 2)).text, /🤴 Крупьер \(1 шт\.\)/);
  const before = structuredClone(db.state.items);
  assert.match((await send({ kind: 'item_open', itemKind: 'croupier', quantity: 1 }, 2)).text, /Снимает КД/);
  assert.deepEqual(db.state.items, before);
  assert.equal((await text('купитькрупье', 2)).text, '[id2|Игрок 2], вы успешно стали новым крупье.');
  assert.deepEqual(db.state.items, before);
  assert.equal((await text('купитькрупье', 2)).text, donateTexts.self);
});

test('dealer failures and rollback preserve buyer funds, pending payout and current role', async () => {
  const { text, send, confirmation, db } = await fixture();
  assert.equal((await text('купитькрупье')).text, donateTexts.funds);
  const command = await confirmation('donate_dealer');
  assert.equal((await send({ kind: 'donate_cancel', token: command.token })).text, donateTexts.cancelled);
  assert.equal((await send(command)).text, donateTexts.stale);
  db.player().euro = 1_500;
  await text('купитькрупье');
  db.state.dealer.earnedKC = 100;
  db.player().kc = game.maxAmount;
  db.player(2).euro = 1_500;
  db.time = new Date(db.time.getTime() + donateConfig.dealerCooldownMs);
  assert.equal((await text('купитькрупье', 2)).text, donateTexts.limit);
  assert.equal(db.player(2).euro, 1_500);
  db.player().kc = 0;
  db.failRemember = true;
  const before = structuredClone(db.state);
  await assert.rejects(text('купитькрупье', 2));
  assert.deepEqual(db.state, before);
});

test('distinct concurrent theft messages consume one cooldown and cannot steal twice', async () => {
  const { db, subscribe, text } = await fixture();
  await subscribe();
  db.player(2).kc = 10_000;
  const results = await Promise.all(Array.from({ length: 10 }, () => text('вор', 1, true)));
  assert.equal(results.filter(reply => reply.text.includes('украл у игрока')).length, 1);
  assert.equal(results.filter(reply => reply.text.includes('своровать можно будет через')).length, 9);
  assert.equal(db.player().kc, 10_000);
  assert.equal(db.player(2).kc, 0);
  assert.equal(db.state.notifications.length, 1);
});

test('thief purchase cancellation, lack of funds and record failure do not activate or debit the subscription', async () => {
  const { db, send, confirmation } = await fixture();
  const cancelled = await confirmation('donate_thief');
  await send({ kind: 'donate_cancel', token: cancelled.token });
  assert.equal((await send(cancelled)).text, donateTexts.stale);
  const command = await confirmation('donate_thief');
  assert.equal((await send(command)).text, donateTexts.funds);
  db.player().euro = donateConfig.subscriptionCost;
  const before = structuredClone(db.state);
  db.failRemember = true;
  await assert.rejects(send(command));
  assert.deepEqual(db.state, before);
  assert.equal(db.player().thiefUntil, undefined);
});

test('croupier perk follows ownership through gifts and sales rather than being remembered on the former owner', async () => {
  const { db, send, text } = await fixture();
  for (const id of [1, 2, 3]) db.player(id).euro = 10_000;
  await text('купитькрупье');
  await text('!giveitem @id2 3', 888801846);
  await send({ kind: 'item_gift', itemKind: 'croupier' }, 2);
  await text('@id3', 2);
  const gift = await text('1', 2);
  assert.ok(gift.keyboard.kind === 'item_confirmation');
  await send({ kind: 'item_confirm', token: gift.keyboard.token }, 2);
  assert.match((await text('купитькрупье', 2)).text, /Подождите еще/);
  assert.match((await text('купитькрупье', 3)).text, /вы успешно стали/);
  await send({ kind: 'item_sell', itemKind: 'croupier' }, 3);
  await text('@id2', 3);
  await text('1', 3);
  const sale = await text('0', 3);
  assert.ok(sale.keyboard.kind === 'item_confirmation');
  await send({ kind: 'item_confirm', token: sale.keyboard.token }, 3);
  const offer = [...db.state.offers.values()][0];
  assert.ok(offer);
  await send({ kind: 'item_buy', offerId: offer._id }, 2);
  assert.match((await text('купитькрупье', 2)).text, /вы успешно стали/);
  assert.equal(db.state.items.length, 1);
  assert.equal(db.state.items[0]?.vkId, 2);
  assert.equal(db.state.items[0]?.kind, 'croupier');
});

test('theft reaches the safe integer limit without fractional KC or overflow', async () => {
  const { db, subscribe, text } = await fixture();
  await subscribe();
  db.player(2).kc = game.maxAmount;
  assert.match((await text('вор', 1, true)).text, /украл у игрока/);
  assert.equal(db.player().kc, 9_007_199_254_740_900);
  assert.equal(db.player().stolenKC, 9_007_199_254_740_900);
  assert.equal(db.player(2).kc, 91);
  assert.equal(Number.isSafeInteger(db.player().kc), true);
});

test('chat theft does not cancel another active DM wizard', async () => {
  const { db, send, text, subscribe } = await fixture();
  await subscribe();
  await send({ kind: 'item_custom', itemKind: 'referral_case' });
  await db.transaction(async store => { await store.setItemDraft(1, { step: 'custom', itemKind: 'referral_case' }); });
  await text('вор', 1, true);
  assert.deepEqual(db.player().itemDraft, { step: 'custom', itemKind: 'referral_case' });
});
