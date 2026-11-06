import type { PlayerTarget } from './items.js';

export type ReputationCommand =
  | { kind: 'reputation'; direction: 1 | -1; target?: Exclude<PlayerTarget, { kind: 'screen' }> }
  | { kind: 'reputation_invalid' };

export interface ReputationCooldown {
  _id: string;
  senderId: number;
  targetId: number;
  nextAt: Date;
}

export interface ReputationStore {
  reputationCooldown(senderId: number, targetId: number): Promise<Date | null>;
  saveReputationCooldown(senderId: number, targetId: number, nextAt: Date): Promise<void>;
  changeReputation(vkId: number, delta: number): Promise<number | null>;
}
