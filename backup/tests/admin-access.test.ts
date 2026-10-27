import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminIds } from '../src/config/admin.js';
import { diceConfig } from '../src/config/dice.js';
import { parseCommand } from '../src/handlers/commands.js';
import { GameService } from '../src/services/game.js';
import { giveawayKey } from '../src/services/giveaway-rules.js';
import { MemoryDatabase } from './memory.js';

test('both configured administrators can manage balances, items, giveaways and mailing without changing dice commission recipient', async () => {
  assert.deepEqual([...adminIds], [888801846, 312631501]);
  assert.equal(diceConfig.commissionId, 888801846);
  for (const vkId of adminIds) {
    const db = new MemoryDatabase();
    const service = new GameService(db);
    await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
    let sequence = 0;
    const send = (text: string) => service.handle({ eventId: `admin:${sequence++}`, vkId, peerId: 2_000_000_001, isChat: true,
      command: parseCommand(text, undefined, true) }, async () => { throw new Error('Admin commands must not register the admin'); });
    for (const text of ['!set @id1 10', '!add @id1 1', '!setdonut 1 10', '!adddonut 1 1', '!takedonut 1 1',
      '!setbit 1 10', '!addbit 1 1', '!takebit 1 1', '!giveitem 1 1 2', '!takeitem 1 1']) {
      assert.equal((await send(text)).text, 'Done.');
    }
    assert.equal(db.player().kc, 1100);
    assert.equal(db.player().euro, 1000);
    assert.equal(db.player().bitcoin, 1_000_000_000);
    assert.equal(db.state.items.length, 1);
    assert.ok((await send('!itemlist')).text.length > 0);
    const started = await send('/force Раздача монеты 2 100');
    assert.equal(started.keyboard.kind, 'giveaway');
    const state = db.state.casino.get(giveawayKey(2_000_000_001));
    assert.ok(state?.kind === 'giveaway');
    const cancelled = await service.handle({ eventId: 'cancel', vkId, peerId: state.peerId, isChat: true,
      command: { kind: 'giveaway_cancel', peerId: state.peerId, token: state.token } }, async () => 'Игрок');
    assert.match(cancelled.text, /Раздача отменена/u);
    assert.equal((await send('/mailing Новости')).text, '📨 Рассылка поставлена в очередь.');
    assert.equal(db.state.players.has(vkId), false);
    await assert.rejects(service.handle({ eventId: 'not-admin', vkId: 1, command: parseCommand('!add @id1 10', undefined) }, async () => 'Игрок'), /Administrator access/);
  }
});
