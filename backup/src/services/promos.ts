import { game } from '../config/game.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { PromoCommand, PromoDraft } from '../types/promo.js';
import type { GameStore } from '../types/storage.js';
import { assertNever } from '../utils/validation.js';
import { isPromoName, parsePromoInteger, promoScale, promoTotal, validPromoReward } from './promo-rules.js';
import { promoActivatedText, promoAmountPrompt, promoListText, promoTexts } from './promo-texts.js';

function back(text: string): Reply {
  return { text, keyboard: { kind: 'promo_back' } };
}

export async function promoAction(store: GameStore, player: Player, command: PromoCommand): Promise<Reply> {
  switch (command.kind) {
    case 'promo':
    case 'promo_back':
      await store.setPromoDraft(player._id, null);
      return { text: promoTexts.menu, keyboard: { kind: 'promo' } };
    case 'promo_create':
      await store.setPromoDraft(player._id, { step: 'currency' });
      return { text: promoTexts.currency, keyboard: { kind: 'promo_currency' } };
    case 'promo_currency':
      if (player.promoDraft?.step !== 'currency') {
        return back(promoTexts.stale);
      }
      await store.setPromoDraft(player._id, { step: 'name', currency: command.currency });
      return back(promoTexts.name);
    case 'promo_activate':
      await store.setPromoDraft(player._id, { step: 'activate' });
      return back(promoTexts.activate);
    case 'promo_list': {
      if (command.after !== null && !isPromoName(command.after)) {
        return back(promoTexts.stale);
      }
      await store.setPromoDraft(player._id, null);
      const promos = await store.promos(player._id, command.after);
      const visible = promos.slice(0, game.promo.pageSize);
      const last = visible.at(-1);
      return {
        text: promoListText(visible),
        keyboard: { kind: 'promo_list', after: promos.length > game.promo.pageSize && last !== undefined ? last._id : null }
      };
    }
    case 'promo_confirm': {
      const draft = player.promoDraft;
      if (draft?.step !== 'confirm' || draft.token !== command.token || !isPromoName(draft.name)
        || !validPromoReward(draft.currency, draft.amount) || promoTotal(draft.amount, draft.quantity) === null) {
        return back(promoTexts.stale);
      }
      const result = await store.createPromo(player, {
        _id: draft.name, ownerId: player._id, currency: draft.currency,
        amount: draft.amount, quantity: draft.quantity, remaining: draft.quantity
      });
      if (result === 'funds') {
        return { text: promoTexts.funds, keyboard: { kind: 'promo_confirm', token: draft.token } };
      }
      if (result === 'exists') {
        await store.setPromoDraft(player._id, { step: 'name', currency: draft.currency });
        return back(`${promoTexts.exists}\n\n${promoTexts.name}`);
      }
      await store.setPromoDraft(player._id, null);
      return { text: promoTexts.created, keyboard: { kind: 'promo' } };
    }
    default: return assertNever(command);
  }
}

export async function promoText(store: GameStore, player: Player, draft: PromoDraft, input: GameInput): Promise<Reply> {
  const text = input.text?.trim() ?? '';
  switch (draft.step) {
    case 'currency':
      return { text: promoTexts.currency, keyboard: { kind: 'promo_currency' } };
    case 'name': {
      const length = Array.from(text).length;
      if (length < game.promo.minNameLength || length > game.promo.maxNameLength) {
        return back(promoTexts.nameLength);
      }
      if (!isPromoName(text)) {
        return back(promoTexts.nameInvalid);
      }
      if (await store.promo(text) !== null) {
        return back(`${promoTexts.exists}\n\n${promoTexts.name}`);
      }
      await store.setPromoDraft(player._id, { step: 'amount', currency: draft.currency, name: text });
      return back(promoAmountPrompt(draft.currency));
    }
    case 'amount': {
      const whole = parsePromoInteger(text);
      if (whole === null || whole < game.promo.minimum[draft.currency]) {
        return back(promoAmountPrompt(draft.currency));
      }
      const amount = BigInt(whole) * BigInt(promoScale(draft.currency));
      if (amount > BigInt(game.maxAmount)) {
        return back(promoTexts.limit);
      }
      await store.setPromoDraft(player._id, { step: 'quantity', currency: draft.currency, name: draft.name, amount: Number(amount) });
      return back(promoTexts.quantity);
    }
    case 'quantity': {
      const quantity = parsePromoInteger(text);
      if (quantity === null || quantity < game.promo.minQuantity) {
        return back(promoTexts.quantity);
      }
      if (promoTotal(draft.amount, quantity) === null) {
        return back(promoTexts.limit);
      }
      await store.setPromoDraft(player._id, { ...draft, step: 'confirm', quantity, token: input.eventId });
      return { text: promoTexts.confirm, keyboard: { kind: 'promo_confirm', token: input.eventId } };
    }
    case 'confirm':
      return { text: promoTexts.confirm, keyboard: { kind: 'promo_confirm', token: draft.token } };
    case 'activate': {
      const promo = isPromoName(text) ? await store.promo(text) : null;
      if (promo === null) {
        return back(promoTexts.notFound);
      }
      const result = await store.activatePromo(player, promo);
      switch (result) {
        case 'redeemed':
          await store.setPromoDraft(player._id, null);
          return { text: promoActivatedText(promo), keyboard: { kind: 'promo' } };
        case 'already': return back(promoTexts.already);
        case 'empty': return back(promoTexts.empty);
        case 'own': return back(promoTexts.own);
        case 'balance_limit': return back(promoTexts.balanceLimit);
        default: return assertNever(result);
      }
    }
    default: return assertNever(draft);
  }
}
