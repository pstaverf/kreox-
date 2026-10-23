import { Keyboard, type KeyboardBuilder } from 'vk-io';
import { labels } from '../services/texts.js';
import type { KeyboardSpec } from '../types/game.js';
import { assertNever } from '../utils/validation.js';

export function buildKeyboard(spec: KeyboardSpec): KeyboardBuilder {
  const button = (label: string) => Keyboard.textButton({ label });
  switch (spec.kind) {
    case 'none':
      return Keyboard.keyboard([]);
    case 'promo':
      return Keyboard.keyboard([
        [Keyboard.textButton({ label: labels.createPromo, payload: { command: 'promo_create' } })],
        [Keyboard.textButton({ label: labels.activatePromo, color: Keyboard.POSITIVE_COLOR, payload: { command: 'promo_activate' } })],
        [Keyboard.textButton({ label: labels.myPromos, payload: { command: 'promo_list', after: null } })]
      ]).oneTime(false);
    case 'promo_currency':
      return Keyboard.keyboard([
        [
          Keyboard.textButton({ label: 'KC', payload: { command: 'promo_currency', currency: 'kc' } }),
          Keyboard.textButton({ label: '💶', payload: { command: 'promo_currency', currency: 'euro' } }),
          Keyboard.textButton({ label: '💠', payload: { command: 'promo_currency', currency: 'bitcoin' } })
        ],
        [Keyboard.textButton({ label: labels.back, payload: { command: 'promo_back' } })]
      ]).oneTime(false);
    case 'promo_back':
      return Keyboard.keyboard([[Keyboard.textButton({ label: labels.back, payload: { command: 'promo_back' } })]]).oneTime(false);
    case 'promo_confirm':
      return Keyboard.keyboard([[Keyboard.textButton({
        label: labels.confirmPromo, payload: { command: 'promo_confirm', token: spec.token }
      })]]).inline();
    case 'promo_list':
      return Keyboard.keyboard([
        ...(spec.after === null ? [] : [[Keyboard.textButton({ label: labels.next, payload: { command: 'promo_list', after: spec.after } })]]),
        [Keyboard.textButton({ label: labels.back, payload: { command: 'promo_back' } })]
      ]).oneTime(false);
    case 'main':
      return Keyboard.keyboard([
        [button(labels.battlePass)],
        [button(labels.profile), button(labels.bonus), button(labels.rating)],
        [button(labels.promo), Keyboard.textButton({ label: labels.city, color: Keyboard.PRIMARY_COLOR }), button(labels.mining)],
        [Keyboard.textButton({ label: labels.donate, color: Keyboard.POSITIVE_COLOR }), button(labels.boss), button(labels.tasks)],
        [button(labels.help)]
      ]).oneTime(false);
    case 'profile':
      return Keyboard.keyboard([[button(labels.referral), button(labels.inventory)], [button(labels.menu)]]).oneTime(false);
    case 'mining':
      return Keyboard.keyboard([
        [button(labels.startMining), button(labels.withdrawMining)],
        [button(labels.upgradeMining), Keyboard.textButton({ label: labels.back, payload: { command: 'menu' } })]
      ]).oneTime(false);
    case 'mining_upgrade':
      return Keyboard.keyboard([
        [Keyboard.textButton({ label: labels.confirm, payload: { command: 'mining_confirm', level: spec.level } })],
        [Keyboard.textButton({ label: labels.upgradeBack, payload: { command: 'mining' } })]
      ]).oneTime(false);
    case 'ranking':
      return Keyboard.keyboard([
        [button(labels.kc), button(labels.bitcoin), Keyboard.textButton({ label: labels.mining, payload: { command: 'ranking', metric: 'mining' } })],
        [button(labels.euro), button(labels.referrals), button(labels.reputation)],
        [button(labels.thieves)],
        [Keyboard.textButton({ label: labels.back, payload: { command: 'menu' } })]
      ]).oneTime(false);
    case 'referrals':
      return Keyboard.keyboard([[Keyboard.textButton({ label: labels.back, payload: { command: 'profile' } })]]).oneTime(false);
    case 'inventory': {
      const rows = spec.itemIds.map(id => [button(`🆔 ${id}`)]);
      const navigation = [];
      if (spec.page > 0) {
        navigation.push(Keyboard.textButton({ label: labels.previous, payload: { command: 'inventory', page: spec.page - 1 } }));
      }
      if (spec.hasNext) {
        navigation.push(Keyboard.textButton({ label: labels.next, payload: { command: 'inventory', page: spec.page + 1 } }));
      }
      if (navigation.length > 0) {
        rows.push(navigation);
      }
      rows.push([button(labels.back)]);
      return Keyboard.keyboard(rows).oneTime(false);
    }
    default:
      return assertNever(spec);
  }
}
