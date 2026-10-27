import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { initialFarm } from '../src/services/mining.js';
import { bonusText, labels, miningText } from '../src/services/texts.js';
import type { KeyboardSpec } from '../src/types/game.js';
import { isRecord } from '../src/utils/validation.js';

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

test('every button in every keyboard carries a valid bounded payload that round-trips through the parser', () => {
  const specs: KeyboardSpec[] = [
    { kind: 'none' }, { kind: 'main' }, { kind: 'profile' }, { kind: 'mining' }, { kind: 'mining_upgrade', level: 0 },
    { kind: 'ranking' }, { kind: 'referrals' }, { kind: 'inventory', itemIds: [1, 2], page: 1, hasNext: true },
    { kind: 'promo' }, { kind: 'promo_currency' }, { kind: 'promo_back' }, { kind: 'promo_list', after: 'Подарок' },
    { kind: 'promo_confirm', token: '1'.repeat(200) }, { kind: 'item_detail', itemKind: 'zhdun_case' },
    { kind: 'item_use', itemKind: 'referral_case' }, { kind: 'item_back', itemKind: 'referral_case' },
    { kind: 'item_offer', offerId: '1'.repeat(200) },
    { kind: 'item_confirmation', mode: 'gift', token: '1'.repeat(200) },
    { kind: 'item_confirmation', mode: 'sale', token: '1'.repeat(200) },
    { kind: 'item_confirmation', mode: 'open', token: '1'.repeat(200) }
  ];
  for (const spec of specs) {
    const keyboard: unknown = JSON.parse(buildKeyboard(spec).toString());
    assert.ok(isRecord(keyboard));
    assert.ok(isUnknownArray(keyboard.buttons));
    for (const row of keyboard.buttons) {
      assert.ok(isUnknownArray(row));
      for (const button of row) {
        assert.ok(isRecord(button));
        assert.ok(isRecord(button.action));
        assert.equal(button.action.type, 'text');
        const { label, payload } = button.action;
        assert.equal(typeof label, 'string');
        assert.equal(typeof payload, 'string');
        if (typeof label !== 'string' || typeof payload !== 'string') {
          assert.fail('Missing button label or payload');
        }
        assert.ok(Buffer.byteLength(payload) <= 255);
        const action: unknown = JSON.parse(payload);
        assert.ok(isRecord(action));
        assert.equal(parseCommand(label, payload).kind, action.command);
        assert.equal(parseCommand('подпись изменена', payload).kind, action.command);
        assert.deepEqual(parseCommand(label, undefined), { kind: 'development' });
      }
    }
  }
});

test('missing, malformed, unrelated and invalid payloads cannot turn bonus text into a claim', () => {
  for (const payload of [undefined, null, {}, [], 1, true, '{', 'x'.repeat(256), '{"command":"unknown"}',
    { command: ['bonus'] }, { command: { kind: 'bonus' } }, { vkId: 1, amount: 9999 }]) {
    assert.deepEqual(parseCommand(labels.bonus, payload), { kind: 'development' });
  }
  assert.deepEqual(parseCommand('любая подпись', '{"command":"bonus"}'), { kind: 'bonus' });
  for (const text of ['я', 'и', 'инв', 'инвентарь']) {
    assert.notEqual(parseCommand(text, undefined, true).kind, 'development');
    assert.equal(parseCommand(text, undefined).kind, 'development');
  }
});

test('bonus spacing has one blank line after the title and single newlines between rewards including the case', () => {
  const second = game.rewards[1];
  const seventh = game.rewards[6];
  assert.equal(bonusText(2, second), '🎁 Бонус 2-го дня:\n\n💰 5.000 KC\n💠 2,5₿');
  assert.equal(bonusText(7, seventh), '🎁 Бонус 7-го дня:\n\n💰 100.000 KC\n💠 25,0₿\n💼 Кейс «Ждун»');
});

test('mining spacing separates status from the compact production, balance and countdown block', () => {
  const now = new Date('2026-10-24T00:00:00Z');
  const farm = initialFarm();
  farm.rate = 25_400_000;
  farm.balance = 95_000_000;
  farm.activeUntil = new Date(now.getTime() + (5 * 3600 + 57 * 60 + 57) * 1000);
  assert.equal(miningText(farm, now),
    '📼 Ваша майнинг-ферма:\n💡 Статус: Включена\n\n⛏️ Добыча: 0,254₿/час\n💠 Баланс: 0,950₿\n⏳ Осталось 5 ч. 57 мин. 57 сек.');
  farm.activeUntil = now;
  assert.equal(miningText(farm, now),
    '📼 Ваша майнинг-ферма:\n💡 Статус: Выключена\n\n⛏️ Добыча: 0,254₿/час\n💠 Баланс: 0,950₿');
});
