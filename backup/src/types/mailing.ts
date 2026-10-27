export type MailingCommand = { kind: 'mailing'; text: string } | { kind: 'mailing_invalid' };
export interface MailingRecipient { _id: number; joinedAt: Date }
export interface MailingCampaign {
  _id: string; text: string; createdAt: Date; afterVkId: number; version: number; state: 'pending' | 'queued';
}
export interface MailingStore {
  joinMailing(vkId: number, now?: Date): Promise<void>;
  createMailing(campaign: MailingCampaign): Promise<void>;
  pendingMailing(): Promise<MailingCampaign | null>;
  mailingRecipients(after: number, until: Date): Promise<number[]>;
  saveMailing(campaign: MailingCampaign): Promise<void>;
  enqueueMailing(id: string, vkId: number, text: string): Promise<void>;
}
