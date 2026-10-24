import { donateConfig } from '../config/donate.js';
import { game } from '../config/game.js';
import type { DonateCommand, DonateDraft } from '../types/donate.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { GameStore } from '../types/storage.js';
import { assertNever } from '../utils/validation.js';
import { cooldownParts, validNickname } from './donate-rules.js';
import { dealerMention, dealerPrompt, donateTexts, nicknamePrompt, subscriptionText, thiefPrompt } from './donate-texts.js';
import { formatAmount, mention } from './texts.js';

const main = (text: string): Reply => ({ text, keyboard: { kind: 'main' } });
const back = (text: string): Reply => ({ text, keyboard: { kind: 'donate_back' } });
const confirm = (text: string, token: string, inline = false): Reply => ({ text, keyboard: { kind: 'donate_confirmation', token, inline } });
export type DonateRandom = (purpose: 'victim' | 'amount', maximum: number) => number;

export async function donateText(store: GameStore, player: Player, draft: DonateDraft, input: GameInput): Promise<Reply> {
  if (/^(отмена|отменить)$/i.test(input.text?.trim() ?? '')) {
    await store.setDonateDraft(player._id, null);
    return main(donateTexts.cancelled);
  }
  if (draft.step !== 'nickname') {
    return draft.step === 'confirm_nickname' ? confirm(`Вы уверены, что хотите сменить свой ник на: ${draft.nickname}?`, draft.token)
      : back(donateTexts.stale);
  }
  const nickname = input.text?.trim() ?? '';
  const length = [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(nickname)].length;
  if (length < donateConfig.nicknameMin || length > donateConfig.nicknameMax) return back(donateTexts.length);
  if (!validNickname(nickname)) return back(donateTexts.unsafe);
  await store.setDonateDraft(player._id, { step: 'confirm_nickname', nickname, token: input.eventId });
  return confirm(`Вы уверены, что хотите сменить свой ник на: ${nickname}?`, input.eventId);
}
async function buyDealer(store: GameStore, player: Player, now: Date, eventId: string): Promise<Reply> {
  const state = await store.dealer();
  const previous = state.holderId === null ? null : await store.player(state.holderId);
  const result = await store.buyDealer(player, previous, state, now);
  switch (result) {
    case 'self': return main(donateTexts.self);
    case 'cooldown': return main(`⚠️ Вы уже недавно становились крупье! Подождите еще ${cooldownParts(state.nextChangeAt.getTime() - now.getTime())}`);
    case 'funds': return main(donateTexts.funds);
    case 'limit': return main(donateTexts.limit);
    case 'ok':
      if (previous !== null) await store.enqueueItemNotification(`dealer:${eventId}`, previous._id,
        `${mention(player)} стал новым крупье. Вы успели заработать: ${formatAmount(state.earnedKC, game.kcScale)} KC`, { kind: 'none' });
      await store.setDonateDraft(player._id, null);
      return main(`${mention(player)}, вы успешно стали новым крупье.`);
    default: return assertNever(result);
  }
}
export async function donateAction(store: GameStore, player: Player, command: DonateCommand, input: GameInput, members: readonly number[] | undefined, random: DonateRandom): Promise<Reply | 'members'> {
  const now = await store.now();
  switch (command.kind) {
    case 'donate':
      await store.setDonateDraft(player._id, null);
      return { text: donateTexts.title, keyboard: { kind: 'donate' } };
    case 'donate_nick':
      await store.setDonateDraft(player._id, { step: 'nickname' });
      return back(nicknamePrompt(player));
    case 'donate_thief':
      if (player.thiefUntil !== undefined && player.thiefUntil > now) {
        await store.setDonateDraft(player._id, null);
        return back(subscriptionText(player.thiefUntil, false));
      }
      await store.setDonateDraft(player._id, { step: 'confirm_thief', token: input.eventId });
      return confirm(thiefPrompt(player), input.eventId);
    case 'donate_dealer': {
      const state = await store.dealer();
      const holder = state.holderId === null ? null : await store.player(state.holderId);
      await store.setDonateDraft(player._id, { step: 'confirm_dealer', token: input.eventId });
      return confirm(dealerPrompt(holder, state), input.eventId, true);
    }
    case 'donate_cancel':
    case 'donate_confirm': {
      const draft = player.donateDraft;
      if (draft === undefined || draft.step === 'nickname' || draft.token !== command.token) return main(donateTexts.stale);
      if (command.kind === 'donate_cancel') {
        await store.setDonateDraft(player._id, null);
        return main(donateTexts.cancelled);
      }
      switch (draft.step) {
        case 'confirm_nickname': {
          const result = await store.changeNickname(player, draft.nickname);
          return main(result === 'ok' ? `${mention({ _id: player._id, name: draft.nickname })}, отличный ник!` : result === 'funds' ? donateTexts.funds : donateTexts.limit);
        }
        case 'confirm_thief': {
          const result = await store.buyThief(player, now);
          if (result === 'active' && player.thiefUntil !== undefined) return main(subscriptionText(player.thiefUntil, false));
          return main(result === 'ok' ? subscriptionText(new Date(now.getTime() + donateConfig.subscriptionMs), true)
            : result === 'funds' ? donateTexts.funds : donateTexts.limit);
        }
        case 'confirm_dealer': return buyDealer(store, player, now, input.eventId);
        default: return assertNever(draft);
      }
    }
    case 'dealer_buy': return buyDealer(store, player, now, input.eventId);
    case 'dealer_view': {
      const state = await store.dealer();
      return { text: `🤑 Крупье: ${dealerMention(state.holderId === null ? null : await store.player(state.holderId))} (заработал: ${formatAmount(state.earnedKC, game.kcScale)} KC)`, keyboard: { kind: 'none' } };
    }
    case 'theft': {
      if (!input.isChat) throw new Error('Theft is chat-only');
      if (player.thiefUntil === undefined || player.thiefUntil <= now) return main(`${mention(player)}, купите подписку на эту команду в ЛС!`);
      if (player.nextTheftAt !== undefined && player.nextTheftAt > now) return main(`${mention(player)}, своровать можно будет через ${cooldownParts(player.nextTheftAt.getTime() - now.getTime())}`);
      if (members === undefined) return 'members';
      const count = await store.theftTargetCount(player._id, members);
      if (count === 0) return main(donateTexts.noVictim);
      const victim = await store.theftTarget(player._id, members, random('victim', count));
      if (victim === null || !Number.isSafeInteger(victim.kc) || victim.kc < 0 || victim.kc > game.maxAmount) throw new Error('Invalid theft target');
      const amount = random('amount', Math.floor(victim.kc / game.kcScale) + 1) * game.kcScale;
      if (!await store.steal(player, victim, amount, now)) return main(donateTexts.limit);
      await store.enqueueItemNotification(`theft:${input.eventId}`, victim._id, `${mention(player)} украл у тебя ${formatAmount(amount, game.kcScale)} KC`, { kind: 'none' });
      return main(`${mention(player)} украл у игрока ${mention(victim)} ${formatAmount(amount, game.kcScale)} KC.`);
    }
    default: return assertNever(command);
  }
}
