import { randomInt } from 'node:crypto';
import { casinoConfig } from '../config/casino.js';
import { game } from '../config/game.js';
import { taskConfig } from '../config/tasks.js';
import type { Player, Reply } from '../types/game.js';
import type { DailyTask, DailyTaskKind, DailyTasks } from '../types/tasks.js';
import type { GameStore } from '../types/storage.js';
import { formatKc } from './texts.js';

const winGoals = [10, 12, 15, 20] as const;
const templates: readonly { kind: DailyTaskKind; label: string; goals: readonly number[] }[] = [
  { kind: 'roulette_win', label: 'Выиграть в рулетке', goals: winGoals },
  { kind: 'crash_win', label: 'Выиграть в краше', goals: winGoals },
  { kind: 'dream_win', label: 'Выиграть в дрим', goals: winGoals },
  { kind: 'double_win', label: 'Выиграть в дабл', goals: winGoals },
  { kind: 'deposit', label: 'Открыть депозит', goals: [1] },
  { kind: 'bonus', label: 'Собрать бонус', goals: [4] },
  { kind: 'director_bid', label: 'Сделать ставку в выборах директора', goals: [1] },
  { kind: 'item_gift', label: 'Подарить игроку предмет', goals: [1] },
  { kind: 'item_sale', label: 'Продать предмет', goals: [1] },
  { kind: 'gift_kc', label: 'Подарить игроку KC', goals: [1_000 * game.kcScale] },
  { kind: 'case_open', label: 'Открыть кейс', goals: [1] },
  { kind: 'farm_start', label: 'Запустить майнинг-ферму', goals: [1] }
];

export function moscowTaskDay(time: Date): string {
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid task time');
  return new Date(time.getTime() + casinoConfig.moscowOffsetMs).toISOString().slice(0, 10);
}

export function newDailyTasks(vkId: number, day: string, random: (maximum: number) => number = randomInt): DailyTasks {
  if (!Number.isSafeInteger(vkId) || vkId <= 0 || !/^\d{4}-\d{2}-\d{2}$/u.test(day)) throw new Error('Invalid daily task owner or day');
  const available = [...templates];
  const tasks: DailyTask[] = [];
  for (let index = 0; index < taskConfig.count; index += 1) {
    const choice = random(available.length);
    if (!Number.isSafeInteger(choice) || choice < 0 || choice >= available.length) throw new Error('Invalid daily task choice');
    const [template] = available.splice(choice, 1);
    if (template === undefined) throw new Error('Missing daily task template');
    const goalIndex = template.goals.length === 1 ? 0 : random(template.goals.length);
    const goal = template.goals[goalIndex];
    if (goal === undefined) throw new Error('Invalid daily task goal');
    tasks.push({ kind: template.kind, goal, progress: 0 });
  }
  return { _id: `${vkId}:${day}`, vkId, day, version: 0, tasks, completed: false, rewarded: false };
}

async function ensureDailyTasks(store: GameStore, vkId: number, now: Date): Promise<DailyTasks> {
  const day = moscowTaskDay(now);
  const current = await store.dailyTasks(vkId, day);
  if (current !== null) return current;
  const created = newDailyTasks(vkId, day);
  await store.createDailyTasks(created);
  return created;
}

export async function progressDailyTask(store: GameStore, vkId: number, kind: DailyTaskKind, now: Date, amount = 1, roundId?: string): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid daily task progress');
  const daily = await ensureDailyTasks(store, vkId, now);
  const task = daily.tasks.find(value => value.kind === kind);
  if (task === undefined || task.progress >= task.goal) return;
  if (roundId !== undefined) {
    if (roundId.length === 0 || roundId.length > 250) throw new Error('Invalid winning round');
    if (task.seenRounds?.includes(roundId)) return;
    task.seenRounds = [...(task.seenRounds ?? []), roundId];
  }
  task.progress += Math.min(task.goal - task.progress, amount);
  const completedDelta = task.progress === task.goal ? 1 : 0;
  daily.completed = daily.tasks.every(value => value.progress >= value.goal);
  await store.saveDailyTasks(daily, completedDelta);
  if (daily.completed && !daily.rewarded) await store.awardDailyTasks(daily);
}

function taskLine(task: DailyTask, index: number): string {
  const template = templates.find(value => value.kind === task.kind);
  if (template === undefined) throw new Error('Unknown daily task');
  const progress = task.kind === 'gift_kc' ? `${formatKc(task.progress)}/${formatKc(task.goal)} KC` : `${task.progress}/${task.goal}`;
  return `${index + 1}. ${template.label} — ${progress}${task.progress >= task.goal ? ' ✅' : ''}`;
}

export async function dailyTasksAction(store: GameStore, player: Player): Promise<Reply> {
  let pending = false;
  for (const previous of await store.pendingDailyTasks(player._id)) {
    if (!await store.awardDailyTasks(previous)) { pending = true; break; }
  }
  const daily = await ensureDailyTasks(store, player._id, await store.now());
  if (daily.completed && !daily.rewarded && !await store.awardDailyTasks(daily)) pending = true;
  const rewards = '💰 100.000 KC\n\n💠 100₿';
  const text = daily.completed && daily.rewarded
    ? `✅ Вы успешно выполнили все задания!\n\n💰 Награды:\n\n${rewards}\n\n💫 +1 уровень`
    : `📍 Ваши задания на сегодня:\n\n${daily.tasks.map(taskLine).join('\n')}\n\n💰 Награда за выполнение:\n\n${rewards}`;
  return { text: `${text}${pending ? '\n\n⚠️ Награда ожидает начисления: достигнут предел баланса.' : ''}`, keyboard: { kind: 'tasks' } };
}
