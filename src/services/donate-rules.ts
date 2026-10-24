import { game } from '../config/game.js';
import { donateConfig } from '../config/donate.js';
import type { Command } from '../types/game.js';
import type { DonateCommand } from '../types/donate.js';

export function isDonateCommand(command: Command): command is DonateCommand {
  switch (command.kind) {
    case 'donate': case 'donate_nick': case 'donate_thief': case 'donate_dealer':
    case 'donate_confirm': case 'donate_cancel': case 'dealer_buy': case 'dealer_view': case 'theft': return true;
    default: return false;
  }
}
export function validNickname(name: string): boolean {
  if (name.length > 200 || /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069\u200b\ufeff\[\]|@*]/u.test(name)) {
    return false;
  }
  const length = [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(name)].length;
  return length >= donateConfig.nicknameMin && length <= donateConfig.nicknameMax;
}
export function cooldownParts(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)} мин. ${seconds % 60} сек.`;
}

export function validDonateMoney(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= game.maxAmount;
}
