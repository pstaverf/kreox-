import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { GameService } from '../src/services/game.js';
import { isPromoName, parsePromoInteger, promoScale, promoTotal } from '../src/services/promo-rules.js';
import { promoAmountPrompt, promoTexts } from '../src/services/promo-texts.js';
import { labels, texts } from '../src/services/texts.js';
import type { Command, GameInput, KeyboardSpec } from '../src/types/game.js';
import type { PromoCurrency } from '../src/types/promo.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

async function fixture() {
  const database = new MemoryDatabase();
  let service = new GameService(database);
  let sequence = 0;
  const send = (command: Command, vkId = 1, extra: Partial<GameInput> = {}) => service.handle({
    eventId: `promo-${sequence++}`, vkId, command, ...extra
  }, async () => 'Игрок');
  const text = (value: string, vkId = 1, extra: Partial<GameInput> = {}) => send(parseCommand(value, undefined), vkId, { text: value, ...extra });
  for (const id of [1, 2, 3]) {
    await send({ kind: 'profile' }, id);
    database.player(id).kc = 100_000_000;
    database.player(id).euro = 100_000_000;
    database.player(id).bitcoin = 100_000_000_000;
  }
  const prepare = async (name = 'Подарок', currency: PromoCurrency = 'kc', owner = 1, quantity = '5') => {
    assert.equal((await send({ kind: 'promo_create' }, owner)).text, promoTexts.currency);
    assert.equal((await send({ kind: 'promo_currency', currency }, owner)).text, promoTexts.name);
    assert.equal((await text(name, owner)).text, promoAmountPrompt(currency));
    assert.equal((await text(currency === 'kc' ? '10.000' : '5', owner)).text, promoTexts.quantity);
    const reply = await text(quantity, owner);
    assert.equal(reply.text, promoTexts.confirm);
    assert.equal(reply.keyboard.kind, 'promo_confirm');
    if (reply.keyboard.kind !== 'promo_confirm') {
      throw new Error('Missing confirmation');
    }
    return { kind: 'promo_confirm', token: reply.keyboard.token } as const;
  };
  const activate = async (name = 'Подарок', vkId = 2) => {
    assert.equal((await send({ kind: 'promo_activate' }, vkId)).text, promoTexts.activate);
    return text(name, vkId);
  };
  return { database, send, text, prepare, activate, restart: () => { service = new GameService(database); } };
}

test('promo menu and city use the requested texts, and Back cancels the durable wizard', async () => {
  const { send, database, text } = await fixture();
  assert.equal((await send({ kind: 'promo' })).text, '🎁 Меню промокодов:');
  assert.equal((await send({ kind: 'city' })).text, '🏙️ Стройка уже идёт!\n\n💫 Скоро город будет сиять раньше остальных…');
  await send({ kind: 'promo_create' });
  await send({ kind: 'promo_currency', currency: 'kc' });
  assert.equal((await send({ kind: 'promo_back' })).text, promoTexts.menu);
  assert.equal(database.player().promoDraft, undefined);
  assert.equal((await text('Название')).text, texts.development);
  await send({ kind: 'promo_activate' });
  await send({ kind: 'menu' });
  assert.equal(database.player().promoDraft, undefined);
});

for (const currency of ['kc', 'euro', 'bitcoin'] as const) {
  test(`promo creation and activation conserve ${currency}, with exact scaled integers and one use per player`, async () => {
    const { send, prepare, activate, database } = await fixture();
    const before = database.player()[currency];
    const beforeReceiver = database.player(2)[currency];
    const confirmation = await prepare('Подарок', currency);
    const reward = game.promo.minimum[currency] * promoScale(currency);
    assert.equal(database.player()[currency], before);
    assert.equal((await send(confirmation)).text, promoTexts.created);
    assert.equal(database.player()[currency], before - reward * 5);
    assert.match((await activate()).text, /^🎁 Активация промокода успешна! Ваши награды:\n\n/);
    assert.equal(database.player(2)[currency], beforeReceiver + reward);
    assert.equal(database.state.promos.get('Подарок')?.remaining, 4);
    assert.equal((await activate()).text, promoTexts.already);
    assert.equal((await activate('Подарок', 1)).text, promoTexts.own);
    assert.equal(database.player(2)[currency], beforeReceiver + reward);
    assert.equal(database.state.redemptions.size, 1);
  });
}

