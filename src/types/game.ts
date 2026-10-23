export interface Player {
  _id: number;
  accountId: number;
  name: string;
  kc: number;
  euro: number;
  bitcoin: number;
  reputation: number;
  completedTasks: number;
  bonusDay: number;
  lastBonusAt: Date | null;
  nextBonusAt: Date;
  nextItemId: number;
}

export interface InventoryItem {
  _id: string;
  vkId: number;
  itemId: number;
  kind: 'zhdun_case';
}

export type Command =
  | { kind: 'profile' }
  | { kind: 'menu' }
  | { kind: 'bonus' }
  | { kind: 'inventory'; page: number }
  | { kind: 'item'; itemId: number }
  | { kind: 'development' };

export type KeyboardSpec =
  | { kind: 'main' }
  | { kind: 'profile' }
  | { kind: 'inventory'; itemIds: number[]; page: number; hasNext: boolean };

export interface Reply {
  text: string;
  keyboard: KeyboardSpec;
}

export interface PreparedReply extends Reply {
  randomId: number;
}

export interface ProcessedMessage {
  _id: string;
  vkId: number;
  reply: PreparedReply;
}

export interface Counter {
  _id: 'registrations' | 'responses';
  value: number;
}

export interface GameInput {
  eventId: string;
  vkId: number;
  command: Command;
}

export type Reward = {
  kc: number;
  bitcoin: number;
  case: boolean;
};
