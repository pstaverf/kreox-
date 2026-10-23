import { Keyboard, type KeyboardBuilder } from 'vk-io';
import { labels } from '../services/texts.js';
import type { KeyboardSpec } from '../types/game.js';
import { assertNever } from '../utils/validation.js';

export function buildKeyboard(spec: KeyboardSpec): KeyboardBuilder {
  const button = (label: string) => Keyboard.textButton({ label });
  switch (spec.kind) {
    case 'main':
      return Keyboard.keyboard([
        [button(labels.battlePass)],
        [button(labels.profile), button(labels.bonus), button(labels.rating)],
        [button(labels.promo), Keyboard.textButton({ label: labels.city, color: Keyboard.PRIMARY_COLOR }), button(labels.mining)],
        [Keyboard.textButton({ label: labels.donate, color: Keyboard.POSITIVE_COLOR }), button(labels.boss), button(labels.tasks)],
        [button(labels.help)]
      ]).oneTime(false);
    case 'profile':
      return Keyboard.keyboard([[button(labels.inventory), button(labels.menu)]]).oneTime(false);
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
