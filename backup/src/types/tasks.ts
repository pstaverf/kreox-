export type DailyTaskKind =
  | 'roulette_win' | 'crash_win' | 'dream_win' | 'double_win'
  | 'deposit' | 'bonus' | 'director_bid' | 'item_gift' | 'item_sale' | 'gift_kc'
  | 'case_open' | 'farm_start';

export interface DailyTask {
  kind: DailyTaskKind;
  goal: number;
  progress: number;
  seenRounds?: string[];
}

export interface DailyTasks {
  _id: string;
  vkId: number;
  day: string;
  version: number;
  tasks: DailyTask[];
  completed: boolean;
  rewarded: boolean;
}

export interface DailyTaskStore {
  dailyTasks(vkId: number, day: string): Promise<DailyTasks | null>;
  createDailyTasks(tasks: DailyTasks): Promise<void>;
  saveDailyTasks(tasks: DailyTasks, completedDelta: number): Promise<void>;
  pendingDailyTasks(vkId: number): Promise<DailyTasks[]>;
  awardDailyTasks(tasks: DailyTasks): Promise<boolean>;
}
