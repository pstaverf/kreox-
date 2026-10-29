import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEnvironment } from '../src/config/env.js';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { availableAccountIds, bonusDay, normalizeName, rewardForDay } from '../src/services/rules.js';
import { cooldownText, formatAmount, labels } from '../src/services/texts.js';
import type { KeyboardSpec } from '../src/types/game.js';
import { isRecord } from '../src/utils/validation.js';

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

test('button commands require validated payloads rather than matching labels', () => {
  for (const label of [...Object.values(labels), 'KC', '💶', '💠', '🆔 1']) {
    assert.deepEqual(parseCommand(label, undefined), { kind: 'development' });
    assert.deepEqual(parseCommand(label, {}), { kind: 'development' });
  }
  assert.deepEqual(parseCommand(labels.profile, { command: 'profile' }), { kind: 'profile' });
  assert.deepEqual(parseCommand(labels.promo, { command: 'promo' }), { kind: 'promo' });
  assert.deepEqual(parseCommand(labels.city, { command: 'city' }), { kind: 'city' });
  assert.deepEqual(parseCommand(labels.menu, { command: 'menu' }), { kind: 'menu' });
  assert.deepEqual(parseCommand(labels.inventory, { command: 'inventory', page: 0 }), { kind: 'inventory', page: 0 });
  assert.deepEqual(parseCommand(labels.bonus, { command: 'bonus', vkId: 999, amount: -1 }), { kind: 'bonus' });
  assert.deepEqual(parseCommand('🆔 1', { command: 'item', itemId: 1 }), { kind: 'item', itemId: 1 });
  assert.deepEqual(parseCommand('▶️', { command: 'inventory', page: 1, vkId: 999 }), { kind: 'inventory', page: 1 });
  assert.deepEqual(parseCommand('▶️', '{"command":"inventory","page":2}'), { kind: 'inventory', page: 2 });
});

test('invalid input cannot become an economic operation', () => {
  for (const input of ['', '🆔 -1', '🆔 0', '🆔 1.5', '🆔 9007199254740992', 'NaN', '@all', 'бонус -2500']) {
    assert.deepEqual(parseCommand(input, undefined), { kind: 'development' });
  }
  for (const page of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, '1', null]) {
    assert.deepEqual(parseCommand('▶️', { command: 'inventory', page }), { kind: 'development' });
  }
  for (const payload of ['{', 'x'.repeat(256), null, [], 1]) {
    assert.deepEqual(parseCommand(undefined, payload), { kind: 'development' });
  }
});

test('integer formatting is exact even at the safe integer boundary', () => {
  assert.equal(formatAmount(0, game.bitcoinScale), '0');
  assert.equal(formatAmount(250_000, game.kcScale), '2.500');
  assert.equal(formatAmount(1_500_000_000, game.bitcoinScale, 1), '15,0');
  assert.equal(formatAmount(1, game.bitcoinScale), '0,00000001');
  assert.equal(formatAmount(Number.MAX_SAFE_INTEGER, game.bitcoinScale), '90.071.992,54740991');
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatAmount(amount, game.kcScale));
  }
  assert.equal(cooldownText(1), '⏳ Подожди ещё 0 ч. 0 мин. 1 сек.');
});

test('reward configuration matches all seven rewards and validates day numbers', () => {
  assert.deepEqual(game.rewards.map(reward => reward.kc / game.kcScale), [2500, 5000, 10000, 15000, 25000, 50000, 100000]);
  assert.deepEqual(game.rewards.map(reward => reward.bitcoin / game.bitcoinScale), [1.5, 2.5, 2.5, 5, 7.5, 10, 25]);
  for (const day of [0, -1, 1.5, 8, NaN, Infinity]) {
    assert.throws(() => rewardForDay(day));
  }
  assert.equal(bonusDay({ lastBonusAt: new Date('2026-10-22T23:59:59Z'), bonusDay: 3 }, new Date('2026-10-23T04:00:00Z')), 4);
  assert.equal(normalizeName('@all [id5|Имя]\n'), 'all id5Имя');
  assert.equal(normalizeName(' \n '), 'Игрок');
});