test('names require 5–20 Unicode characters and do not allow control characters or invalid surrogate sequences', async () => {
  const { send, text } = await fixture();
  await send({ kind: 'promo_create' });
  await send({ kind: 'promo_currency', currency: 'kc' });
  for (const value of ['abcd', 'x'.repeat(21)]) {
    assert.equal((await text(value)).text, '⚠️ Введите 5-20 символов.');
  }
  for (const value of ['abc\ndef', 'abc\u202Edef', 'abcd\uD800']) {
    assert.equal((await text(value)).text, promoTexts.nameInvalid);
  }
  assert.ok(isPromoName('😀'.repeat(5)));
  assert.ok(isPromoName('x'.repeat(20)));
  assert.equal((await text('😀'.repeat(5))).text, promoAmountPrompt('kc'));
});

test('whole-number amounts, grouped thousands, quantity minima and safe integer products are validated', async () => {
  assert.equal(parsePromoInteger('10.000'), 10000);
  for (const value of ['5.5', '5,5', '5e5', '-5', 'Infinity', '0x100', '9007199254740992', '1 000']) {
    assert.equal(parsePromoInteger(value), null);
  }
  assert.equal(promoTotal(game.maxAmount, 5), null);
  assert.equal(promoTotal(1, 4), null);
  const { send, text, database } = await fixture();
  await send({ kind: 'promo_create' });
  await send({ kind: 'promo_currency', currency: 'bitcoin' });
  await text('Минимум');
  for (const value of ['4', '5.5', '5,5']) {
    assert.equal((await text(value)).text, promoAmountPrompt('bitcoin'));
  }
  assert.equal((await text('9007199254740991')).text, promoTexts.limit);
  await text('5');
  for (const value of ['4', '5.5', '-100']) {
    assert.equal((await text(value)).text, promoTexts.quantity);
  }
  assert.equal((await text('9007199254740991')).text, promoTexts.limit);
  assert.equal(database.state.promos.size, 0);
});

test('an unfunded promo neither debits nor publishes, and the same offer can be funded and retried', async () => {
  const { prepare, send, database } = await fixture();
  database.player().kc = 4_999_999;
  const command = await prepare();
  assert.equal((await send(command)).text, promoTexts.funds);
  assert.equal(database.player().kc, 4_999_999);
  assert.equal(database.state.promos.size, 0);
  database.player().kc = 5_000_000;
  assert.equal((await send(command)).text, promoTexts.created);
  assert.equal(database.player().kc, 0);
});

test('names are globally unique, case-sensitive, and stay reserved after all activations are spent', async () => {
  const { prepare, send, text, activate, database } = await fixture();
  await send(await prepare());
  await send(await prepare('подарок'));
  assert.equal(database.state.promos.size, 2);
  await send({ kind: 'promo_create' }, 2);
  await send({ kind: 'promo_currency', currency: 'kc' }, 2);
  assert.match((await text('Подарок', 2)).text, /уже существует/);
  const promo = database.state.promos.get('Подарок');
  assert.ok(promo);
  promo.remaining = 0;
  assert.equal((await activate('Подарок', 3)).text, promoTexts.empty);
  await send({ kind: 'promo_create' }, 3);
  await send({ kind: 'promo_currency', currency: 'kc' }, 3);
  assert.match((await text('Подарок', 3)).text, /уже существует/);
});

test('unknown promo names leave activation open for retry and never change balances', async () => {
  const { send, text, database } = await fixture();
  const before = database.player().kc;
  await send({ kind: 'promo_activate' });
  for (const value of ['нету', 'Неизвестный', 'x'.repeat(500)]) {
    assert.equal((await text(value)).text, '⚠️ Такого промокода не существует!');
  }
  assert.equal(database.player().kc, before);
  assert.equal(database.player().promoDraft?.step, 'activate');
});

test('confirmation and redemption roll back with the processed event, so failed operations can be retried', async () => {
  const { prepare, send, text, database } = await fixture();
  const command = await prepare();
  const before = structuredClone(database.state);
  database.failRemember = true;
  await assert.rejects(send(command));
  assert.deepEqual(database.state, before);
  database.failRemember = false;
  await send(command);
  await send({ kind: 'promo_activate' }, 2);
  const beforeActivation = structuredClone(database.state);
  database.failRemember = true;
  await assert.rejects(text('Подарок', 2));
  assert.deepEqual(database.state, beforeActivation);
  database.failRemember = false;
  assert.match((await text('Подарок', 2)).text, /успешна/);
});

