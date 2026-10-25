import { DuplicateWriteError } from '../types/storage.js';
import { casinoConfig } from '../config/casino.js';
import { game } from '../config/game.js';
import type { CasinoRandom, CasinoRound } from '../types/casino.js';
import type { GameDatabase, GameStore } from '../types/storage.js';
import { addCasinoCredit, payCasinoCredit } from './casino-credits.js';
import { cachedCasinoRandom, casinoRandom, betPayout, casinoPercent, closeKey } from './casino-rules.js';
import { casinoTexts, electionRefund, roundClosed, roundFooter, roundHeading, winningBet } from './casino-texts.js';
import { startDueElection } from './director.js';

async function savePage(store: GameStore, round: CasinoRound): Promise<void> {
  if (round.buffer.length === 0) return;
  if (round.buffer.length > game.maxMessageLength) throw new Error('Casino page overflow');
  await store.casinoInsert({ _id: `page:${round.roundId}:${round.pages}`, kind: 'page', version: 0, roundId: round.roundId, index: round.pages, text: round.buffer });
  round.pages += 1;
  round.buffer = '';
}
async function appendResult(store: GameStore, round: CasinoRound, text: string): Promise<void> {
  if (round.buffer.length + text.length > game.maxMessageLength) await savePage(store, round);
  round.buffer += text;
}
async function progressRound(store: GameStore, now: Date): Promise<boolean> {
  const round = (await store.casinoList({ kind: 'round', dueAt: now }, 1))[0];
  if (round === undefined) return false;
  if (round.kind !== 'round') throw new Error('Invalid due casino round');
  switch (round.stage) {
    case 'open':
      if (round.closesAt > now) throw new Error('Premature casino close');
      await store.enqueueItemNotification(closeKey(round), round.peerId, roundClosed(round.mode), { kind: 'none' });
      round.stage = 'closed';
      round.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
      break;
    case 'closed':
      if (await store.casinoNotificationDone(closeKey(round))) {
        round.stage = 'waiting';
        round.dueAt = new Date(now.getTime() + casinoConfig.resultsMs);
      } else round.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
      break;
    case 'waiting':
      round.dealerId = (await store.dealer()).holderId;
      round.buffer = roundHeading(round);
      round.stage = 'settling';
      round.dueAt = now;
      break;
    case 'settling': {
      const bet = (await store.casinoList({ kind: 'bet', roundId: round.roundId, settled: false }, 1))[0];
      if (bet === undefined) {
        await appendResult(store, round, roundFooter(round));
        await savePage(store, round);
        round.history = [...round.history, { result: round.result, bonus: round.bonus }].slice(-casinoConfig.historySize);
        round.stage = 'announcing';
      } else {
        if (bet.kind !== 'bet') throw new Error('Invalid round bet');
        const wins = round.mode === 'crash' ? round.result >= bet.target : round.result === bet.target;
        if (wins) {
          const payout = betPayout(round.mode, bet.amount, bet.target, round.bonus);
          if (payout === null) throw new Error('Casino payout exceeded reserved bound');
          await addCasinoCredit(store, bet._id, bet.vkId, payout);
          round.winners += 1;
          await appendResult(store, round, `\n\n${winningBet(bet, round.mode, payout)}`);
        } else {
          round.losses += bet.amount;
          if (round.dealerId !== null) await addCasinoCredit(store, `dealer:${bet._id}`, round.dealerId, casinoPercent(bet.amount, casinoConfig.dealerPercent), 'dealer');
        }
        bet.settled = true;
        await store.casinoSave(bet);
      }
      round.dueAt = now;
      break;
    }
    case 'announcing': {
      const previous = round.nextPage === 0 ? closeKey(round) : `result:${round.roundId}:${round.nextPage - 1}`;
      if (await store.casinoNotificationDone(previous)) {
        if (round.nextPage >= round.pages) round.stage = 'finished';
        else {
          const page = await store.casinoGet(`page:${round.roundId}:${round.nextPage}`);
          if (page?.kind !== 'page') throw new Error('Missing result page');
          await store.enqueueItemNotification(`result:${round.roundId}:${round.nextPage}`, round.peerId, page.text, { kind: 'none' });
          round.nextPage += 1;
        }
      }
      round.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
      break;
    }
    case 'finished': throw new Error('Finished round selected');
  }
  await store.casinoSave(round);
  return true;
}
async function progressElection(store: GameStore, now: Date): Promise<boolean> {
  const election = (await store.casinoList({ kind: 'election', dueAt: now }, 1))[0];
  if (election === undefined) return false;
  if (election.kind !== 'election') throw new Error('Invalid due election');
  if (election.stage === 'refunds') {
    const bid = (await store.casinoList({ kind: 'bid', electionId: election.electionId, settled: false }, 1))[0];
    if (bid === undefined) election.stage = 'broadcast';
    else {
      if (bid.kind !== 'bid') throw new Error('Invalid refund bid');
      if (bid.vkId === election.winnerId) await store.enqueueItemNotification(`election-winner:${election.electionId}`, bid.vkId, casinoTexts.winner, { kind: 'none' });
      else await addCasinoCredit(store, `election:${bid._id}`, bid.vkId, casinoPercent(bid.amount, casinoConfig.electionRefundPercent), 'wallet', electionRefund(casinoPercent(bid.amount, casinoConfig.electionRefundPercent)));
      bid.settled = true;
      await store.casinoSave(bid);
    }
  } else if (election.stage === 'broadcast') {
    const chats = await store.casinoList({ kind: 'chat', after: election.afterChat }, casinoConfig.announcementBatch);
    for (const chat of chats) {
      if (chat.kind !== 'chat') throw new Error('Invalid registered chat');
      await store.enqueueItemNotification(`election:${election.electionId}:${chat.peerId}`, chat.peerId, election.announcement, { kind: 'none' });
      election.afterChat = chat._id;
    }
    if (chats.length === 0) election.stage = 'finished';
  } else throw new Error('Finished election selected');
  await store.casinoSave(election);
  return true;
}
async function progressDelivery(store: GameStore, now: Date): Promise<boolean> {
  const job = (await store.casinoList({ kind: 'delivery', dueAt: now }, 1))[0];
  if (job === undefined) return false;
  if (job.kind !== 'delivery') throw new Error('Invalid casino delivery');
  if (job.index === 0 || await store.casinoNotificationDone(`${job._id}:${job.index - 1}`)) {
    const text = job.texts[job.index];
    if (text === undefined) job.stage = 'finished';
    else {
      await store.enqueueItemNotification(`${job._id}:${job.index}`, job.peerId, text, { kind: 'none' });
      job.index += 1;
    }
  }
  job.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
  await store.casinoSave(job);
  return true;
}
export async function settleCasino(database: GameDatabase, random: CasinoRandom = casinoRandom): Promise<number> {
  let work = 0;
  const stableRandom = cachedCasinoRandom(random);
  for (let index = 0; index < casinoConfig.workerBatch; index += 1) {
    let progressed: boolean;
    try {
      progressed = await database.transaction(async store => {
        const now = await store.now();
        if (await startDueElection(store, now, stableRandom)) return true;
        const tasks = index % 3 === 0 ? [progressRound, payCasinoCredit, progressElection, progressDelivery]
          : index % 3 === 1 ? [payCasinoCredit, progressElection, progressDelivery, progressRound]
            : [progressElection, progressDelivery, progressRound, payCasinoCredit];
        for (const task of tasks) if (await task(store, now)) return true;
        return false;
      });
    } catch (error: unknown) {
      if (error instanceof DuplicateWriteError) continue;
      throw error;
    }
    if (!progressed) break;
    work += 1;
  }
  return work;
}
