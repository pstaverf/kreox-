import { itemConfig } from '../config/items.js';
import { game } from '../config/game.js';
import type { Player } from '../types/game.js';
import type { CaseRewards, ItemKind, ItemOffer } from '../types/items.js';
import { formatAmount, mention } from './texts.js';

export const itemLabels = {
  use: '✅ Использовать', sell: '💰 Продать', gift: '🎁 Подарить', custom: '📦 Свое кол-во', open: 'Открыть',
  confirm: '✅ Подтвердить', giftConfirm: '✅ Подтвредить'
} as const;
export const itemTexts = {
  done: 'Done.',
  none: '⚠️ У вас нет данного предмета!',
  target: '👤 Введите ссылку на игрока.\n\n💡 Например @kreox_owner',
  missing: '⚠️ Игрок не найден или ещё не зарегистрирован в боте.',
  self: '⚠️ Нельзя передать или продать предметы самому себе.',
  custom: '📦 Введите кол-во кейсов, которое хотите открыть.',
  cancelled: 'Действие отменено.',
  ready: '📦 Держите!',
  giftConfirm: 'Подтвердите передачу.',
  saleConfirm: '💡 Подтвердите продажу',
  sent: 'Предложение о сделке отправлено.',
  price: '👤 Введите цену.',
  badPrice: '⚠️ Введите целую неотрицательную цену в KC. Можно использовать к и кк.',
  badQuantity: `⚠️ Введите целое количество от 1 до ${itemConfig.maxBatch}.`,
  stale: '⚠️ Подтверждение устарело. Начните действие заново.',
  limit: '⚠️ Достигнут предел баланса или инвентаря. Действие не выполнено.',
  funds: '⚠️ Недостаточно KC для покупки.',
  expired: '⚠️ Срок сделки истёк.',
  invalidOffer: '⚠️ Сделка недоступна или уже завершена.',
  private: '⚠️ Управляйте предметами в личных сообщениях бота.',
  adminUsage: '⚠️ Формат: !giveitem <ID игрока> <ID предмета> или !takeitem <ID игрока> <ID предмета>. Каталог: !itemlist.'
} as const;
export function itemName(kind: ItemKind): string {
  const entry = itemConfig.catalog.find(item => item.kind === kind);
  if (entry === undefined) {
    throw new Error('Unknown item kind');
  }
  return entry.name;
}
function dropText(index: number): string {
  const drop = itemConfig.drops[index];
  if (drop === undefined) {
    throw new Error('Unknown case drop');
  }
  return drop.currency === 'kc' ? `💰 ${formatAmount(drop.amount, game.kcScale)} KC`
    : `💶 ${formatAmount(drop.amount, game.euroScale)} евро`;
}
export function itemDetails(kind: ItemKind, count: number, use = false): string {
  return (use ? `«${itemName(kind)}» (доступно: ${count} шт.):` : `📒 Предмет "${itemName(kind)}" (x${count}):`)
    + `\nМожет выпасть:\n\n${itemConfig.drops.map((_, index) => dropText(index)).join('\n')}`;
}
export function itemQuantityText(count: number): string {
  return `🎒 Введите число предметов (у вас: ${count}).`;
}
export function caseResultText(player: Player, rewards: CaseRewards): string {
  return `${mention(player)}, 🎁 Вот что выпало:\n\n` + rewards.counts.flatMap((count, index) =>
    count === 0 ? [] : [`${dropText(index)}${count > 1 ? ` x${count}` : ''}`]).join('\n\n');
}
export function giftSentText(receiver: Player, kind: ItemKind, quantity: number): string {
  return `✅ Вы успешно передали игроку ${mention(receiver)} ${itemName(kind)} x${quantity}`;
}
export function giftReceivedText(sender: Player, kind: ItemKind, quantity: number): string {
  return `🎁 ${mention(sender)} подарил вам ${itemName(kind)} x${quantity}`;
}
export function offerText(seller: Player, offer: ItemOffer): string {
  return `Игрок ${mention(seller)} предлагает вам купить у него ${itemName(offer.itemKind)} x${offer.quantity} за `
    + `${formatAmount(offer.price, game.kcScale)} KC. Через 10 минут сделка аннулируется.`;
}
export function boughtText(buyer: Player): string {
  return `${mention(buyer)}, сделка прошла успешно!`;
}
export function soldText(buyer: Player, offer: ItemOffer): string {
  return `${mention(buyer)} купил у вас ${itemName(offer.itemKind)} x${offer.quantity} за ${formatAmount(offer.price, game.kcScale)} KC`;
}

export function itemCatalogText(): string {
  return '📖 ItemList:\n\n' + itemConfig.catalog.map(item => `🆔 ${item.id} — ${item.name}`).join('\n\n');
}