test('random ID pool excludes occupied IDs and does not reuse 50', () => {
  const pool = availableAccountIds([0, 49, 51, 9999]);
  assert.equal(pool[0], 52);
  assert.equal(pool.at(-1), 9998);
  assert.equal(pool.includes(50), false);
  assert.equal(pool.includes(51), false);
  assert.equal(pool.length, 9947);
  assert.deepEqual(availableAccountIds(Array.from({ length: 9949 }, (_, index) => index + 51)), []);
});

test('all keyboards fit VK limits; city is blue and donate is green', () => {
  const specs: KeyboardSpec[] = [
    { kind: 'main' }, { kind: 'profile' }, { kind: 'mining' }, { kind: 'mining_upgrade', level: 0 },
    { kind: 'ranking' }, { kind: 'referrals' },
    { kind: 'inventory', itemIds: [], page: 0, hasNext: false },
    { kind: 'inventory', itemIds: [1, 2, 3, 4, 5, 6, 7, 8], page: 1, hasNext: true }
  ];
  for (const spec of specs) {
    const value: unknown = JSON.parse(buildKeyboard(spec).toString());
    assert.ok(isRecord(value));
    assert.equal(value.one_time, false);
    assert.ok(isUnknownArray(value.buttons));
    assert.ok(value.buttons.length <= 10);
    for (const row of value.buttons) {
      assert.ok(isUnknownArray(row));
      assert.ok(row.length <= 4);
      for (const button of row) {
        assert.ok(isRecord(button));
        assert.ok(isRecord(button.action));
        assert.equal(button.action.type, 'text');
        assert.equal(typeof button.action.label, 'string');
        if (typeof button.action.label !== 'string') {
          assert.fail('Invalid label');
        }
        assert.ok(button.action.label.length <= 40);
        if (button.action.label === labels.city) {
          assert.equal(button.color, 'primary');
        }
        if (button.action.label === labels.donate) {
          assert.equal(button.color, 'positive');
        }
        if (typeof button.action.payload === 'string') {
          assert.ok(Buffer.byteLength(button.action.payload) <= 255);
        }
      }
    }
  }
});

test('environment validation fails closed without exposing secret values', () => {
  const env = { VK_TOKEN: 'vk1.a.secret', VK_GROUP_ID: '123', MONGODB_URI: 'mongodb+srv://user:password@cluster.example', MONGODB_DB: 'kreox' };
  assert.equal(readEnvironment(env).vkGroupId, 123);
  for (const invalid of [
    { VK_TOKEN: '' }, { VK_GROUP_ID: '-1' }, { VK_GROUP_ID: '1.5' }, { VK_GROUP_ID: 'Infinity' },
    { MONGODB_URI: 'https://secret' }, { MONGODB_DB: 'invalid/database' }
  ]) {
    assert.throws(() => readEnvironment({ ...env, ...invalid }), error => error instanceof Error && !error.message.includes('password'));
  }
});


test('KC formatting distinguishes grouped thousands from exact fractional minor units without rounding', () => {
  assert.equal(formatAmount(180_394_712, game.kcScale), '1.803.947,12');
  assert.equal(formatAmount(180_394_700, game.kcScale), '1.803.947');
  assert.equal(formatAmount(180_394_710, game.kcScale), '1.803.947,1');
  for (const amount of [0, 1, 9, 10, 11, 99, 100, 101, 99999, 100001, 180_394_712, Number.MAX_SAFE_INTEGER]) {
    const formatted = formatAmount(amount, game.kcScale);
    assert.match(formatted, /^(?:0|[1-9]\d{0,2}(?:\.\d{3})*)(?:,\d{1,2})?$/u);
    const [whole = '', fraction = ''] = formatted.replaceAll('.', '').split(',');
    assert.equal(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')), BigInt(amount));
  }
});
