import { mailingConfig } from '../config/mailing.js';

export const mailingTexts = {
  usage: `⛔️ Использование: /mailing <текст>\nМаксимум ${mailingConfig.maxTextLength} символов.`,
  queued: '📨 Рассылка поставлена в очередь.'
} as const;