test('parallel confirmations and delivery replay after restart cannot debit twice or recreate a used offer', async () => {
  const { prepare, send, restart, database } = await fixture();
  const command = await prepare();
  const before = database.player().kc;
  const replies = await Promise.all(Array.from({ length: 10 }, () => send(command)));
  assert.equal(replies.filter(reply => reply.text === promoTexts.created).length, 1);
  assert.equal(database.player().kc, before - 5_000_000);
  assert.equal(database.state.promos.size, 1);
  restart();
  assert.equal((await send(command)).text, promoTexts.stale);
  await send({ kind: 'promo_create' });
  assert.equal((await send(command)).text, promoTexts.stale);
});

test('duplicate delivery returns the same response and does not advance the wizard or activate twice', async () => {
  const { prepare, send, text, database, restart } = await fixture();
  const command = await prepare();
  const first = await send(command, 1, { eventId: 'same-confirm' });
  restart();
  assert.deepEqual(await send(command, 1, { eventId: 'same-confirm' }), first);
  await send({ kind: 'promo_activate' }, 2);
  const receipt = await text('Подарок', 2, { eventId: 'same-activation' });
  assert.deepEqual(await text('Подарок', 2, { eventId: 'same-activation' }), receipt);
  assert.equal(database.state.promos.get('Подарок')?.remaining, 4);
});

test('the persistent wizard resumes at the same stage after a service restart', async () => {
  const { send, text, restart } = await fixture();
  await send({ kind: 'promo_create' });
  await send({ kind: 'promo_currency', currency: 'euro' });
  restart();
  assert.equal((await text('Долгоживущий')).text, promoAmountPrompt('euro'));
  restart();
  assert.equal((await text('5')).text, promoTexts.quantity);
  restart();
  const confirmation = await text('5');
  assert.equal(confirmation.keyboard.kind, 'promo_confirm');
  if (confirmation.keyboard.kind !== 'promo_confirm') {
    assert.fail('Missing confirmation');
  }
  restart();
  assert.equal((await send({ kind: 'promo_confirm', token: confirmation.keyboard.token })).text, promoTexts.created);
});

test('balance overflow does not consume an activation or a redemption receipt', async () => {
  const { send, prepare, activate, database } = await fixture();
  await send(await prepare());
  database.player(2).kc = game.maxAmount;
  assert.equal((await activate()).text, promoTexts.balanceLimit);
  assert.equal(database.state.promos.get('Подарок')?.remaining, 5);
  assert.equal(database.state.redemptions.size, 0);
});

test('an activation race for the last slot credits only one distinct player', async () => {
  const { send, text, prepare, database } = await fixture();
  await send(await prepare());
  const promo = database.state.promos.get('Подарок');
  assert.ok(promo);
  promo.remaining = 1;
  for (const id of [2, 3]) {
    await send({ kind: 'promo_activate' }, id);
  }
  const before = database.player(2).kc + database.player(3).kc;
  const replies = await Promise.all([text('Подарок', 2), text('Подарок', 3)]);
  assert.equal(replies.filter(reply => reply.text.includes('успешна')).length, 1);
  assert.equal(replies.filter(reply => reply.text === promoTexts.empty).length, 1);
  assert.equal(database.player(2).kc + database.player(3).kc, before + 1_000_000);
  assert.equal(database.state.promos.get('Подарок')?.remaining, 0);
});

test('a stolen confirmation token, invented economic payload and chat text cannot act on another player’s draft', async () => {
  const { send, prepare, database, text } = await fixture();
  const command = await prepare();
  assert.equal((await send(command, 2)).text, promoTexts.stale);
  const before = structuredClone(database.state.promos);
  const parsed = parseCommand('✅ Подтвердить', { command: 'promo_confirm', token: command.token, amount: 0, quantity: 999999, vkId: 2 });
  assert.deepEqual(parsed, command);
  assert.equal((await send(parsed, 1, { isChat: true })).text, promoTexts.private);
  await text('Городская речь', 1, { isChat: true });
  assert.equal(database.player().promoDraft?.step, 'confirm');
  assert.deepEqual(database.state.promos, before);
  assert.equal((await send(parsed)).text, promoTexts.created);
});

