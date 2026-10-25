import { mailingConfig } from '../config/mailing.js';
import type { MailingCommand } from '../types/mailing.js';

export function parseMailing(text: string | undefined): MailingCommand | null {
  if (text === undefined || !/^\/mailing(?=\s|$)/iu.test(text.trimStart())) return null;
  const body = text.trimStart().slice('/mailing'.length).trim();
  return body.length === 0 || body.length > mailingConfig.maxTextLength ? { kind: 'mailing_invalid' } : { kind: 'mailing', text: body };
}
