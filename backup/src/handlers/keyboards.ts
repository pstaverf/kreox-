import { giveawayTexts } from '../services/giveaway-texts.js';
import { privateCasinoConfig } from '../config/private-casino.js';
import { privateCasinoTexts } from '../services/private-casino-texts.js';
import { casinoTexts } from '../services/casino-texts.js';
import { bankLabels } from '../services/bank-texts.js';
import { formatKc } from '../services/texts.js';
import { donateLabels } from '../services/donate-texts.js';
import { itemLabels } from '../services/item-texts.js';
import { Keyboard, type KeyboardBuilder } from 'vk-io';
import { labels } from '../services/texts.js';
import type { Command, KeyboardSpec } from '../types/game.js';
import { assertNever } from '../utils/validation.js';

export function buildKeyboard(spec: KeyboardSpec): KeyboardBuilder {
  const button = (label: string, action: Command) => {
    const { kind, ...params } = action;
    return Keyboard.textButton({ label, payload: { command: kind, ...params } });
  };
  switch (spec.kind) {
    case 'giveaway': return Keyboard.keyboard([[
      Keyboard.textButton({ label: giveawayTexts.collect, color: Keyboard.POSITIVE_COLOR, payload: { command: 'giveaway_claim', peerId: spec.peerId, token: spec.token } }),
      Keyboard.textButton({ label: giveawayTexts.cancel, color: Keyboard.NEGATIVE_COLOR, payload: { command: 'giveaway_cancel', peerId: spec.peerId, token: spec.token } })
    ]]).inline();
    case 'dice_game': return Keyboard.keyboard([[
      Keyboard.textButton({ label: 'Играть', color: Keyboard.POSITIVE_COLOR, payload: { command: 'dice_join', peerId: spec.peerId, gameId: spec.gameId } }),
      Keyboard.textButton({ label: 'Отмена', color: Keyboard.NEGATIVE_COLOR, payload: { command: 'dice_leave', peerId: spec.peerId, gameId: spec.gameId } })
    ]]).inline();
    case 'casino': return Keyboard.keyboard([
      [button(privateCasinoTexts.chats, { kind: 'casino_chats' })],
      [button(privateCasinoTexts.jackpot, { kind: 'jackpot' }), button(privateCasinoTexts.coin, { kind: 'coin' })]
    ]).oneTime(false);
    case 'casino_chats': return Keyboard.keyboard([
      [Keyboard.urlButton({ label: 'Чат #1', url: privateCasinoConfig.chatUrl, payload: { command: 'casino_chats' } })],
      [button(labels.back, { kind: 'casino' })]
    ]).oneTime(false);
    case 'jackpot': return Keyboard.keyboard([
      [button(privateCasinoTexts.join, { kind: 'jackpot_join' })],
      [button(labels.back, { kind: 'casino' }), button(labels.menu, { kind: 'menu' })]
    ]).oneTime(false);
    case 'coin': return Keyboard.keyboard([
      [button('💎', { kind: 'coin_flip', side: 'diamond', token: spec.token, step: spec.step }), button('🟢', { kind: 'coin_flip', side: 'emerald', token: spec.token, step: spec.step })],
      [button(privateCasinoTexts.cashout, { kind: 'coin_cashout', token: spec.token, step: spec.step })],
      [button(labels.back, { kind: 'casino' })]
    ]).oneTime(false);
    case 'director': return Keyboard.keyboard([[button(casinoTexts.directorBid, { kind: 'director_bid' })], [button(labels.back, { kind: 'city' })]]).oneTime(false);
    case 'director_back': return Keyboard.keyboard([[button(labels.back, { kind: 'director_view' })]]).oneTime(false);
    case 'director_confirm': return Keyboard.keyboard([[
      Keyboard.textButton({ label: donateLabels.confirm, color: Keyboard.POSITIVE_COLOR, payload: { command: 'director_confirm', token: spec.token } }),
      Keyboard.textButton({ label: labels.back, color: Keyboard.NEGATIVE_COLOR, payload: { command: 'director_view' } })
    ]]).oneTime(false);
    case 'city':
      return Keyboard.keyboard([
        [button(bankLabels.director, { kind: 'city_director' }), button(bankLabels.bank, { kind: 'bank' }), button(bankLabels.casino, { kind: 'casino' })],
        [button(labels.menu, { kind: 'menu' })]
      ]).oneTime(false);
    case 'bank':
      return Keyboard.keyboard([
        [button(bankLabels.savings, { kind: 'bank_savings' })],
        [button(bankLabels.pension, { kind: 'bank_pension' }), button(bankLabels.transfer, { kind: 'bank_transfer_menu' })],
        [button(bankLabels.deposits, { kind: 'bank_deposits' })],
        [button(labels.back, { kind: 'city' })]
      ]).oneTime(false);
    case 'bank_savings':
      return Keyboard.keyboard([
        [button(bankLabels.add, { kind: 'bank_deposit_money' })], [button(bankLabels.withdraw, { kind: 'bank_withdraw_money' })],
        [button(labels.back, { kind: 'bank' }), button(labels.menu, { kind: 'menu' })]
      ]).oneTime(false);
    case 'bank_transfer_menu':
      return Keyboard.keyboard([[
        button('KC', { kind: 'bank_currency', currency: 'kc' }), button('💶', { kind: 'bank_currency', currency: 'euro' }), button('💠', { kind: 'bank_currency', currency: 'bitcoin' })
      ]]).oneTime(false);
    case 'bank_back': return Keyboard.keyboard([[button(bankLabels.back, { kind: spec.destination })]]).oneTime(false);
    case 'bank_deposits':
      return Keyboard.keyboard([
        [button(bankLabels.create, { kind: 'bank_deposit_create' })],
        ...spec.depositIds.map(depositId => [button(`🆔 ${depositId}`, { kind: 'bank_deposit', depositId })]),
        [button(labels.menu, { kind: 'menu' })]
      ]).oneTime(false);
    case 'bank_deposit_amount':
      return Keyboard.keyboard([
        spec.amounts.slice(0, 3).map(amount => button(formatKc(amount), { kind: 'bank_deposit_amount', amount })),
        spec.amounts.slice(3, 5).map(amount => button(formatKc(amount), { kind: 'bank_deposit_amount', amount })),
        [button(bankLabels.back, { kind: 'bank_deposits' })]
      ]).oneTime(false);
    case 'bank_deposit_term':
      return Keyboard.keyboard([
        [button('3 дня', { kind: 'bank_deposit_term', days: 3, token: spec.token }), button('10 дней', { kind: 'bank_deposit_term', days: 10, token: spec.token })],
        [button(bankLabels.back, { kind: 'bank_deposit_create' })]
      ]).oneTime(false);
    case 'bank_deposit_early': return Keyboard.keyboard([[button(bankLabels.early, { kind: 'bank_deposit_early', depositId: spec.depositId })]]).inline();
    case 'bank_deposit_confirm': return Keyboard.keyboard([[Keyboard.textButton({ label: bankLabels.confirm, color: Keyboard.POSITIVE_COLOR, payload: { command: 'bank_deposit_confirm', token: spec.token } })]]).inline();
    case 'donate':
      return Keyboard.keyboard([
        [button(donateLabels.nickname, { kind: 'donate_nick' }), button(donateLabels.thief, { kind: 'donate_thief' }), button(donateLabels.dealer, { kind: 'donate_dealer' })],
        [button(labels.back, { kind: 'menu' })]
      ]).oneTime(false);
    case 'donate_back': return Keyboard.keyboard([[button(labels.back, { kind: 'donate' })]]).oneTime(false);
    case 'donate_confirmation': {
      const keyboard = Keyboard.keyboard([[
        Keyboard.textButton({ label: donateLabels.confirm, color: Keyboard.POSITIVE_COLOR, payload: { command: 'donate_confirm', token: spec.token } }),
        Keyboard.textButton({ label: donateLabels.cancel, color: Keyboard.NEGATIVE_COLOR, payload: { command: 'donate_cancel', token: spec.token } })
      ]]);
      return spec.inline ? keyboard.inline() : keyboard.oneTime(false);
    }
    case 'item_detail':
      return Keyboard.keyboard([
        ...(spec.itemKind === 'croupier' ? [] : [[Keyboard.textButton({ label: itemLabels.use, payload: { command: 'item_use', itemKind: spec.itemKind } })]]),
        [Keyboard.textButton({ label: itemLabels.sell, payload: { command: 'item_sell', itemKind: spec.itemKind } }),
          Keyboard.textButton({ label: itemLabels.gift, payload: { command: 'item_gift', itemKind: spec.itemKind } })],
        [Keyboard.textButton({ label: labels.back, payload: { command: 'inventory', page: 0 } })]
      ]).oneTime(false);
    case 'item_use':
      return Keyboard.keyboard([
        [1, 5, 10].map(quantity => Keyboard.textButton({ label: `x${quantity}`, payload: { command: 'item_open', itemKind: spec.itemKind, quantity } })),
        [Keyboard.textButton({ label: itemLabels.custom, payload: { command: 'item_custom', itemKind: spec.itemKind } })],
        [Keyboard.textButton({ label: labels.back, payload: { command: 'item_detail', itemKind: spec.itemKind } })]
      ]).oneTime(false);
    case 'item_back':
      return Keyboard.keyboard([[Keyboard.textButton({ label: labels.back, payload: { command: 'item_detail', itemKind: spec.itemKind } })]]).oneTime(false);
    case 'item_confirmation':
      if (spec.mode === 'open') {
        return Keyboard.keyboard([
          [Keyboard.textButton({ label: itemLabels.open, payload: { command: 'item_open_confirm', token: spec.token } })],
          [Keyboard.textButton({ label: labels.back, payload: { command: 'inventory', page: 0 } })]
        ]).oneTime(false);
      }
      return Keyboard.keyboard([[Keyboard.textButton({ label: spec.mode === 'gift' ? itemLabels.giftConfirm : itemLabels.confirm,
        payload: { command: 'item_confirm', token: spec.token } })]]).inline();
    case 'item_offer':
      return Keyboard.keyboard([[Keyboard.textButton({ label: itemLabels.confirm,
        payload: { command: 'item_buy', offerId: spec.offerId } })]]).inline();
    case 'none':
      return Keyboard.keyboard([]);
    case 'promo':
      return Keyboard.keyboard([
        [Keyboard.textButton({ label: labels.createPromo, payload: { command: 'promo_create' } })],
        [Keyboard.textButton({ label: labels.activatePromo, color: Keyboard.POSITIVE_COLOR, payload: { command: 'promo_activate' } })],
        [Keyboard.textButton({ label: labels.myPromos, payload: { command: 'promo_list', after: null } })]
      ]).oneTime(false);
    case 'promo_currency':
      return Keyboard.keyboard([
        [
          Keyboard.textButton({ label: 'KC', payload: { command: 'promo_currency', currency: 'kc' } }),
          Keyboard.textButton({ label: '💶', payload: { command: 'promo_currency', currency: 'euro' } }),
          Keyboard.textButton({ label: '💠', payload: { command: 'promo_currency', currency: 'bitcoin' } })
        ],
        [Keyboard.textButton({ label: labels.back, payload: { command: 'promo_back' } })]
      ]).oneTime(false);
    case 'promo_back':
      return Keyboard.keyboard([[Keyboard.textButton({ label: labels.back, payload: { command: 'promo_back' } })]]).oneTime(false);
    case 'promo_confirm':
      return Keyboard.keyboard([[Keyboard.textButton({
        label: labels.confirmPromo, payload: { command: 'promo_confirm', token: spec.token }
      })]]).inline();
    case 'promo_list':
      return Keyboard.keyboard([
        ...(spec.after === null ? [] : [[Keyboard.textButton({ label: labels.next, payload: { command: 'promo_list', after: spec.after } })]]),
        [Keyboard.textButton({ label: labels.back, payload: { command: 'promo_back' } })]
      ]).oneTime(false);
    case 'main':
      return Keyboard.keyboard([
        [button(labels.battlePass, { kind: 'development' })],
        [button(labels.profile, { kind: 'profile' }), button(labels.bonus, { kind: 'bonus' }), button(labels.rating, { kind: 'ranking', metric: 'kc' })],
        [button(labels.promo, { kind: 'promo' }), Keyboard.textButton({ label: labels.city, color: Keyboard.PRIMARY_COLOR, payload: { command: 'city' } }), button(labels.mining, { kind: 'mining' })],
        [Keyboard.textButton({ label: labels.donate, color: Keyboard.POSITIVE_COLOR, payload: { command: 'donate' } }), button(labels.boss, { kind: 'development' }), button(labels.tasks, { kind: 'development' })],
        [button(labels.help, { kind: 'development' })]
      ]).oneTime(false);
    case 'profile':
      return Keyboard.keyboard([[button(labels.referral, { kind: 'referrals' }), button(labels.inventory, { kind: 'inventory', page: 0 })], [button(labels.menu, { kind: 'menu' })]]).oneTime(false);
    case 'mining':
      return Keyboard.keyboard([
        [button(labels.startMining, { kind: 'mining_start' }), button(labels.withdrawMining, { kind: 'mining_withdraw' })],
        [button(labels.upgradeMining, { kind: 'mining_upgrade' }), Keyboard.textButton({ label: labels.back, payload: { command: 'menu' } })]
      ]).oneTime(false);
    case 'mining_upgrade':
      return Keyboard.keyboard([
        [Keyboard.textButton({ label: labels.confirm, payload: { command: 'mining_confirm', level: spec.level } })],
        [Keyboard.textButton({ label: labels.upgradeBack, payload: { command: 'mining' } })]
      ]).oneTime(false);
    case 'ranking':
      return Keyboard.keyboard([
        [button(labels.kc, { kind: 'ranking', metric: 'kc' }), button(labels.bitcoin, { kind: 'ranking', metric: 'bitcoin' }), Keyboard.textButton({ label: labels.mining, payload: { command: 'ranking', metric: 'mining' } })],
        [button(labels.euro, { kind: 'ranking', metric: 'euro' }), button(labels.referrals, { kind: 'ranking', metric: 'referrals' }), button(labels.reputation, { kind: 'ranking', metric: 'reputation' })],
        [button(labels.thieves, { kind: 'ranking', metric: 'stolenKC' })],
        [Keyboard.textButton({ label: labels.back, payload: { command: 'menu' } })]
      ]).oneTime(false);
    case 'referrals':
      return Keyboard.keyboard([[Keyboard.textButton({ label: labels.back, payload: { command: 'profile' } })]]).oneTime(false);
    case 'inventory': {
      const rows = spec.itemIds.map(id => [Keyboard.textButton({ label: `🆔 ${id}`, payload: { command: 'item', itemId: id } })]);
      const navigation = [];
      if (spec.page > 0) {
        navigation.push(Keyboard.textButton({ label: labels.previous, payload: { command: 'inventory', page: spec.page - 1 } }));
      }
      if (spec.hasNext) {
        navigation.push(Keyboard.textButton({ label: labels.next, payload: { command: 'inventory', page: spec.page + 1 } }));
      }
      if (navigation.length > 0) {
        rows.push(navigation);
      }
      rows.push([button(labels.back, { kind: 'profile' })]);
      return Keyboard.keyboard(rows).oneTime(false);
    }
    default:
      return assertNever(spec);
  }
}