test('my promos lists only the owner’s codes with blank lines and bounded cursor pagination', async () => {
  const { prepare, send, database } = await fixture();
  await send(await prepare());
  await send(await prepare('Другой', 'kc', 2));
  const reply = await send({ kind: 'promo_list', after: null });
  assert.equal(reply.text, '🎁 Ваши промокоды:\n\nПодарок — 5 активаций, награды:\n💰 10.000 KC');
  assert.equal(reply.keyboard.kind, 'promo_list');
  for (let index = 0; index < 25; index += 1) {
    const name = `Промо${String(index).padStart(2, '0')}`;
    database.state.promos.set(name, { _id: name, ownerId: 1, currency: 'kc', amount: 1_000_000, quantity: 5, remaining: 5 });
  }
  let after: string | null = null;
  const pages: string[] = [];
  do {
    const page = await send({ kind: 'promo_list', after });
    assert.ok(page.text.length <= game.maxMessageLength);
    assert.ok(!page.text.includes('Другой'));
    pages.push(page.text);
    if (page.keyboard.kind !== 'promo_list') {
      assert.fail('Missing pagination');
    }
    after = page.keyboard.after;
  } while (after !== null);
  assert.equal(pages.length, 3);
  assert.equal(pages.join('\n').split('активаций, награды:').length - 1, 26);
});

test('promo keyboards use green activation and inline text confirmation, never callback events', () => {
  const specs: KeyboardSpec[] = [
    { kind: 'promo' }, { kind: 'promo_currency' }, { kind: 'promo_back' },
    { kind: 'promo_confirm', token: '1'.repeat(200) }, { kind: 'promo_list', after: '😀'.repeat(20) }
  ];
  for (const spec of specs) {
    const value: unknown = JSON.parse(buildKeyboard(spec).toString());
    assert.ok(isRecord(value));
    assert.equal(value.inline === true, spec.kind === 'promo_confirm');
    assert.ok(Array.isArray(value.buttons));
    assert.ok(value.buttons.length <= 10);
    for (const row of value.buttons) {
      assert.ok(Array.isArray(row));
      assert.ok(row.length <= 4);
      for (const button of row) {
        assert.ok(isRecord(button));
        assert.ok(isRecord(button.action));
        assert.equal(button.action.type, 'text');
        if (button.action.label === labels.activatePromo) {
          assert.equal(button.color, 'positive');
        }
        assert.equal(typeof button.action.payload, 'string');
        if (typeof button.action.payload === 'string') {
          assert.ok(Buffer.byteLength(button.action.payload) <= 255);
        }
      }
    }
  }
});

test('names that look like navigation commands are still accepted as draft input and can be redeemed', async () => {
  const { send, text, prepare, activate } = await fixture();
  const name = labels.promo;
  assert.ok(isPromoName(name));
  await send(await prepare(name));
  assert.match((await activate(name)).text, /успешна/);
  await send({ kind: 'promo_create' });
  assert.equal((await text(labels.back)).text, promoTexts.currency);
  assert.equal((await send({ kind: 'promo_back' })).text, promoTexts.menu);
});

test('malformed promo payloads never supply a reward, quantity or owner', () => {
  for (const payload of [
    { command: 'promo_confirm', token: '' },
    { command: 'promo_confirm', token: 'x'.repeat(201) },
    { command: 'promo_confirm', token: { $ne: null } },
    { command: 'promo_currency', currency: 'rubles' },
    { command: 'promo_list', after: { $gt: '' } },
    { command: 'promo_list', after: 'a' }
  ]) {
    assert.deepEqual(parseCommand(undefined, payload), { kind: 'development' });
  }
});

test('two owners racing for the same name fund only the published code', async () => {
  const { prepare, send, database } = await fixture();
  const first = await prepare('Одинаковый', 'kc', 1);
  const second = await prepare('Одинаковый', 'kc', 2);
  const before = database.player().kc + database.player(2).kc;
  const replies = await Promise.all([send(first, 1), send(second, 2)]);
  assert.equal(replies.filter(reply => reply.text === promoTexts.created).length, 1);
  assert.equal(replies.filter(reply => reply.text.startsWith(promoTexts.exists)).length, 1);
  assert.equal(database.player().kc + database.player(2).kc, before - 5_000_000);
  assert.equal(database.state.promos.size, 1);
});

test('an empty owner list has only Back and no other player’s promo', async () => {
  const { send } = await fixture();
  const reply = await send({ kind: 'promo_list', after: null });
  assert.equal(reply.text, '🎁 Ваши промокоды:\n\nУ Вас пока нет промокодов.');
  const keyboard: unknown = JSON.parse(buildKeyboard(reply.keyboard).toString());
  assert.ok(isRecord(keyboard));
  assert.ok(Array.isArray(keyboard.buttons));
  assert.equal(keyboard.buttons.length, 1);
});
