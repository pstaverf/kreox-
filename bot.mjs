// src/config/dice.ts
var diceConfig = {
  minPlayers: 2,
  maxPlayers: 5,
  maxGames: 5,
  lifetimeMs: 30 * 60 * 1e3,
  workerMs: 2e3,
  retryMs: 5e3,
  batchSize: 20,
  sides: 12,
  commissionId: 888801846,
  feeScale: 1e4,
  winnerFee: 100,
  tieFee: 345,
  minimum: { kc: 1e3, euro: 10, bitcoin: 10 }
};

// src/services/dice.ts
import { createHash } from "node:crypto";

// src/config/game.ts
var game = {
  maxRandomId: 2147483647,
  maxAmount: Number.MAX_SAFE_INTEGER,
  kcScale: 100,
  euroScale: 100,
  bitcoinScale: 1e8,
  bonusIntervalMs: 4 * 60 * 60 * 1e3,
  bonusResetMs: 24 * 60 * 60 * 1e3,
  sequentialAccounts: 50,
  randomAccountMin: 51,
  randomAccountMax: 9999,
  inventoryPageSize: 8,
  maxMessageLength: 4096,
  chatInventoryLimit: 256,
  leaderboardSize: 20,
  promo: {
    minNameLength: 5,
    maxNameLength: 20,
    minQuantity: 5,
    pageSize: 10,
    minimum: { kc: 1e4, euro: 5, bitcoin: 5 }
  },
  referralRewardKC: 15e5,
  notificationIntervalMs: 2e3,
  notificationLeaseMs: 12e4,
  notificationRetryMs: 5e3,
  notificationMaxRetryMs: 36e5,
  mining: {
    durationMs: 6 * 60 * 60 * 1e3,
    hourMs: 60 * 60 * 1e3,
    initialRate: 1e7,
    minWithdrawal: 1e8,
    precision: 1e5,
    minIncrease: 15e5,
    maxIncrease: 8e6,
    growthNumerator: 6,
    growthDenominator: 5,
    prices: [
      2e5,
      5e5,
      8e5,
      14e5,
      23e5,
      33e5,
      41e5,
      49e5,
      59e5,
      78e5,
      98e5,
      109e5,
      127e5,
      142e5,
      17e6,
      203e5
    ]
  },
  totalTasks: 0,
  duplicateRetries: 3,
  rewards: [
    { kc: 25e4, bitcoin: 15e7, case: false },
    { kc: 5e5, bitcoin: 25e7, case: false },
    { kc: 1e6, bitcoin: 25e7, case: false },
    { kc: 15e5, bitcoin: 5e8, case: false },
    { kc: 25e5, bitcoin: 75e7, case: false },
    { kc: 5e6, bitcoin: 1e9, case: false },
    { kc: 1e7, bitcoin: 25e8, case: true }
  ]
};
var accountCapacity = game.sequentialAccounts + game.randomAccountMax - game.randomAccountMin + 1;

// src/types/storage.ts
var DuplicateWriteError = class extends Error {
  constructor() {
    super("Concurrent unique write");
    this.name = "DuplicateWriteError";
  }
};

// src/utils/validation.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function assertNever(value) {
  throw new Error(`Unexpected variant: ${String(value)}`);
}

// src/config/bank.ts
var bankConfig = {
  dayMs: 24 * 60 * 60 * 1e3,
  weekMs: 7 * 24 * 60 * 60 * 1e3,
  savingsPercent: 2,
  transferPercent: 5,
  maxDeposits: 5,
  maxDeposit: 1e7 * game.kcScale,
  earlyPenaltyPercent: 10,
  depositRates: { 3: 2, 10: 4 },
  workerIntervalMs: 5e3,
  workerBatch: 20,
  retryMs: 6e4,
  pensionMinDays: 30,
  pensionHighDays: 60,
  pensionBasic: [500, 700, 900, 1e3, 1200, 1500, 1800, 2500, 5e3],
  pensionHigh: [5e3, 7e3, 1e4, 12e3, 15e3, 2e4, 25e3],
  depositPercents: [5, 10, 20, 50, 100],
  timeZone: "Europe/Moscow"
};

// src/services/bank-rules.ts
function isBankCommand(command) {
  return command.kind === "city" || command.kind === "bank" || command.kind.startsWith("bank_");
}
function isDepositDays(value) {
  return value === 3 || value === 10;
}
function safeBankMoney(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= game.maxAmount;
}
function bankDays(registeredAt, now) {
  return Math.max(0, Math.floor((now.getTime() - registeredAt.getTime()) / bankConfig.dayMs));
}
function transferNet(gross) {
  if (!safeBankMoney(gross) || gross <= 0) throw new Error("Invalid transfer amount");
  return Number(BigInt(gross) * BigInt(100 - bankConfig.transferPercent) / 100n);
}
function parseBankMoney(text, currency) {
  const value = text.trim();
  if (value.length > 64) return null;
  if (currency === "kc") {
    const match2 = /^(\d{1,16}|\d{1,3}(?:\.\d{3}){1,5})(?:,(\d{1,2}))?([kк]{1,2})?$/i.exec(value);
    if (match2?.[1] === void 0) return null;
    const result2 = (BigInt(match2[1].replaceAll(".", "")) * BigInt(game.kcScale) + BigInt((match2[2] ?? "").padEnd(2, "0"))) * 1000n ** BigInt(match2[3]?.length ?? 0);
    return result2 > 0n && result2 <= BigInt(game.maxAmount) ? Number(result2) : null;
  }
  const match = /^(\d{1,16})(?:[.,](\d{1,3}))?([kк]{1,2})?$/i.exec(value);
  if (match?.[1] === void 0) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > (currency === "euro" ? 2 : 3)) return null;
  const scale = currency === "euro" ? game.euroScale : game.bitcoinScale;
  const result = (BigInt(match[1]) * BigInt(scale) + BigInt(fraction.padEnd(String(scale).length - 1, "0"))) * 1000n ** BigInt(match[3]?.length ?? 0);
  return result > 0n && result <= BigInt(game.maxAmount) ? Number(result) : null;
}
function settleSavings(balance, since, now) {
  if (!safeBankMoney(balance) || !Number.isFinite(since.getTime()) || !Number.isFinite(now.getTime())) throw new Error("Invalid savings state");
  const weeks = Math.max(0, Math.floor((now.getTime() - since.getTime()) / bankConfig.weekMs));
  let value = BigInt(balance);
  for (let week = 0; week < weeks; week += 1) {
    const next = value * BigInt(100 + bankConfig.savingsPercent) / 100n;
    if (next === value) break;
    if (next >= BigInt(game.maxAmount)) {
      value = BigInt(game.maxAmount);
      break;
    }
    value = next;
  }
  return { balance: Number(value), since: new Date(since.getTime() + weeks * bankConfig.weekMs) };
}
function depositValue(deposit, now) {
  if (!isDepositDays(deposit.days) || !safeBankMoney(deposit.amount) || deposit.amount <= 0 || deposit.amount > bankConfig.maxDeposit || !Number.isFinite(deposit.createdAt.getTime()) || deposit.expiresAt.getTime() - deposit.createdAt.getTime() !== deposit.days * bankConfig.dayMs) throw new Error("Invalid deposit");
  const duration = deposit.days * bankConfig.dayMs;
  const elapsed = Math.min(duration, Math.max(0, now.getTime() - deposit.createdAt.getTime()));
  return deposit.amount + Number(BigInt(deposit.amount) * BigInt(bankConfig.depositRates[deposit.days]) * BigInt(elapsed) / (100n * BigInt(duration)));
}
function earlyDepositValue(deposit, now) {
  return Number(BigInt(depositValue(deposit, now)) * BigInt(100 - bankConfig.earlyPenaltyPercent) / 100n);
}
function depositButtons(wallet) {
  if (!safeBankMoney(wallet)) throw new Error("Invalid wallet");
  return bankConfig.depositPercents.map((percent) => Number(BigInt(wallet) * BigInt(percent) / 100n / BigInt(game.kcScale) * BigInt(game.kcScale)));
}

// src/config/roulette.ts
var range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
var red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
var black = range(1, 36).filter((number) => !red.includes(number));
var rouletteConfig = {
  numbers: 37,
  straightMultiplier: 36,
  red,
  black,
  groups: [
    { target: 37, label: "п1", multiplier: 2, numbers: range(1, 18) },
    { target: 38, label: "п2", multiplier: 2, numbers: range(19, 36) },
    { target: 39, label: "д1", multiplier: 3, numbers: range(1, 12) },
    { target: 40, label: "д2", multiplier: 3, numbers: range(13, 24) },
    { target: 41, label: "д3", multiplier: 3, numbers: range(25, 36) },
    { target: 42, label: "ч1", multiplier: 4, numbers: range(1, 9) },
    { target: 43, label: "ч2", multiplier: 4, numbers: range(10, 18) },
    { target: 44, label: "ч3", multiplier: 4, numbers: range(19, 27) },
    { target: 45, label: "ч4", multiplier: 4, numbers: range(28, 36) },
    { target: 46, label: "четное", multiplier: 2, numbers: range(1, 36).filter((number) => number % 2 === 0) },
    { target: 47, label: "нечетное", multiplier: 2, numbers: range(1, 36).filter((number) => number % 2 !== 0) },
    { target: 48, label: "красное", multiplier: 2, numbers: red },
    { target: 49, label: "черное", multiplier: 2, numbers: black },
    { target: 50, label: "большие", multiplier: 2, numbers: range(19, 36) },
    { target: 51, label: "малые", multiplier: 2, numbers: range(1, 18) }
  ],
  photoPrefetchIntervalMs: 2e3,
  photoPrefetchConcurrency: 2,
  photoTimeoutMs: 3e4,
  maxPhotoBytes: 10 * 1024 * 1024
};
var roulettePhotos = [
  "https://cdn.kleymorf.xyz/other/1a62ac90c1eb_photo_e53303d6.jpg",
  "https://cdn.kleymorf.xyz/other/fbe8f35afd63_photo_f1bc5cf6.jpg",
  "https://cdn.kleymorf.xyz/other/fb85c6a73e91_photo_9b34e1f8.jpg",
  "https://cdn.kleymorf.xyz/other/7c1bafb26aca_photo_9db44ec7.jpg",
  "https://cdn.kleymorf.xyz/other/0438e7e24f69_photo_5b24244a.jpg",
  "https://cdn.kleymorf.xyz/other/7ae4dd4cf8f6_photo_cc159f8b.jpg",
  "https://cdn.kleymorf.xyz/other/74cbd17307a9_photo_5e554b4c.jpg",
  "https://cdn.kleymorf.xyz/other/61b3c35ea629_photo_8c3da6e5.jpg",
  "https://cdn.kleymorf.xyz/other/ec47421fe334_photo_94789985.jpg",
  "https://cdn.kleymorf.xyz/other/6ed406a3592a_photo_581af863.jpg",
  "https://cdn.kleymorf.xyz/other/89165b9da39f_photo_92c6c31c.jpg",
  "https://cdn.kleymorf.xyz/other/61c7f4bee516_photo_e4d52fa6.jpg",
  "https://cdn.kleymorf.xyz/other/5e357483f0cd_photo_b9bee276.jpg",
  "https://cdn.kleymorf.xyz/other/de7b6e64c4b3_photo_691e9b96.jpg",
  "https://cdn.kleymorf.xyz/other/b905849f901b_photo_d73c3f1a.jpg",
  "https://cdn.kleymorf.xyz/other/33b7861f489e_photo_e47b4208.jpg",
  "https://cdn.kleymorf.xyz/other/fff75695a9d5_photo_cf522a83.jpg",
  "https://cdn.kleymorf.xyz/other/d6e6a37f7aa5_photo_d2f7dac3.jpg",
  "https://cdn.kleymorf.xyz/other/eda40c9fd86e_photo_7d9467c9.jpg",
  "https://cdn.kleymorf.xyz/other/fc3c1cd99a28_photo_fc200894.jpg",
  "https://cdn.kleymorf.xyz/other/a20e6698d442_photo_c4c5b043.jpg",
  "https://cdn.kleymorf.xyz/other/18b1007baf49_photo_30ee0385.jpg",
  "https://cdn.kleymorf.xyz/other/85578fb1f31d_photo_1c5bbf23.jpg",
  "https://cdn.kleymorf.xyz/other/e51ee81c280f_photo_38c03142.jpg",
  "https://cdn.kleymorf.xyz/other/7ede9b1adfcd_photo_45cd354a.jpg",
  "https://cdn.kleymorf.xyz/other/aa182cb6130f_photo_4f2ff8a7.jpg",
  "https://cdn.kleymorf.xyz/other/a5419b8c2b4b_photo_e18c46e7.jpg",
  "https://cdn.kleymorf.xyz/other/4baa5d148032_photo_c1cb97d3.jpg",
  "https://cdn.kleymorf.xyz/other/23d243c27159_photo_7ac390d7.jpg",
  "https://cdn.kleymorf.xyz/other/b6d98877f6ad_photo_6f971d44.jpg",
  "https://cdn.kleymorf.xyz/other/82dac72c9de1_photo_684ed4ae.jpg",
  "https://cdn.kleymorf.xyz/other/cc209b27f01e_photo_72709488.jpg",
  "https://cdn.kleymorf.xyz/other/1347dde8199b_photo_307137d6.jpg",
  "https://cdn.kleymorf.xyz/other/ede101d4a4a8_photo_09f6eb4c.jpg",
  "https://cdn.kleymorf.xyz/other/4f6d0e5880a6_photo_b7c695a7.jpg",
  "https://cdn.kleymorf.xyz/other/ea453e77163d_photo_9b9769fe.jpg",
  "https://cdn.kleymorf.xyz/other/e7c188483369_photo_a2c319c7.jpg"
];

// src/services/roulette-rules.ts
function validRouletteNumber(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < rouletteConfig.numbers;
}
function parseRouletteTarget(text) {
  const value = text.trim().toLowerCase().replaceAll("ё", "е");
  if (/^\d{1,2}$/.test(value)) {
    const target = Number(value);
    return validRouletteNumber(target) ? target : null;
  }
  return rouletteConfig.groups.find((group) => group.label === value)?.target ?? null;
}
function rouletteMultiplier(target) {
  if (validRouletteNumber(target)) return rouletteConfig.straightMultiplier;
  const group = rouletteConfig.groups.find((group2) => group2.target === target);
  if (group === void 0) throw new Error("Invalid roulette target");
  return group.multiplier;
}
function validRouletteTarget(target) {
  return validRouletteNumber(target) || rouletteConfig.groups.some((group) => group.target === target);
}
function rouletteWins(target, result) {
  if (!validRouletteNumber(result)) throw new Error("Invalid roulette outcome");
  if (validRouletteNumber(target)) return result === target;
  const group = rouletteConfig.groups.find((group2) => group2.target === target);
  if (group === void 0) throw new Error("Invalid roulette target");
  return group.numbers.includes(result);
}

// src/services/casino-rules.ts
import { randomBytes } from "node:crypto";

// src/config/casino.ts
var casinoConfig = {
  minimum: 1e3 * game.kcScale,
  maxBets: 10,
  acceptanceMs: 1e4,
  extensionMs: 500,
  resultsMs: 5e3,
  workerMs: 250,
  workerBatch: 40,
  announcementBatch: 20,
  chatPageSize: 200,
  chatSyncMs: 6e4,
  retryMs: 6e4,
  historySize: 20,
  directorPercent: 1,
  dealerPercent: 1,
  electionRefundPercent: 50,
  sectors: [1, 2, 5, 10, 20, 40],
  weights: [23, 15, 7, 4, 2, 1],
  maxCrash: 5e5,
  crashPrecision: 100,
  crashReturnPercent: 97,
  crashRandomSize: 1e9,
  moscowOffsetMs: 3 * 60 * 60 * 1e3,
  dayMs: 24 * 60 * 60 * 1e3
};

// src/services/casino-rules.ts
function nextElection(now) {
  return new Date((Math.floor((now.getTime() + casinoConfig.moscowOffsetMs) / casinoConfig.dayMs) + 1) * casinoConfig.dayMs - casinoConfig.moscowOffsetMs);
}
function casinoRandom(_purpose, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > game.maxAmount) throw new Error("Invalid random bound");
  for (let attempt = 0; attempt < 128; attempt += 1) {
    let value = 0n;
    for (const byte of randomBytes(7)) value = value << 8n | BigInt(byte);
    value &= (1n << 53n) - 1n;
    if (value < BigInt(maximum)) return Number(value);
    if (maximum < 2 ** 52) {
      const ceiling = (1n << 53n) / BigInt(maximum) * BigInt(maximum);
      if (value < ceiling) return Number(value % BigInt(maximum));
    }
  }
  throw new Error("Random rejection limit");
}
function cachedCasinoRandom(random) {
  const values = /* @__PURE__ */ new Map();
  return (purpose, maximum) => {
    const key = `${purpose}:${maximum}`;
    const value = values.get(key) ?? random(purpose, maximum);
    if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) throw new Error("Invalid casino randomness");
    values.set(key, value);
    return value;
  };
}
function selectOutcome(mode, random, key) {
  if (mode === "roulette") return { result: random(`${key}:roulette`, rouletteConfig.numbers), bonus: 1 };
  if (mode === "crash") {
    const roll = random(`${key}:crash`, casinoConfig.crashRandomSize) + 1;
    return { result: Math.max(casinoConfig.crashPrecision, Math.min(casinoConfig.maxCrash, Number(BigInt(casinoConfig.crashReturnPercent) * BigInt(casinoConfig.crashRandomSize) / BigInt(roll)))), bonus: 1 };
  }
  let ticket = random(`${key}:sector`, 52);
  for (const [index, weight] of casinoConfig.weights.entries()) {
    if (ticket < weight) {
      const result = casinoConfig.sectors[index];
      if (result === void 0) throw new Error("Invalid dream sector");
      const bonus = random(`${key}:bonus`, 1e3);
      return { result, bonus: bonus === 0 ? 7 : bonus <= 10 ? 2 : 1 };
    }
    ticket -= weight;
  }
  throw new Error("Invalid dream ticket");
}
function betPayout(mode, amount, target, bonus) {
  const value = mode === "crash" ? BigInt(amount) * BigInt(target) / BigInt(casinoConfig.crashPrecision) : mode === "roulette" ? BigInt(amount) * BigInt(rouletteMultiplier(target)) : BigInt(amount) * BigInt(target + 1) * BigInt(bonus);
  return value <= BigInt(game.maxAmount) ? Number(value) : null;
}
function roundKey(peerId, mode) {
  return `round:${peerId}:${mode}`;
}
function closeKey(round) {
  return `${round.roundId}:closed`;
}
function casinoPercent(amount, percent) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > game.maxAmount || !Number.isSafeInteger(percent) || percent < 0 || percent > 100) throw new Error("Invalid casino percentage");
  return Number(BigInt(amount) * BigInt(percent) / 100n);
}
function parseCasinoStake(text) {
  switch (text.trim().toLowerCase()) {
    case "пол":
      return "half";
    case "все":
    case "всё":
    case "вб":
      return "all";
    default:
      return parseBankMoney(text, "kc");
  }
}
function resolveCasinoStake(stake, wallet) {
  if (!safeBankMoney(wallet)) throw new Error("Invalid casino wallet");
  if (typeof stake === "number") {
    if (!safeBankMoney(stake)) throw new Error("Invalid casino stake");
    return stake;
  }
  switch (stake) {
    case "half":
      return Number(BigInt(wallet) / 2n);
    case "all":
      return wallet;
    default:
      return assertNever(stake);
  }
}

// src/config/items.ts
var itemConfig = {
  maxBatch: 1e3,
  offerDurationMs: 10 * 60 * 1e3,
  catalog: [
    { id: 1, kind: "zhdun_case", name: "💼 Кейс «Ждун»" },
    { id: 2, kind: "referral_case", name: "👬 Кейс «Реферальный»" },
    { id: 3, kind: "croupier", name: "🤴 Крупьер" }
  ],
  drops: [
    { currency: "kc", amount: 15e4, weight: 30 },
    { currency: "kc", amount: 25e4, weight: 30 },
    { currency: "kc", amount: 15e5, weight: 30 },
    { currency: "euro", amount: 100, weight: 5 },
    { currency: "euro", amount: 200, weight: 3 },
    { currency: "euro", amount: 500, weight: 2 }
  ]
};

// src/services/texts.ts
var labels = {
  createPromo: "📝 Создать промо",
  activatePromo: "🔑 Активировать",
  myPromos: "📖 Мои промо",
  confirmPromo: "✅ Подтвердить",
  battlePass: "🎟️ BattlePass",
  profile: "👨‍🦰 Профиль",
  bonus: "🎁 Бонус",
  rating: "🏆 Рейтинг",
  promo: "🏷 Промо",
  city: "🏙️ Город",
  mining: "⛏️ Майнинг",
  donate: "🍩 Донат",
  boss: "🎩 Босс",
  tasks: "📍 Задания",
  help: "🆘 Помощь",
  inventory: "🎒 Инвентарь",
  menu: "📕 Меню",
  back: "↩️ Назад",
  previous: "◀️",
  next: "▶️",
  referral: "👤 Реф",
  startMining: "💡 Включить",
  withdrawMining: "💠 Снять",
  upgradeMining: "⏫ Улучшить",
  confirm: "Подтвердить",
  upgradeBack: "Назад",
  kc: "💰 KC",
  bitcoin: "💠 Биткоин",
  euro: "💶 Евро",
  referrals: "👤 Рефералы",
  reputation: "👍 Репутация",
  thieves: "🥷 Воры"
};
var texts = {
  adminDone: "Done.",
  adminBalanceUsage: "⚠️ Формат: !set [@id123] 100 или !add [@id123] 100k. Можно ответом на сообщение. Сумма — целое неотрицательное число KC; к = тысяча, кк = миллион.",
  adminWalletUsage: "⚠️ Формат: !setdonut / !adddonut / !takedonut <VK ID> <сумма евро> или !setbit / !addbit / !takebit <VK ID> <сумма BTC>. Вместо ID можно ответить на сообщение. Евро — до 2 знаков после запятой, BTC — до 3.",
  adminWalletLimit: "⚠️ Недостаточно средств или достигнут предел баланса. Баланс не изменён.",
  adminBalanceTarget: "⚠️ Укажите игрока: ответом на его сообщение или через @id123.",
  adminBalanceMissing: "⚠️ Игрок ещё не зарегистрирован в боте.",
  adminBalanceLimit: "⚠️ Достигнут предел баланса. Баланс не изменён.",
  keyboardsDeleted: "Done.",
  welcome: "👋🏻 Добро пожаловать в Kreox Bot!\n\nТут ты сможешь развиваться и влетать в топы по всему боту.\n\nТебя ждет интересный и увлекательный функционал.\n\nУдачи.",
  development: "⚙️ В разработке…",
  emptyInventory: "Ваш инвентарь пуст.",
  inventoryTitle: "🎒 Ваш инвентарь:",
  caseName: "💼 Кейс «Ждун»",
  referralCaseName: "👬 Кейс «Реферальный»",
  miningStarted: "✅ Ферма запущена на 6 часов.",
  miningAlreadyStarted: "Ферма уже включена!",
  miningEmpty: "⚠️ Баланс Вашей фермы пуст.",
  miningInsufficient: "⚠️ Недостаточно биткоинов для улучшения фермы.",
  miningStaleOffer: "⚠️ Это улучшение уже применено или устарело. Нажмите «⏫ Улучшить» ещё раз.",
  miningLimit: "⚠️ Достигнут предел баланса или уровня фермы.",
  inventoryTooLarge: "⚠️ Инвентарь не помещается в одно сообщение. Откройте его в личных сообщениях бота.",
  error: "⚠️ Не удалось выполнить действие. Попробуйте ещё раз.",
  balanceLimit: "⚠️ Бонус не получен: достигнут предел баланса или инвентаря.",
  registrationLimit: "⚠️ Сейчас регистрация недоступна. Попробуйте позже."
};
function formatAmount(amount, scale, minimumDecimals = 0) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(scale) || scale < 1) {
    throw new Error("Invalid amount");
  }
  const digits = String(scale).length - 1;
  if (scale !== 10 ** digits || !Number.isSafeInteger(minimumDecimals) || minimumDecimals < 0 || minimumDecimals > digits) {
    throw new Error("Invalid amount scale");
  }
  const value = BigInt(amount);
  const divisor = BigInt(scale);
  const whole = String(value / divisor).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = String(value % divisor).padStart(digits, "0").replace(/0+$/, "").padEnd(minimumDecimals, "0");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}
function mention(player) {
  return `[id${player._id}|${player.name}]`;
}
function profileText(player, now) {
  const percentage = game.totalTasks > 0 ? (player.completedTasks * 100 / game.totalTasks).toFixed(2) : "0.00";
  return [
    `👤Ник: ${mention(player)}`,
    `💸 Баланс: ${formatAmount(player.kc, game.kcScale)} KC`,
    `💶 Евро: ${formatAmount(player.euro, game.euroScale)}`,
    `💠 Биткоин: ${formatMining(player.bitcoin)}₿`,
    `👍 Репутация: ${player.reputation}`,
    `🏆 Задания: ${player.completedTasks}/${game.totalTasks} [${percentage}%]`,
    ...now === void 0 || player.registeredAt === void 0 ? [] : [`🤖 В боте ${Math.max(0, Math.floor((now.getTime() - player.registeredAt.getTime()) / bankConfig.dayMs))} дней. | ${new Intl.DateTimeFormat("ru-RU", { timeZone: bankConfig.timeZone, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(player.registeredAt).replace(", ", " ")}`],
    `🆔${player.accountId}`
  ].join("\n");
}
function bonusText(day, reward) {
  return `🎁 Бонус ${day}-го дня:

` + [
    `💰 ${formatAmount(reward.kc, game.kcScale)} KC`,
    `💠 ${formatAmount(reward.bitcoin, game.bitcoinScale, 1)}₿`,
    ...reward.case ? [texts.caseName] : []
  ].join("\n");
}
function cooldownText(remainingMs) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1e3));
  return `⏳ Подожди ещё ${Math.floor(seconds / 3600)} ч. ${Math.floor(seconds % 3600 / 60)} мин. ${seconds % 60} сек.`;
}
function inventoryText(items) {
  return `${texts.inventoryTitle}

${items.length === 0 ? texts.emptyInventory : items.map((item) => {
    const entry = itemConfig.catalog.find((entry2) => entry2.kind === item.kind);
    if (entry === void 0) throw new Error("Unknown inventory kind");
    return `🆔 ${item.itemId} — ${entry.name} (${item.quantity} шт.)`;
  }).join("\n")}`;
}
function formatMining(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Invalid mining amount");
  }
  const thousandths = BigInt(amount) / BigInt(game.mining.precision);
  return `${thousandths / 1000n},${String(thousandths % 1000n).padStart(3, "0")}`;
}
function durationText(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1e3));
  return `${Math.floor(seconds / 3600)} ч. ${Math.floor(seconds % 3600 / 60)} мин. ${seconds % 60} сек.`;
}
function miningText(farm, now) {
  const remaining = farm.activeUntil.getTime() - now.getTime();
  return [
    "📼 Ваша майнинг-ферма:",
    `💡 Статус: ${remaining > 0 ? "Включена" : "Выключена"}`,
    "",
    `⛏️ Добыча: ${formatMining(farm.rate)}₿/час`,
    `💠 Баланс: ${formatMining(farm.balance)}₿`,
    ...remaining > 0 ? [`⏳ Осталось ${durationText(remaining)}`] : []
  ].join("\n");
}
function miningOfferText(cost) {
  return `💡 Улучшение фермы стоит ${formatMining(cost)}₿.`;
}
function miningUpgradedText(farm, increase) {
  return `✅ Ферма прокачана! Теперь она дает ${formatMining(farm.rate)}₿/ч (+${formatMining(increase).replace(",", ".")})
⬆ Следующее улучшение стоит ${formatMining(farm.upgradeCost)}₿.`;
}
function referralText(url, count) {
  return `👬 Приглашайте друзей и получайте награды!

🔗 Ссылка для приглашения: ${url}
Вы уже пригласили игроков: ${count}`;
}
function referralRewardText(newcomer) {
  return `👬 ${mention(newcomer)} перешел по вашей реферальной ссылке.

✅ Вы получили:

💰 ${formatAmount(game.referralRewardKC, game.kcScale)} KC
${texts.referralCaseName} (1 шт.)`;
}
var rankingTitles = {
  kc: "💰 Топ игроков по балансу:",
  bitcoin: "💠 Топ игроков по биткоинам:",
  mining: "⛏️ Топ игроков по майнингу:",
  euro: "💶 Топ игроков по еврам:",
  referrals: "👥 Топ игроков по приглашенным:",
  reputation: "👍 Топ игроков по репутации:",
  stolenKC: "🥷 Топ воров:"
};
function rankEmoji(place) {
  return String(place).split("").map((digit) => `${digit}️⃣`).join("");
}
function rankingValue(score, metric) {
  switch (metric) {
    case "kc":
    case "stolenKC":
      return `${formatAmount(score, game.kcScale)} KC`;
    case "bitcoin":
      return `${formatMining(score)}₿`;
    case "mining":
      return `${formatMining(score)}₿/час`;
    case "euro":
      return `${formatAmount(score, game.euroScale)} 💶`;
    case "referrals":
      return `${formatAmount(score, 1)} рефералов.`;
    case "reputation":
      return formatAmount(score, 1);
  }
}
function rankingText(metric, ranking, player, score) {
  const rows = ranking.leaders.map((leader, index) => `${rankEmoji(index + 1)} ${mention(leader)} — ${rankingValue(leader.score, metric)}`);
  return `${rankingTitles[metric]}

${rows.join("\n")}
—————————————————
➡${rankEmoji(ranking.place)} ${mention(player)} — ${rankingValue(score, metric)}`;
}
function miningWithdrawalText(amount) {
  return `✅ Вы сняли ${formatMining(amount)}₿.`;
}

// src/services/admin-balance.ts
function validBalanceChange(operation, amount) {
  return (operation === "set" || operation === "add" || operation === "take") && Number.isSafeInteger(amount) && amount >= 0 && amount <= game.maxAmount;
}
function isBalanceCurrency(value) {
  return value === "kc" || value === "euro" || value === "bitcoin";
}
async function adminBalanceAction(store, input, command) {
  const reply3 = (text) => ({ text, keyboard: { kind: "none" } });
  const currency = command.currency ?? "kc";
  if (command.kind === "admin_balance_invalid" || !isBalanceCurrency(currency) || !validBalanceChange(command.operation, command.amount)) {
    return reply3(currency === "kc" ? texts.adminBalanceUsage : texts.adminWalletUsage);
  }
  const targetId = command.targetId ?? input.replySenderId ?? input.vkId;
  if (!isPositiveId(targetId)) {
    return reply3(texts.adminBalanceTarget);
  }
  if (await store.player(targetId) === null) {
    return reply3(texts.adminBalanceMissing);
  }
  const changed = await store.updateBalance(targetId, currency, command.operation, command.amount);
  return reply3(changed ? texts.adminDone : currency === "kc" ? texts.adminBalanceLimit : texts.adminWalletLimit);
}

// src/services/promo-rules.ts
function isPromoCurrency(value) {
  return value === "kc" || value === "euro" || value === "bitcoin";
}
function isPromoName(value) {
  if (typeof value !== "string" || value !== value.trim() || !value.isWellFormed() || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
    return false;
  }
  const length = Array.from(value).length;
  return length >= game.promo.minNameLength && length <= game.promo.maxNameLength;
}
function promoScale(currency) {
  switch (currency) {
    case "kc":
      return game.kcScale;
    case "euro":
      return game.euroScale;
    case "bitcoin":
      return game.bitcoinScale;
  }
}
function parsePromoInteger(text) {
  if (!/^(?:\d{1,16}|[1-9]\d{0,2}(?:\.\d{3}){1,5})$/.test(text)) {
    return null;
  }
  const value = Number(text.replaceAll(".", ""));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function promoTotal(amount, quantity) {
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(quantity) || quantity < game.promo.minQuantity) {
    return null;
  }
  const value = BigInt(amount) * BigInt(quantity);
  return value <= BigInt(game.maxAmount) ? Number(value) : null;
}
function validPromoReward(currency, amount) {
  if (!isPromoCurrency(currency)) {
    return false;
  }
  const scale = promoScale(currency);
  return Number.isSafeInteger(amount) && amount <= game.maxAmount && amount % scale === 0 && amount >= game.promo.minimum[currency] * scale;
}
function promoRedemptionId(name, vkId) {
  return `${Buffer.from(name, "utf8").toString("hex")}:${vkId}`;
}
function isPromoCommand(command) {
  switch (command.kind) {
    case "promo":
    case "promo_create":
    case "promo_activate":
    case "promo_back":
    case "promo_currency":
    case "promo_confirm":
    case "promo_list":
      return true;
    default:
      return false;
  }
}
function validatePromo(promo) {
  if (!isPromoName(promo._id) || !isPositiveId(promo.ownerId) || !validPromoReward(promo.currency, promo.amount) || promoTotal(promo.amount, promo.quantity) === null || !Number.isSafeInteger(promo.remaining) || promo.remaining < 0 || promo.remaining > promo.quantity) {
    throw new Error("Invalid promo record");
  }
}

// src/services/dice-rules.ts
function isDiceCommand(command) {
  return command.kind === "dice_list" || command.kind === "dice_invalid" || command.kind === "dice_create" || command.kind === "dice_join" || command.kind === "dice_leave";
}
function diceChatKey(peerId) {
  return `dice-chat:${peerId}`;
}
function diceMinimum(currency) {
  return diceConfig.minimum[currency] * promoScale(currency);
}
function validDiceStake(currency, amount, slots) {
  return isBalanceCurrency(currency) && safeBankMoney(amount) && amount >= diceMinimum(currency) && Number.isSafeInteger(slots) && slots >= diceConfig.minPlayers && slots <= diceConfig.maxPlayers && BigInt(amount) * BigInt(slots) <= BigInt(game.maxAmount);
}
function diceDistribution(amount, count, winners) {
  if (!safeBankMoney(amount) || amount <= 0 || !Number.isSafeInteger(count) || count < 2 || count > diceConfig.maxPlayers || !Number.isSafeInteger(winners) || winners < 1 || winners > count) throw new Error("Invalid dice distribution");
  const pot = BigInt(amount) * BigInt(count);
  if (pot > BigInt(game.maxAmount)) throw new Error("Dice pot limit");
  const fee = winners === 1 ? diceConfig.winnerFee : diceConfig.tieFee;
  const each = pot * BigInt(diceConfig.feeScale - fee) / (BigInt(diceConfig.feeScale) * BigInt(winners));
  return { each: Number(each), commission: Number(pot - each * BigInt(winners)) };
}
function refreshDiceDeadline(chat) {
  chat.dueAt = new Date(Math.min(864e13, ...chat.games.map((value) => value.expiresAt.getTime())));
}
function validateDiceChat(chat) {
  if (chat._id !== diceChatKey(chat.peerId) || !Number.isSafeInteger(chat.peerId) || chat.peerId <= 2e9 || !Number.isSafeInteger(chat.lastGame) || chat.lastGame < 0 || chat.lastGame > game.maxAmount || chat.games.length > diceConfig.maxGames || new Set(chat.games.map((value) => value.gameId)).size !== chat.games.length) throw new Error("Invalid dice chat");
  for (const value of chat.games) validateDiceGame(value, chat.lastGame);
}
function validateDiceGame(value, lastGame) {
  if (!Number.isSafeInteger(value.gameId) || value.gameId < 1 || value.gameId > lastGame || !validDiceStake(value.currency, value.amount, value.slots) || !Number.isFinite(value.expiresAt.getTime()) || value.players.length < 1 || value.players.length >= value.slots || new Set(value.players.map((player) => player.vkId)).size !== value.players.length || value.players.some((player) => !Number.isSafeInteger(player.vkId) || player.vkId < 1 || !/^[a-f0-9]{64}$/.test(player.entryId))) throw new Error("Invalid dice game");
}

// src/services/dice-texts.ts
var diceTexts = {
  empty: "Костей нет.",
  accepted: "🎲 Ставка принята.",
  left: "🎲 Вы покинули кости.",
  notPlaying: "🎲 Вы и так не играете.",
  alreadyPlaying: "🎲 Вы уже играете в этих костях.",
  full: "🎲 В беседе уже есть 5 активных игр в кости.",
  funds: "🎲 Недостаточно средств для ставки.",
  limit: "🎲 Сумма ставки или банк игры превышает допустимый предел.",
  usage: "🎲 Формат: кости <ставка> [2–5], кости евро <ставка> [2–5] или кости бит <ставка> [2–5].",
  pending: "🎲 Начисление сохранено и будет выполнено автоматически, когда баланс позволит принять сумму."
};
function diceMinimumText(currency) {
  return currency === "kc" ? "🎲 Ставка от 1.000 KC." : currency === "euro" ? "🎲 Ставка от 10 💶." : "🎲 Ставка от 10₿.";
}
function diceMoney(amount, currency) {
  const scale = promoScale(currency);
  const whole = formatAmount(Number(BigInt(amount) / BigInt(scale)), 1);
  const fraction = String(BigInt(amount) % BigInt(scale)).padStart(String(scale).length - 1, "0").replace(/0+$/, "");
  const number = fraction.length === 0 ? whole : `${whole},${fraction}`;
  return `${number}${currency === "kc" ? " KC" : currency === "euro" ? " 💶" : "₿"}`;
}
function diceMention(player) {
  return mention({ _id: player.vkId, name: player.name });
}
function diceNumber(gameId) {
  return formatAmount(gameId, 1);
}
function diceCard(value, now) {
  const seconds = Math.max(0, Math.ceil((value.expiresAt.getTime() - now.getTime()) / 1e3));
  return `🎲 Игра в кости #${diceNumber(value.gameId)}
💰 Ставка: ${diceMoney(value.amount, value.currency)}

👥 Мест: [${value.players.length}/${value.slots}]
✅ Игроки:
${value.players.map(diceMention).join("\n")}

⏱️ До отмены игры: ${Math.floor(seconds / 60)} мин. ${seconds % 60} сек.`;
}
function diceResult(value, scores, winners, each) {
  const lines = value.players.map((player, index) => `${diceMention(player)}: ${scores[index]}`).join("\n");
  const winner = winners[0];
  if (winner === void 0) throw new Error("Missing dice winner");
  const result = winners.length === 1 ? `💰 Победитель: ${diceMention(winner)}, он забирает весь банк в ${diceMoney(each, value.currency)}` : `💰 ${winners.map(diceMention).join(", ")} делят между собой весь банк. Каждый получает: ${diceMoney(each, value.currency)}`;
  return `🎲 Игра в кости #${diceNumber(value.gameId)}:

${lines}

${result}`;
}
function diceExpired(gameId) {
  return `Игра в кости #${diceNumber(gameId)} отменена в связи с истечением времени.`;
}
function diceRefund(value) {
  return `🎲 Игра в кости #${diceNumber(value.gameId)} была завершена по истечению времени.

💰 Ваша ставка в размере ${diceMoney(value.amount, value.currency)} возвращена`;
}

// src/services/dice.ts
var reply = (text = "") => ({ text, keyboard: { kind: "none" } });
async function diceChat(store, peerId) {
  const value = await store.casinoGet(diceChatKey(peerId));
  if (value === null) return null;
  if (value.kind !== "dice_chat") throw new Error("Invalid dice chat record");
  validateDiceChat(value);
  return value;
}
async function diceButtonActive(store, input, command) {
  if (!input.isChat || typeof input.peerId !== "number" || !isPositiveId(input.peerId) || input.peerId <= 2e9) return false;
  if (command.kind !== "dice_join" && command.kind !== "dice_leave") return true;
  if (command.peerId !== input.peerId) return false;
  const chat = await diceChat(store, input.peerId);
  const value = chat?.games.find((entry) => entry.gameId === command.gameId);
  return value !== void 0 && value.expiresAt > await store.now();
}
async function payCredit(store, credit, now) {
  if (credit.stage !== "pending" || !safeBankMoney(credit.amount) || credit.amount <= 0 || !isPositiveId(credit.vkId)) throw new Error("Invalid dice credit");
  const paid = await store.updateBalance(credit.vkId, credit.currency, "add", credit.amount);
  if (paid) {
    credit.stage = "paid";
    if (credit.notice.length > 0) await store.enqueueItemNotification(`notice:${credit._id}`, credit.vkId, credit.notice, { kind: "none" });
  } else credit.dueAt = new Date(now.getTime() + diceConfig.retryMs);
  await store.casinoSave(credit);
  return paid;
}
async function creditDice(store, key, vkId, value, amount, now, notice = "") {
  if (!safeBankMoney(amount) || amount <= 0) throw new Error("Invalid dice amount");
  const credit = { _id: `dice-credit:${key}`, kind: "dice_credit", version: 0, vkId, currency: value.currency, amount, notice, stage: "pending", dueAt: now };
  await store.casinoInsert(credit);
  return payCredit(store, credit, now);
}
async function saveChat(store, chat, deadline) {
  refreshDiceDeadline(chat);
  validateDiceChat(chat);
  await store.casinoSave(chat, deadline);
}
async function expireGames(store, chat, now) {
  const expired = chat.games.filter((value) => value.expiresAt <= now);
  for (const value of expired) {
    const key = `${chat.peerId}:${value.gameId}`;
    for (const player of value.players) await creditDice(store, `refund:${key}:${player.entryId}`, player.vkId, value, value.amount, now, diceRefund(value));
    await store.enqueueItemNotification(`dice-expired:${key}`, chat.peerId, diceExpired(value.gameId), { kind: "none" });
  }
  if (expired.length > 0) {
    chat.games = chat.games.filter((value) => value.expiresAt > now);
    await saveChat(store, chat);
  }
  return expired.length;
}
async function finishDice(store, chat, value, now, random) {
  const key = `${chat.peerId}:${value.gameId}`;
  const scores = value.players.map((player) => {
    const roll = random(`dice:${key}:${player.vkId}`, diceConfig.sides);
    if (!Number.isSafeInteger(roll) || roll < 0 || roll >= diceConfig.sides) throw new Error("Invalid dice roll");
    return roll + 1;
  });
  const best = Math.max(...scores);
  const winners = value.players.filter((_player, index) => scores[index] === best);
  const distribution = diceDistribution(value.amount, value.players.length, winners.length);
  for (const winner of winners) {
    const paid = await creditDice(store, `winner:${key}:${winner.vkId}`, winner.vkId, value, distribution.each, now);
    if (!paid) await store.enqueueItemNotification(`dice-waiting:${key}:${winner.vkId}`, winner.vkId, `${diceTexts.pending}
💰 Сумма: ${diceMoney(distribution.each, value.currency)}`, { kind: "none" });
  }
  if (distribution.commission > 0) await creditDice(store, `commission:${key}`, diceConfig.commissionId, value, distribution.commission, now);
  await store.enqueueItemNotification(`dice-result:${key}`, chat.peerId, diceResult(value, scores, winners, distribution.each), { kind: "none" });
  chat.games = chat.games.filter((entry) => entry.gameId !== value.gameId);
  await saveChat(store, chat, value.expiresAt);
}
async function diceAction(store, input, player, command, random) {
  const peerId = input.peerId;
  if (!input.isChat || typeof peerId !== "number" || !isPositiveId(peerId) || peerId <= 2e9) return reply();
  if ((command.kind === "dice_join" || command.kind === "dice_leave") && command.peerId !== peerId) return reply();
  const now = await store.now();
  let chat = await diceChat(store, peerId);
  if (chat !== null) await expireGames(store, chat, now);
  if (command.kind === "dice_invalid") return reply(command.minimum ? diceMinimumText(command.currency) : diceTexts.usage);
  if (command.kind === "dice_list") {
    if (chat === null || chat.games.length === 0) return reply(diceTexts.empty);
    for (const value2 of chat.games) await store.enqueueItemNotification(`dice-list:${input.eventId}:${value2.gameId}`, peerId, diceCard(value2, now), { kind: "dice_game", peerId, gameId: value2.gameId });
    return reply();
  }
  if (command.kind === "dice_create") {
    let amount = command.amount;
    if (typeof amount !== "number") {
      const current = await store.player(input.vkId);
      if (current === null) throw new Error("Missing dice balance");
      amount = resolveCasinoStake(amount, current[command.currency]);
    }
    if (amount < diceMinimum(command.currency)) return reply(diceMinimumText(command.currency));
    if (!validDiceStake(command.currency, amount, command.slots)) return reply(diceTexts.limit);
    if (chat === null) {
      chat = { _id: diceChatKey(peerId), kind: "dice_chat", version: 0, peerId, lastGame: 0, games: [], dueAt: now };
      refreshDiceDeadline(chat);
      await store.casinoInsert(chat);
    }
    if (chat.games.length >= diceConfig.maxGames) return reply(diceTexts.full);
    if (chat.lastGame >= game.maxAmount) return reply(diceTexts.limit);
    if (player === null) throw new Error("Missing dice creator");
    if (!await store.updateBalance(player._id, command.currency, "take", amount)) return reply(diceTexts.funds);
    const value2 = {
      gameId: ++chat.lastGame,
      currency: command.currency,
      amount,
      slots: command.slots,
      expiresAt: new Date(now.getTime() + diceConfig.lifetimeMs),
      players: [{ vkId: player._id, name: player.name, entryId: createHash("sha256").update(input.eventId).digest("hex") }]
    };
    chat.games.push(value2);
    await saveChat(store, chat, value2.expiresAt);
    return { text: diceCard(value2, now), keyboard: { kind: "dice_game", peerId, gameId: value2.gameId } };
  }
  const value = chat?.games.find((entry) => entry.gameId === command.gameId);
  if (chat === null || value === void 0) return reply();
  const existing = value.players.find((entry) => entry.vkId === input.vkId);
  if (command.kind === "dice_leave") {
    if (existing === void 0) return reply(diceTexts.notPlaying);
    const paid = await creditDice(store, `refund:${peerId}:${value.gameId}:${existing.entryId}`, existing.vkId, value, value.amount, now);
    value.players = value.players.filter((entry) => entry.vkId !== input.vkId);
    if (value.players.length === 0) chat.games = chat.games.filter((entry) => entry.gameId !== value.gameId);
    await saveChat(store, chat, value.expiresAt);
    return reply(paid ? diceTexts.left : `${diceTexts.left}
${diceTexts.pending}`);
  }
  if (existing !== void 0) return reply(diceTexts.alreadyPlaying);
  if (player === null) throw new Error("Missing dice participant");
  if (!await store.updateBalance(input.vkId, value.currency, "take", value.amount)) return reply(diceTexts.funds);
  value.players.push({ vkId: input.vkId, name: player.name, entryId: createHash("sha256").update(input.eventId).digest("hex") });
  if (value.players.length === value.slots) {
    await finishDice(store, chat, value, now, random);
    return reply();
  }
  await saveChat(store, chat, value.expiresAt);
  return reply(diceTexts.accepted);
}
async function settleDice(database) {
  let count = 0;
  for (let index = 0; index < diceConfig.batchSize; index += 1) {
    try {
      const work = await database.transaction(async (store) => {
        const now = await store.now();
        const chat = (await store.casinoList({ kind: "dice_chat", dueAt: now }, 1))[0];
        if (chat !== void 0) {
          if (chat.kind !== "dice_chat") throw new Error("Invalid expired dice chat");
          validateDiceChat(chat);
          return await expireGames(store, chat, now) > 0;
        }
        const credit = (await store.casinoList({ kind: "dice_credit", dueAt: now }, 1))[0];
        if (credit === void 0) return false;
        if (credit.kind !== "dice_credit") throw new Error("Invalid pending dice record");
        await payCredit(store, credit, now);
        return true;
      });
      if (!work) break;
      count += 1;
    } catch (error) {
      if (!(error instanceof DuplicateWriteError)) throw error;
    }
  }
  return count;
}

// src/utils/log.ts
import { APIError } from "vk-io";
import { MongoServerError } from "mongodb";
function logError(scope, error, context = {}) {
  console.error(JSON.stringify({
    scope,
    type: error instanceof Error ? error.name : "UnknownError",
    code: error instanceof APIError || error instanceof MongoServerError ? error.code : void 0,
    ...context
  }));
}

// src/handlers/dice-worker.ts
function startDiceWorker(database, wakeNotifications) {
  let running;
  let stopped = false;
  const tick = () => {
    if (stopped || running !== void 0) return;
    running = settleDice(database).then((work) => {
      if (work > 0) wakeNotifications();
    }).catch((error) => {
      logError("dice_worker", error);
    }).finally(() => {
      running = void 0;
    });
  };
  const timer = setInterval(tick, diceConfig.workerMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

// src/config/private-casino.ts
var privateCasinoConfig = {
  chatUrl: "https://vk.me/join/7ScmA4KxnWkkuVlXVycmWx9SIsB751g_BQs=",
  coinMinimum: 1e3 * game.kcScale,
  coinMultipliers: [180, 360, 720, 1440, 2880, 5760, 11520],
  multiplierScale: 100,
  jackpotSeedMin: 1e3,
  jackpotSeedMax: 1e6,
  jackpotGrowthMin: 5e3,
  jackpotGrowthMax: 1e5,
  jackpotHour: 19,
  jackpotMinute: 30,
  workerMs: 1e3,
  workerBatch: 20
};

// src/services/roulette-texts.ts
function rouletteColor(number) {
  if (!validRouletteNumber(number)) throw new Error("Invalid roulette color number");
  return number === 0 ? "🟢" : rouletteConfig.red.includes(number) ? "🔴" : "⚫";
}
function rouletteTargetText(target) {
  if (validRouletteNumber(target)) return String(target);
  const group = rouletteConfig.groups.find((group2) => group2.target === target);
  if (group === void 0) throw new Error("Invalid roulette display target");
  return group.label;
}
function rouletteOutcome(number) {
  return `${number}${rouletteColor(number)}`;
}
function rouletteHistory(number) {
  return `${rouletteColor(number)} ${number}`;
}

// src/services/casino-texts.ts
var casinoTexts = {
  state: "Государство",
  directorBid: "Сделать ставку",
  directorPrompt: "💰 Введите, сколько вы хотите поставить на выборах мэра.",
  directorMinimum: "⚠ Ставку необходимо поднять минимум на 1.000 KC.",
  stale: "⚠️ Подтверждение устарело. Начните действие заново.",
  electionPending: "⏳ Подводим итоги выборов. Повторите действие после объявления результатов.",
  funds: "⚠ Недостаточно KC!",
  limit: "⚠️ Достигнут безопасный предел суммы. Ставка не принята.",
  closed: "💰 Прием ставок завершен.",
  private: "⚠️ Игры доступны только в беседах.",
  crashRange: "⛔️ Показатель должен быть больше х1, но не больше х5000!",
  crashUsage: "⛔️ Использование: краш <коэффициент> <ставка>",
  rouletteUsage: "⛔️ Использование: рулетка <число или диапазон> <ставка>",
  dreamUsage: "⛔️ Использование: дрим <сектор> <ставка>",
  winner: "👑 Поздравляем с победой на выборах! В течение этого дня вы будете получать 1% со всех ставок в играх казино в беседах.",
  creditWaiting: "⏳ Выплата сохранена. Достигнут предел баланса; выплата будет повторена автоматически."
};
function kc(value) {
  return `${formatAmount(value, game.kcScale)} KC`;
}
function modeName(mode) {
  return mode === "crash" ? "Краш" : mode === "roulette" ? "Рулетка" : "Дрим";
}
function coefficient(value) {
  return (value / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
function chance(amount, total) {
  return total === 0 ? "0" : (Number(BigInt(amount) * 10000n / BigInt(total)) / 100).toFixed(2).replace(".", ",");
}
function directorText(state, holder, personal, chat) {
  const name = holder === null ? casinoTexts.state : mention(holder);
  return chat ? `👑 Директор: ${name} (заработал: ${kc(state.earnedKC)})` : `🤴 Сейчас директор: ${name} (уже заработано: ${kc(state.earnedKC)})

⏳ Мэра выбирают каждый день в 00:00 по МСК! (Всего поставлено: ${kc(state.total)})${personal > 0 ? `

🪙 Ваша ставка: ${kc(personal)} (${chance(personal, state.total)}%)` : ""}`;
}
function directorConfirmation(amount) {
  return `💸 Вы точно хотите поставить ${kc(amount)}?`;
}
function directorSuccess(amount) {
  return `✅ Вы успешно поставили ${kc(amount)} на выборы.`;
}
function electionAnnouncement(total, participants, winner, stake) {
  return `🤴 Выборы директора закончились.

💰 Всего ставок было: ${kc(total)} (ставило: ${participants} чел.)
😎 Победил: ${winner === null ? casinoTexts.state : mention(winner)} со ставкой ${kc(stake)} (шанс: ${chance(stake, total)}%)`;
}
function electionRefund(amount) {
  return `🎰 Выборы директора закончились, вы проиграли.

💰 Возвращено: ${kc(amount)} (50% ставки на выборы директора)`;
}
function betMinimum(mode) {
  return `💰 Минимальная ставка в режиме «${modeName(mode)}» — 1.000 KC.`;
}
function betLimit(mode) {
  return `💰 Не более 10 ставок в режиме «${modeName(mode)}».`;
}
function betAccepted(player, mode, amount, target) {
  return `✅ ${mention(player)} — ${kc(amount)} на ${mode === "crash" ? `x${coefficient(target)}` : mode === "roulette" ? rouletteTargetText(target) : `сектор ${target}`}`;
}
function roundClosed(mode) {
  return `🎰 Приём ставок для игры "${modeName(mode)}" закрыт.
🕒 Итоги раунда через 5 секунд…`;
}
function outcome(round) {
  return round.mode === "roulette" ? rouletteOutcome(round.result) : round.mode === "crash" ? `x${coefficient(round.result)}` : `${round.bonus === 1 ? "" : `множитель х${round.bonus} - `}сектор №${round.result} - [x${(round.result + 1) * round.bonus}]`;
}
function roundHeading(round) {
  if (round.mode === "roulette") return `🎰 Итоги игры "Рулетка":

🎡 Выпало — ${rouletteOutcome(round.result)}`;
  return round.mode === "crash" ? `📊 Итоги игры "Краш":

📈 Краш на отметке: ${outcome(round)}` : `🎡 Итоги игры "Дрим":

🎡 Выпал сектор #${round.result}${round.bonus === 1 ? "" : ` - множитель ${round.bonus}`} - [x${(round.result + 1) * round.bonus}]`;
}
function winningBet(bet, mode, payout) {
  return `✅ [id${bet.vkId}|${bet.name}] — ${kc(bet.amount)} на ${mode === "crash" ? coefficient(bet.target) : mode === "roulette" ? rouletteTargetText(bet.target) : bet.target}
— Приз: ${kc(payout)}`;
}
function roundFooter(round) {
  return `${round.winners === 0 ? "\n\n❌ Все ставки проиграли!" : ""}${round.losses > 0 ? `

💰 Проиграно: ${kc(round.losses)}` : ""}`;
}
function historyText(mode, history) {
  return `Последние 20 выпавших ${mode === "crash" ? "коэффициентов" : mode === "roulette" ? "чисел" : "секторов"}${history.length === 0 ? "\n\nПока нет завершённых раундов." : `

${history.map((item) => mode === "roulette" ? rouletteHistory(item.result) : outcome({ ...item, mode })).join("\n")}`}`;
}

// src/services/casino-credits.ts
async function addCasinoCredit(store, key, vkId, amount, destination = "wallet", notice = "") {
  if (!isPositiveId(vkId) || !safeBankMoney(amount)) throw new Error("Invalid casino credit");
  if (amount === 0) return;
  await store.casinoInsert({ _id: `credit:${key}`, kind: "credit", version: 0, vkId, amount, destination, notice, stage: "pending", dueAt: /* @__PURE__ */ new Date(0) });
}
async function payCasinoCredit(store, now) {
  const credit = (await store.casinoList({ kind: "credit", dueAt: now }, 1))[0];
  if (credit === void 0) return false;
  if (credit.kind !== "credit" || !safeBankMoney(credit.amount)) throw new Error("Invalid pending casino credit");
  let paid = false;
  if (credit.destination === "dealer" && (await store.dealer()).holderId === credit.vkId) paid = await store.casinoDealerIncome(credit.vkId, credit.amount);
  else paid = await store.updateBalance(credit.vkId, "kc", "add", credit.amount);
  if (paid) {
    credit.stage = "paid";
    if (credit.notice.length > 0) await store.enqueueItemNotification(`notice:${credit._id}`, credit.vkId, credit.notice, { kind: "none" });
  } else {
    if (credit.dueAt.getTime() === 0) await store.enqueueItemNotification(`waiting:${credit._id}`, credit.vkId, casinoTexts.creditWaiting, { kind: "none" });
    credit.dueAt = new Date(now.getTime() + casinoConfig.retryMs);
  }
  await store.casinoSave(credit);
  return true;
}

// src/services/private-casino-texts.ts
var privateCasinoTexts = {
  chats: "💬 Беседы",
  jackpot: "🎰 Джекпот",
  coin: "🪙 Монетка",
  join: "☑️ Участвовать",
  cashout: "Забрать выигрыш",
  private: "⚠️ Этот раздел доступен только в личных сообщениях.",
  active: "⚠️ У вас идёт активная игра в режиме «Монетка»!",
  firstStake: "⚠️ Сначала введите ставку!",
  noFlips: "⚠️ Вы еще не подкидывали монетку.",
  cannotChange: "⚠️ После первого броска изменить ставку нельзя.",
  stakeUsage: `⚠️ Введите ставку от ${kc(privateCasinoConfig.coinMinimum)}.`,
  already: "⚠️ Вы уже участвуете!",
  registered: "✅ Вы зарегистрированы.",
  settling: "⏳ Подводим итоги джекпота. Попробуйте немного позже.",
  intro: "🪙 Режим «Монетка».\n\n💎 Введите ставку, а затем выберите одну сторону: изумруд либо алмаз.\n\n🟢 Если вы угадаете сторону, которая выпадет на монетке — ваш выигрыш умножится! Вы можете продолжить для большего множителя или же забрать выигрыш и уйти."
};
function casinoLobbyText(player, holder, earned) {
  return `${mention(player)}, казино:

🤑 Крупье: ${holder === null ? "Государство" : mention(holder)} (заработал: ${kc(earned)})`;
}
function jackpotText(amount, participants) {
  return `🎰 Накоплено: ${kc(amount)}

💰 Участников: ${participants}`;
}
function jackpotAnnouncement(winner, amount) {
  return `🎰 ${mention(winner)} получает джекпот: ${kc(amount)}`;
}
function jackpotWinnerText(amount) {
  return `🎰 ДЖЕКПОТ! Вы стали победителем джекпота

💰 Ваш выигрыш составил ${kc(amount)}`;
}
function coinSymbol(side) {
  return side === "diamond" ? "💎" : "🟢";
}
function coinStakeText(amount) {
  return `💰 Ставка ${kc(amount)} сделана. Выбирайте монетку или измените ставку!`;
}
function coinWinText(state, multiplier, payout, balance) {
  return `✅ Вы угадали!

🪙 На монетке выпадало: ${state.history.map(coinSymbol).join("")}

💰 Множитель: x${coefficient(multiplier)} (вы получите ${kc(payout)}, если заберете сейчас!)

💸 Баланс: ${kc(balance)}`;
}
function coinLossText(balance) {
  return `❌ Вы не угадали. Вся ставка потеряна.

💸 Баланс: ${kc(balance)}`;
}
function coinPaidText(amount, payout, final) {
  return `${final ? "✅ Вы дошли до конца!" : "✅ Вы забрали выигрыш!"}

💰 Ваш чистый выигрыш составил: ${kc(payout - amount)}`;
}

// src/services/jackpot.ts
function nextJackpot(now) {
  const day = Math.floor((now.getTime() + casinoConfig.moscowOffsetMs) / casinoConfig.dayMs) * casinoConfig.dayMs;
  const at = day + (privateCasinoConfig.jackpotHour * 60 + privateCasinoConfig.jackpotMinute) * 6e4 - casinoConfig.moscowOffsetMs;
  return new Date(at > now.getTime() ? at : at + casinoConfig.dayMs);
}
function seed(dueAt, random) {
  return (privateCasinoConfig.jackpotSeedMin + random(`jackpot:seed:${dueAt.toISOString()}`, privateCasinoConfig.jackpotSeedMax - privateCasinoConfig.jackpotSeedMin + 1)) * game.kcScale;
}
async function jackpotState(store, now, random) {
  const existing = await store.casinoGet("jackpot");
  if (existing !== null) {
    if (existing.kind !== "jackpot" || !Number.isSafeInteger(existing.amount) || existing.amount < 0 || existing.amount > game.maxAmount || !Number.isSafeInteger(existing.participants) || existing.participants < 0 || existing.participants > accountCapacity) throw new Error("Invalid jackpot state");
    return existing;
  }
  const dueAt = nextJackpot(now);
  const state = { _id: "jackpot", kind: "jackpot", version: 0, roundId: dueAt.toISOString(), dueAt, amount: seed(dueAt, random), participants: 0 };
  await store.casinoInsert(state);
  return state;
}
async function jackpotAction(store, player, join, input, random) {
  const now = await store.now();
  const state = await jackpotState(store, now, random);
  const reply3 = (text) => ({ text, keyboard: { kind: "jackpot" } });
  if (!join) return reply3(jackpotText(state.amount, state.participants));
  if (state.dueAt <= now) return reply3(privateCasinoTexts.settling);
  const id = `jackpot-entry:${state.roundId}:${player._id}`;
  if (await store.casinoGet(id) !== null) return reply3(privateCasinoTexts.already);
  const growth = random(`jackpot:join:${input.eventId}:chance`, 2) === 0 ? 0 : (privateCasinoConfig.jackpotGrowthMin + random(`jackpot:join:${input.eventId}:amount`, privateCasinoConfig.jackpotGrowthMax - privateCasinoConfig.jackpotGrowthMin + 1)) * game.kcScale;
  if (state.amount > game.maxAmount - growth || state.participants >= accountCapacity) return reply3(casinoTexts.limit);
  await store.casinoInsert({ _id: id, kind: "jackpot_entry", version: 0, roundId: state.roundId, vkId: player._id });
  state.amount += growth;
  state.participants += 1;
  await store.casinoSave(state, state.dueAt);
  return reply3(privateCasinoTexts.registered);
}
async function drawJackpot(store, now, random) {
  const state = await jackpotState(store, now, random);
  if (state.dueAt > now) return false;
  const entries = await store.casinoList({ kind: "jackpot_entries", roundId: state.roundId, after: "" }, accountCapacity);
  if (entries.length !== state.participants) throw new Error("Inconsistent jackpot participants");
  if (entries.length > 0) {
    const winner = entries[random(`jackpot:winner:${state.roundId}`, entries.length)];
    if (winner?.kind !== "jackpot_entry") throw new Error("Invalid jackpot winner");
    const player = await store.player(winner.vkId);
    if (player === null) throw new Error("Missing jackpot winner");
    await addCasinoCredit(store, `jackpot:${state.roundId}`, player._id, state.amount, "wallet", jackpotWinnerText(state.amount));
    await store.casinoInsert({
      _id: `jackpot-draw:${state.roundId}`,
      kind: "jackpot_draw",
      version: 0,
      roundId: state.roundId,
      winnerId: player._id,
      announcement: jackpotAnnouncement(player, state.amount),
      stage: "broadcast",
      afterEntry: "",
      dueAt: now
    });
  }
  const dueAt = nextJackpot(now);
  state.dueAt = dueAt;
  state.roundId = dueAt.toISOString();
  state.amount = seed(dueAt, random);
  state.participants = 0;
  await store.casinoSave(state);
  return true;
}
async function broadcastJackpot(store, now) {
  const draw = (await store.casinoList({ kind: "jackpot_draw", dueAt: now }, 1))[0];
  if (draw === void 0) return false;
  if (draw.kind !== "jackpot_draw") throw new Error("Invalid jackpot announcement");
  const entries = await store.casinoList({ kind: "jackpot_entries", roundId: draw.roundId, after: draw.afterEntry }, privateCasinoConfig.workerBatch);
  for (const entry of entries) {
    if (entry.kind !== "jackpot_entry") throw new Error("Invalid jackpot recipient");
    if (entry.vkId !== draw.winnerId) await store.enqueueMailing(`jackpot-result:${draw.roundId}:${entry.vkId}`, entry.vkId, draw.announcement);
    draw.afterEntry = entry._id;
  }
  if (entries.length === 0) draw.stage = "finished";
  await store.casinoSave(draw);
  return true;
}
async function settleJackpot(database, random = casinoRandom) {
  const stable = cachedCasinoRandom(random);
  let work = 0;
  for (let index = 0; index < privateCasinoConfig.workerBatch; index += 1) {
    try {
      const progressed = await database.transaction(async (store) => {
        const now = await store.now();
        return await drawJackpot(store, now, stable) || await broadcastJackpot(store, now);
      });
      if (!progressed) break;
      work += 1;
    } catch (error) {
      if (error instanceof DuplicateWriteError) continue;
      throw error;
    }
  }
  return work;
}

// src/handlers/jackpot-worker.ts
function startJackpotWorker(database, wakeNotifications) {
  let running;
  let stopped = false;
  const tick = () => {
    if (stopped || running !== void 0) return;
    running = settleJackpot(database).then((work) => {
      if (work > 0) wakeNotifications();
    }).catch((error) => {
      logError("jackpot_worker", error);
    }).finally(() => {
      running = void 0;
    });
  };
  const timer = setInterval(tick, privateCasinoConfig.workerMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

// src/config/mailing.ts
var mailingConfig = { maxTextLength: game.maxMessageLength, batchSize: 20, intervalMs: 1e3, migrationPageSize: 100 };

// src/config/admin.ts
var adminIds = /* @__PURE__ */ new Set([888801846]);

// src/services/mailing-texts.ts
var mailingTexts = {
  usage: `⛔️ Использование: /mailing <текст>
Максимум ${mailingConfig.maxTextLength} символов.`,
  queued: "📨 Рассылка поставлена в очередь."
};

// src/services/mailing.ts
async function mailingAction(store, input, command) {
  if (!adminIds.has(input.vkId)) throw new Error("Administrator access is required");
  if (command.kind === "mailing_invalid" || command.text.trim().length === 0 || command.text.length > mailingConfig.maxTextLength) {
    return { text: mailingTexts.usage, keyboard: { kind: "none" } };
  }
  await store.createMailing({ _id: `mailing:${input.eventId}`, text: command.text, createdAt: await store.now(), afterVkId: 0, version: 0, state: "pending" });
  return { text: mailingTexts.queued, keyboard: { kind: "none" } };
}
async function queueMailingBatch(database) {
  return database.transaction(async (store) => {
    const campaign = await store.pendingMailing();
    if (campaign === null) return 0;
    const recipients = await store.mailingRecipients(campaign.afterVkId, campaign.createdAt);
    for (const vkId of recipients) {
      await store.enqueueMailing(`${campaign._id}:${vkId}`, vkId, campaign.text);
      campaign.afterVkId = vkId;
    }
    if (recipients.length === 0) campaign.state = "queued";
    await store.saveMailing(campaign);
    return recipients.length;
  });
}

// src/handlers/mailing-worker.ts
function startMailingWorker(database, wakeNotifications) {
  let running;
  let stopped = false;
  const tick = () => {
    if (stopped || running !== void 0) return;
    running = queueMailingBatch(database).then((count) => {
      if (count > 0) wakeNotifications();
    }).catch((error) => {
      logError("mailing_worker", error);
    }).finally(() => {
      running = void 0;
    });
  };
  const timer = setInterval(tick, mailingConfig.intervalMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

// src/handlers/roulette-photo-worker.ts
function startRoulettePhotoWorker(database, resolvePhoto) {
  const pending = /* @__PURE__ */ new Map();
  let after = "";
  let stopped = false;
  let scanning;
  const scan = async () => {
    const capacity = rouletteConfig.photoPrefetchConcurrency - pending.size;
    if (capacity === 0) return;
    const rounds = await database.transaction((store) => store.casinoList({ kind: "roulette_photo", after }, capacity));
    if (stopped) return;
    if (rounds.length === 0) {
      after = "";
      return;
    }
    for (const round of rounds) {
      if (round.kind !== "round" || round.mode !== "roulette") throw new Error("Invalid photo preparation round");
      after = round._id;
      if (pending.has(round.roundId)) continue;
      const task = resolvePhoto(round.peerId, round.result).then(() => void 0).catch((error) => {
        logError("roulette_photo_prefetch", error);
      }).finally(() => {
        pending.delete(round.roundId);
      });
      pending.set(round.roundId, task);
    }
  };
  const tick = () => {
    if (stopped || scanning !== void 0) return;
    scanning = scan().catch((error) => {
      logError("roulette_photo_worker", error);
    }).finally(() => {
      scanning = void 0;
    });
  };
  const timer = setInterval(tick, rouletteConfig.photoPrefetchIntervalMs);
  timer.unref();
  tick();
  return Object.assign(async () => {
    stopped = true;
    clearInterval(timer);
    await scanning;
    await Promise.all(pending.values());
  }, { wake: tick });
}

// src/repositories/mongo-message-photos.ts
import { MongoServerError as MongoServerError2 } from "mongodb";
var MongoMessagePhotos = class {
  photos;
  constructor(db) {
    this.photos = db.collection("message_photos");
  }
  async messagePhoto(key) {
    return (await this.photos.findOne({ _id: key }))?.attachment ?? null;
  }
  async saveMessagePhoto(key, attachment) {
    const result = await this.photos.updateOne({ _id: key }, { $set: { attachment } }, { upsert: true }).catch(async (error) => {
      if (!(error instanceof MongoServerError2) || error.code !== 11e3) throw error;
      return this.photos.updateOne({ _id: key }, { $set: { attachment } });
    });
    if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new Error("Photo cache write failed");
  }
};

// src/handlers/roulette-photo-errors.ts
import { APIError as APIError2, ExecuteError } from "vk-io";
var methods = ["photos.getMessagesUploadServer", "photos.saveMessagesPhoto"];
function roulettePhotoErrorContext(error) {
  if (!(error instanceof APIError2)) return {};
  const params = error.params;
  const parameter = Array.isArray(params) ? params.find((entry) => isRecord(entry) && entry.key === "method") : void 0;
  const requested = error instanceof ExecuteError ? error.method : isRecord(parameter) ? parameter.value : void 0;
  const method = methods.find((value) => value === requested) ?? "unknown";
  const parameterHint = error.code === 100 ? /\b(peer_id|photo|server|hash)\b/i.exec(error.message)?.[1]?.toLowerCase() : void 0;
  return { method, ...parameterHint === void 0 ? {} : { parameterHint } };
}

// src/handlers/roulette-photos.ts
function isMessagePhotoAttachment(value) {
  return /^photo-?\d+_\d+(?:_[A-Za-z0-9_-]+)?$/.test(value);
}
async function downloadRoulettePhoto(url, fetcher = fetch) {
  if (!roulettePhotos.includes(url)) throw new Error("Unconfigured roulette photo URL");
  const response = await fetcher(url, { signal: AbortSignal.timeout(rouletteConfig.photoTimeoutMs), redirect: "error" });
  const length = response.headers.get("content-length");
  if (!response.ok || response.body === null || length !== null && (!/^\d+$/.test(length) || Number(length) > rouletteConfig.maxPhotoBytes)) {
    await response.body?.cancel();
    throw new Error("Invalid roulette photo response");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > rouletteConfig.maxPhotoBytes) {
        await reader.cancel();
        throw new Error("Roulette photo is too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks, size);
  if (buffer.length < 4 || buffer[0] !== 255 || buffer[1] !== 216 || buffer[2] !== 255) throw new Error("Roulette photo is not JPEG");
  return buffer;
}
function createRoulettePhotoResolver(vk, cache, groupId, download = downloadRoulettePhoto) {
  if (!isPositiveId(groupId)) throw new Error("Invalid photo community");
  const pending = /* @__PURE__ */ new Map();
  const resolve = async (peerId, result) => {
    if (!isPositiveId(peerId) || !validRouletteNumber(result)) throw new Error("Invalid roulette photo identity");
    const url = roulettePhotos[result];
    if (url === void 0) throw new Error("Missing roulette photo URL");
    const key = `${groupId}:${peerId}:${url}`;
    let stage = "cache_read";
    let photoBytes;
    let startedAt = Date.now();
    try {
      const cached = await cache.messagePhoto(key);
      if (cached !== null && isMessagePhotoAttachment(cached)) return cached;
      stage = "download";
      startedAt = Date.now();
      const value = await download(url);
      photoBytes = value.byteLength;
      stage = "vk_upload";
      startedAt = Date.now();
      const photo = await vk.upload.messagePhoto({ peer_id: peerId, source: { values: [{ value, filename: `roulette-${result}.jpg`, contentType: "image/jpeg" }], timeout: rouletteConfig.photoTimeoutMs } });
      const attachment = photo.toString();
      if (!isMessagePhotoAttachment(attachment)) throw new Error("Invalid uploaded photo attachment");
      await cache.saveMessagePhoto(key, attachment).catch((error) => {
        logError("roulette_photo_cache", error, { number: result });
      });
      return attachment;
    } catch (error) {
      logError("roulette_photo_upload", error, {
        number: result,
        stage,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        timeoutMs: rouletteConfig.photoTimeoutMs,
        ...photoBytes === void 0 ? {} : { photoBytes },
        ...stage === "vk_upload" ? roulettePhotoErrorContext(error) : {}
      });
      return null;
    }
  };
  return async (peerId, result) => {
    const key = `${peerId}:${result}`;
    const existing = pending.get(key);
    if (existing !== void 0) return existing;
    const task = resolve(peerId, result).finally(() => {
      pending.delete(key);
    });
    pending.set(key, task);
    return task;
  };
}

// src/services/director.ts
async function directorState(store, now) {
  const existing = await store.casinoGet("director");
  if (existing !== null) {
    if (existing.kind !== "director" || !safeBankMoney(existing.earnedKC) || !safeBankMoney(existing.total)) throw new Error("Invalid director state");
    return existing;
  }
  const dueAt = nextElection(now);
  const state = { _id: "director", kind: "director", version: 0, holderId: null, earnedKC: 0, dueAt, electionId: dueAt.toISOString(), total: 0, participants: 0 };
  await store.casinoInsert(state);
  return state;
}
async function directorAction(store, player, command, input) {
  const state = await directorState(store, await store.now());
  if (command.kind === "director_view") {
    if (!input.isChat) await store.setDirectorDraft(player._id, null);
    const bid = await store.casinoGet(`bid:${state.electionId}:${player._id}`);
    const holder = state.holderId === null ? null : await store.player(state.holderId);
    return { text: directorText(state, holder, bid?.kind === "bid" ? bid.amount : 0, input.isChat ?? false), keyboard: { kind: input.isChat ? "none" : "director" } };
  }
  if (input.isChat) return { text: casinoTexts.private, keyboard: { kind: "none" } };
  if (command.kind === "director_bid") {
    await store.setDirectorDraft(player._id, { step: "amount" });
    return { text: casinoTexts.directorPrompt, keyboard: { kind: "director_back" } };
  }
  const draft = player.directorDraft;
  if (draft?.step !== "confirm" || draft.token !== command.token || draft.electionId !== state.electionId) return { text: casinoTexts.stale, keyboard: { kind: "director_back" } };
  if (state.dueAt <= await store.now()) return { text: casinoTexts.electionPending, keyboard: { kind: "director_back" } };
  const old = await store.casinoGet(`bid:${state.electionId}:${player._id}`);
  if (old !== null && old.kind !== "bid") throw new Error("Invalid director bid");
  if (!safeBankMoney(draft.amount) || draft.amount < casinoConfig.minimum) throw new Error("Invalid confirmed director bid");
  if (state.total > game.maxAmount - draft.amount || (old?.amount ?? 0) > game.maxAmount - draft.amount) return { text: casinoTexts.limit, keyboard: { kind: "director_back" } };
  if (!await store.updateBalance(player._id, "kc", "take", draft.amount)) return { text: casinoTexts.funds, keyboard: { kind: "director_back" } };
  if (old === null) {
    await store.casinoInsert({ _id: `bid:${state.electionId}:${player._id}`, kind: "bid", version: 0, electionId: state.electionId, vkId: player._id, amount: draft.amount, settled: false });
    state.participants += 1;
  } else {
    old.amount += draft.amount;
    await store.casinoSave(old);
  }
  state.total += draft.amount;
  await store.casinoSave(state, state.dueAt);
  await store.setDirectorDraft(player._id, null);
  return { text: directorSuccess(draft.amount), keyboard: { kind: "main" } };
}
async function directorTextInput(store, player, input) {
  const amount = parseBankMoney(input.text ?? "", "kc");
  if (amount === null || amount < casinoConfig.minimum) return { text: casinoTexts.directorMinimum, keyboard: { kind: "director_back" } };
  if (amount > player.kc) return { text: casinoTexts.funds, keyboard: { kind: "director_back" } };
  const state = await directorState(store, await store.now());
  if (state.dueAt <= await store.now()) return { text: casinoTexts.electionPending, keyboard: { kind: "director_back" } };
  await store.setDirectorDraft(player._id, { step: "confirm", amount, token: input.eventId, electionId: state.electionId });
  return { text: directorConfirmation(amount), keyboard: { kind: "director_confirm", token: input.eventId } };
}
async function startDueElection(store, now, random) {
  const state = await directorState(store, now);
  if (state.dueAt > now) return false;
  const bids = await store.casinoList({ kind: "bid", electionId: state.electionId, settled: false }, accountCapacity);
  let remaining = state.total > 0 ? random(`election:${state.electionId}`, state.total) : 0;
  let winnerId = null;
  let winnerStake = 0;
  let sum = 0;
  for (const bid of bids) {
    if (bid.kind !== "bid") throw new Error("Invalid election participant");
    sum += bid.amount;
    if (winnerId === null && remaining < bid.amount) {
      winnerId = bid.vkId;
      winnerStake = bid.amount;
    } else if (winnerId === null) remaining -= bid.amount;
  }
  if (sum !== state.total || bids.length !== state.participants || state.total > 0 && winnerId === null) throw new Error("Inconsistent election pool");
  if (state.holderId !== null && state.earnedKC > 0) await addCasinoCredit(store, `director:${state.electionId}`, state.holderId, state.earnedKC);
  const winner = winnerId === null ? null : await store.player(winnerId);
  await store.casinoInsert({
    _id: `election:${state.electionId}`,
    kind: "election",
    version: 0,
    electionId: state.electionId,
    winnerId,
    winnerStake,
    total: state.total,
    participants: state.participants,
    announcement: electionAnnouncement(state.total, state.participants, winner, winnerStake),
    stage: "refunds",
    afterChat: "",
    dueAt: now
  });
  state.holderId = winnerId;
  state.earnedKC = 0;
  state.total = 0;
  state.participants = 0;
  state.dueAt = new Date(state.dueAt.getTime() + casinoConfig.dayMs);
  state.electionId = state.dueAt.toISOString();
  await store.casinoSave(state);
  return true;
}

// src/services/casino-worker.ts
async function savePage(store, round) {
  if (round.buffer.length === 0) return;
  if (round.buffer.length > game.maxMessageLength) throw new Error("Casino page overflow");
  await store.casinoInsert({ _id: `page:${round.roundId}:${round.pages}`, kind: "page", version: 0, roundId: round.roundId, index: round.pages, text: round.buffer });
  round.pages += 1;
  round.buffer = "";
}
async function appendResult(store, round, text) {
  if (round.buffer.length + text.length > game.maxMessageLength) await savePage(store, round);
  round.buffer += text;
}
async function progressRound(store, now) {
  const round = (await store.casinoList({ kind: "round", dueAt: now }, 1))[0];
  if (round === void 0) return false;
  if (round.kind !== "round") throw new Error("Invalid due casino round");
  switch (round.stage) {
    case "open":
      if (round.closesAt > now) throw new Error("Premature casino close");
      await store.enqueueItemNotification(closeKey(round), round.peerId, roundClosed(round.mode), { kind: "none" });
      round.stage = "closed";
      round.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
      break;
    case "closed":
      if (await store.casinoNotificationDone(closeKey(round))) {
        round.stage = "waiting";
        round.dueAt = new Date(now.getTime() + casinoConfig.resultsMs);
      } else round.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
      break;
    case "waiting":
      round.dealerId = (await store.dealer()).holderId;
      round.buffer = roundHeading(round);
      round.stage = "settling";
      round.dueAt = now;
      break;
    case "settling": {
      const bet = (await store.casinoList({ kind: "bet", roundId: round.roundId, settled: false }, 1))[0];
      if (bet === void 0) {
        await appendResult(store, round, roundFooter(round));
        await savePage(store, round);
        round.history = [...round.history, { result: round.result, bonus: round.bonus }].slice(-casinoConfig.historySize);
        round.stage = "announcing";
      } else {
        if (bet.kind !== "bet") throw new Error("Invalid round bet");
        const wins = round.mode === "crash" ? round.result >= bet.target : round.mode === "roulette" ? rouletteWins(bet.target, round.result) : round.result === bet.target;
        if (wins) {
          const payout = betPayout(round.mode, bet.amount, bet.target, round.bonus);
          if (payout === null) throw new Error("Casino payout exceeded reserved bound");
          await addCasinoCredit(store, bet._id, bet.vkId, payout);
          round.winners += 1;
          await appendResult(store, round, `

${winningBet(bet, round.mode, payout)}`);
        } else {
          round.losses += bet.amount;
          if (round.dealerId !== null) await addCasinoCredit(store, `dealer:${bet._id}`, round.dealerId, casinoPercent(bet.amount, casinoConfig.dealerPercent), "dealer");
        }
        bet.settled = true;
        await store.casinoSave(bet);
      }
      round.dueAt = now;
      break;
    }
    case "announcing": {
      const previous = round.nextPage === 0 ? closeKey(round) : `result:${round.roundId}:${round.nextPage - 1}`;
      if (await store.casinoNotificationDone(previous)) {
        if (round.nextPage >= round.pages) round.stage = "finished";
        else {
          const page = await store.casinoGet(`page:${round.roundId}:${round.nextPage}`);
          if (page?.kind !== "page") throw new Error("Missing result page");
          await store.enqueueItemNotification(`result:${round.roundId}:${round.nextPage}`, round.peerId, page.text, { kind: "none" }, round.mode === "roulette" && round.nextPage === 0 ? round.result : void 0);
          round.nextPage += 1;
        }
      }
      round.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
      break;
    }
    case "finished":
      throw new Error("Finished round selected");
  }
  await store.casinoSave(round);
  return true;
}
async function progressElection(store, now) {
  const election = (await store.casinoList({ kind: "election", dueAt: now }, 1))[0];
  if (election === void 0) return false;
  if (election.kind !== "election") throw new Error("Invalid due election");
  if (election.stage === "refunds") {
    const bid = (await store.casinoList({ kind: "bid", electionId: election.electionId, settled: false }, 1))[0];
    if (bid === void 0) election.stage = "broadcast";
    else {
      if (bid.kind !== "bid") throw new Error("Invalid refund bid");
      if (bid.vkId === election.winnerId) await store.enqueueItemNotification(`election-winner:${election.electionId}`, bid.vkId, casinoTexts.winner, { kind: "none" });
      else await addCasinoCredit(store, `election:${bid._id}`, bid.vkId, casinoPercent(bid.amount, casinoConfig.electionRefundPercent), "wallet", electionRefund(casinoPercent(bid.amount, casinoConfig.electionRefundPercent)));
      bid.settled = true;
      await store.casinoSave(bid);
    }
  } else if (election.stage === "broadcast") {
    const chats = await store.casinoList({ kind: "chat", after: election.afterChat }, casinoConfig.announcementBatch);
    for (const chat of chats) {
      if (chat.kind !== "chat") throw new Error("Invalid registered chat");
      await store.enqueueItemNotification(`election:${election.electionId}:${chat.peerId}`, chat.peerId, election.announcement, { kind: "none" });
      election.afterChat = chat._id;
    }
    if (chats.length === 0) election.stage = "finished";
  } else throw new Error("Finished election selected");
  await store.casinoSave(election);
  return true;
}
async function progressDelivery(store, now) {
  const job = (await store.casinoList({ kind: "delivery", dueAt: now }, 1))[0];
  if (job === void 0) return false;
  if (job.kind !== "delivery") throw new Error("Invalid casino delivery");
  if (job.index === 0 || await store.casinoNotificationDone(`${job._id}:${job.index - 1}`)) {
    const text = job.texts[job.index];
    if (text === void 0) job.stage = "finished";
    else {
      await store.enqueueItemNotification(`${job._id}:${job.index}`, job.peerId, text, { kind: "none" });
      job.index += 1;
    }
  }
  job.dueAt = new Date(now.getTime() + casinoConfig.workerMs);
  await store.casinoSave(job);
  return true;
}
async function settleCasino(database, random = casinoRandom) {
  let work = 0;
  const stableRandom = cachedCasinoRandom(random);
  for (let index = 0; index < casinoConfig.workerBatch; index += 1) {
    let progressed;
    try {
      progressed = await database.transaction(async (store) => {
        const now = await store.now();
        if (await startDueElection(store, now, stableRandom)) return true;
        const tasks = index % 3 === 0 ? [progressRound, payCasinoCredit, progressElection, progressDelivery] : index % 3 === 1 ? [payCasinoCredit, progressElection, progressDelivery, progressRound] : [progressElection, progressDelivery, progressRound, payCasinoCredit];
        for (const task of tasks) if (await task(store, now)) return true;
        return false;
      });
    } catch (error) {
      if (error instanceof DuplicateWriteError) continue;
      throw error;
    }
    if (!progressed) break;
    work += 1;
  }
  return work;
}

// src/handlers/casino-worker.ts
function startCasinoWorker(database, wakeNotifications) {
  let running;
  let stopped = false;
  const tick = () => {
    if (running !== void 0 || stopped) return;
    running = settleCasino(database).then((work) => {
      if (work > 0) wakeNotifications();
    }).catch((error) => {
      logError("casino_worker", error);
    }).finally(() => {
      running = void 0;
    });
  };
  const timer = setInterval(tick, casinoConfig.workerMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

// src/handlers/chat-registry.ts
async function syncChatRegistry(vk, registry, groupId, stopped = () => false) {
  let offset = 0;
  while (!stopped()) {
    const response = await vk.api.messages.getConversations({ group_id: groupId, filter: "all", count: casinoConfig.chatPageSize, offset });
    if (!isRecord(response) || !Array.isArray(response.items) || response.items.length > casinoConfig.chatPageSize || !Number.isSafeInteger(response.count) || typeof response.count !== "number" || response.count < 0) throw new Error("Invalid conversations response");
    for (const item of response.items) {
      if (!isRecord(item) || !isRecord(item.conversation)) throw new Error("Invalid conversation");
      const conversation = item.conversation;
      if (!isRecord(conversation.peer) || conversation.peer.type !== "chat") continue;
      const peerId = conversation.peer.id;
      if (typeof peerId !== "number" || !Number.isSafeInteger(peerId) || peerId <= 2e9 || peerId > Number.MAX_SAFE_INTEGER) throw new Error("Invalid conversation peer");
      const state = isRecord(conversation.chat_settings) ? conversation.chat_settings.state : void 0;
      const writable = isRecord(conversation.can_write) ? conversation.can_write.allowed : void 0;
      await registry.recordChat(peerId, state !== "left" && state !== "kicked" && writable !== false && writable !== 0);
    }
    offset += response.items.length;
    if (response.items.length === 0 || offset >= response.count) return;
  }
}
function startChatRegistry(vk, registry, groupId) {
  let stopped = false;
  let running;
  const tick = () => {
    if (stopped || running !== void 0) return;
    running = syncChatRegistry(vk, registry, groupId, () => stopped).catch((error) => {
      logError("chat_registry", error);
    }).finally(() => {
      running = void 0;
    });
  };
  const timer = setInterval(tick, casinoConfig.chatSyncMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
async function handleRegisteredMessage(context, groupId, registry, handle) {
  const [handled] = await Promise.allSettled([
    handle(context),
    context.isChat ? registry.recordChat(context.peerId, !(context.eventType === "chat_kick_user" && context.eventMemberId === -groupId)).catch((error) => {
      logError("chat_registry", error);
    }) : Promise.resolve()
  ]);
  if (handled.status === "rejected") {
    const error = handled.reason;
    throw error;
  }
}

// src/services/bank-texts.ts
var bankLabels = {
  director: "👑 Директор",
  bank: "🏦 Банк",
  casino: "🎰 Казино",
  savings: "💲 Накопительный счет",
  pension: "👵 Пенсия",
  transfer: "💳 Перевод",
  deposits: "🏧 Депозит",
  add: "💳 Пополнить",
  withdraw: "💰 Снять",
  create: "➕ Создать депозит",
  early: "Снять досрочно",
  confirm: "Подтвердить",
  back: "Назад"
};
var bankTexts = {
  city: "🏙️ Город:",
  bank: "🏛️ Банк:",
  transfer: "💸 Выберите желаемую валюту для отправки.",
  target: "👤 Введите ссылку на игрока.\n💡 Например @kreox_owner",
  missing: "⚠️ Игрок не найден или ещё не зарегистрирован в боте.",
  self: "⚠️ Нельзя переводить деньги самому себе.",
  usage: "⚠️ Формат: монеты / евро / донат / бит / биткоин <игрок> <сумма>. Вместо игрока можно ответить на его сообщение.",
  invalid: "⚠️ Введите положительную сумму. Можно использовать к и кк.",
  funds: "⚠ Недостаточно KC!",
  fundsCurrency: "⚠️ Недостаточно средств!",
  limit: "⚠️ Достигнут предел баланса. Операция не выполнена.",
  young: "🍼 Ты ещё слишком мал для пенсии!",
  private: "⚠️ Откройте город и банк в личных сообщениях бота.",
  deposits: "🏧 Меню депозитов:",
  depositAmount: "💡 Введите сумму депозита.\n\n3 дня — +2%\n10 дней — +4%",
  depositMax: "⚠️ Максимальный депозит 10.000.000 KC",
  depositLimit: "⚠️ Можно открыть не более 5 депозитов.",
  depositTerm: "🗓 Теперь укажите количество дней.",
  unavailable: "⚠️ Депозит недоступен или уже закрыт.",
  ended: "🏧 Срок депозита истёк. Средства возвращаются автоматически.",
  stale: "⚠️ Подтверждение устарело. Начните действие заново.",
  cancelled: "Действие отменено."
};
function bankMoney(amount, currency) {
  return currency === "kc" ? `${formatAmount(amount, game.kcScale)} KC` : currency === "euro" ? `${formatAmount(amount, game.euroScale)}💶` : `${formatMining(amount)}₿`;
}
function savingsText(amount) {
  return `💲 Накопительный счет:

💰 У вас: ${formatAmount(amount, game.kcScale)} KC`;
}
function savingsPrompt(player, savings2, direction) {
  return direction === "in" ? `💰 Введите количество денег, которое вы хотите положить (у вас: ${formatAmount(player.kc, game.kcScale)} KC).` : `💰 Введите количество денег, которое вы хотите снять (на счету: ${formatAmount(savings2, game.kcScale)} KC).`;
}
function savingsResult(wallet, savings2) {
  return `💱 Транзакция совершена.

💰 На руках: ${formatAmount(wallet, game.kcScale)} KC
💳 На счету: ${formatAmount(savings2, game.kcScale)} KC`;
}
function transferPrompt(player, receiver, currency) {
  const name = currency === "kc" ? "KC" : currency === "euro" ? "евро" : "биткоинов";
  const balance = currency === "euro" ? `${formatAmount(player.euro, game.euroScale)} 💶` : bankMoney(player[currency], currency);
  return `💡 Теперь введите количество ${name}, сколько вы хотите передать игроку ${mention(receiver)} (у вас: ${balance})`;
}
function depositDate(date) {
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone: bankConfig.timeZone, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type) => parts.find((part2) => part2.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")} ${part("hour")}:${part("minute")}:${part("second")}`;
}
function depositText(deposit, now) {
  return `💳 Ваш депозит:

🆔 ID: ${deposit.depositId}
💰 Вложено: ${bankMoney(deposit.amount, "kc")} (сейчас: ${bankMoney(depositValue(deposit, now), "kc")})
⌛️ Создан: ${depositDate(deposit.createdAt)}
⏳ Депозит открыт до ${depositDate(deposit.expiresAt)} (+${bankConfig.depositRates[deposit.days]}% за ${deposit.days} дня)`;
}
function depositEndText(deposit, payout) {
  return `🏧 Ваш депозит ID: ${deposit.depositId} был окончен.

Баланс до: ${bankMoney(deposit.amount, "kc")}
Баланс после: ${bankMoney(payout, "kc")}
Процент: ${bankConfig.depositRates[deposit.days]}%
💰 Вы заработали ${bankMoney(payout - deposit.amount, "kc")}`;
}
function transferReceivedText(sender, net, currency) {
  return `${mention(sender)} передал вам ${bankMoney(net, currency)}`;
}
function transferSuccessText(receiver, net, currency, isChat) {
  return `${isChat ? "" : "✅ "}Вы успешно передали ${bankMoney(net, currency)} игроку ${mention(receiver)}.`;
}
function pensionWaitText(remaining) {
  return `⏳ Подождите ${durationText(remaining)} до следующей пенсии.`;
}
function pensionSuccessText(amount) {
  return `✅ Ваша пенсия составила ${bankMoney(amount, "kc")}`;
}
function depositEarlyPrompt(deposit, payout) {
  return `💳 Вы точно хотите снять депозит с ID: ${deposit.depositId}? Вы получите ${bankMoney(payout, "kc")} (-10% за досрочное снятие депозита).`;
}
function depositEarlySuccessText(deposit, payout, wallet) {
  return `✅ Вы сняли депозит с ID: ${deposit.depositId} и получили ${bankMoney(payout, "kc")} (-10% за досрочное снятие депозита)

💸 Баланс: ${bankMoney(wallet, "kc")}`;
}

// src/services/bank-deposits.ts
async function finishDeposit(store, deposit, now) {
  if (deposit.expiresAt > now) return false;
  const player = await store.player(deposit.vkId);
  if (player === null) {
    await store.deferDeposit(deposit, now);
    return false;
  }
  const payout = depositValue(deposit, deposit.expiresAt);
  if (!await store.closeDeposit(player, deposit, payout, now, false)) {
    await store.deferDeposit(deposit, now);
    return false;
  }
  await store.enqueueItemNotification(`deposit:${deposit._id}`, player._id, depositEndText(deposit, payout), { kind: "none" });
  return true;
}
async function settleBankDeposits(database) {
  let completed = 0;
  for (let index = 0; index < bankConfig.workerBatch; index += 1) {
    const result = await database.transaction(async (store) => {
      const now = await store.now();
      const deposit = await store.nextDueDeposit(now);
      if (deposit === null) return "empty";
      return await finishDeposit(store, deposit, now) ? "completed" : "deferred";
    });
    if (result === "empty") break;
    if (result === "completed") completed += 1;
  }
  return completed;
}

// src/handlers/bank-worker.ts
function startBankWorker(database, wakeNotifications) {
  let running;
  let stopped = false;
  const tick = () => {
    if (running !== void 0 || stopped) return;
    running = settleBankDeposits(database).then((work) => {
      if (work > 0) wakeNotifications?.();
    }).catch((error) => {
      logError("bank_deposits", error);
    }).finally(() => {
      running = void 0;
    });
  };
  const timer = setInterval(tick, bankConfig.workerIntervalMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

// src/handlers/item-targets.ts
import { APIError as APIError3 } from "vk-io";
function createItemTargetResolver(vk) {
  return async (screenName) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/.test(screenName)) {
      return null;
    }
    try {
      const users = await vk.api.users.get({ user_ids: [screenName] });
      const user = users[0];
      return user !== void 0 && isPositiveId(user.id) ? user.id : null;
    } catch (error) {
      if (error instanceof APIError3 && error.code === 113) {
        return null;
      }
      throw error;
    }
  };
}

// src/main.ts
import { MongoClient as MongoClient2 } from "mongodb";
import { VK } from "vk-io";

// src/config/env.ts
function readEnvironment(env) {
  const vkToken = env.VK_TOKEN?.trim();
  const group = env.VK_GROUP_ID?.trim();
  const mongoUri = env.MONGODB_URI?.trim();
  const mongoDb = env.MONGODB_DB?.trim();
  if (!vkToken || !/^[A-Za-z0-9._-]+$/.test(vkToken)) {
    throw new Error("Invalid VK_TOKEN");
  }
  const vkGroupId = Number(group);
  if (!group || !/^\d+$/.test(group) || !Number.isSafeInteger(vkGroupId) || vkGroupId <= 0) {
    throw new Error("Invalid VK_GROUP_ID");
  }
  if (!mongoUri || !/^mongodb(?:\+srv)?:\/\/\S+$/.test(mongoUri)) {
    throw new Error("Invalid MONGODB_URI");
  }
  if (!mongoDb || !/^[A-Za-z0-9_-]{1,63}$/.test(mongoDb)) {
    throw new Error("Invalid MONGODB_DB");
  }
  return { vkToken, vkGroupId, mongoUri, mongoDb };
}

// src/config/vk.ts
var vkApiOptions = {
  apiMode: "parallel_selected",
  apiExecuteMethods: ["messages.send"],
  apiExecuteCount: 25,
  apiLimit: 20,
  apiRequestMode: "sequential",
  apiRetryLimit: 2,
  apiWait: 1e3,
  apiTimeout: 1e4
};

// src/services/item-rules.ts
function isItemKind(value) {
  return value === "zhdun_case" || value === "referral_case" || value === "croupier";
}
function isAdminItemCommand(command) {
  return command.kind === "admin_item" || command.kind === "admin_itemlist" || command.kind === "admin_item_invalid";
}
function isItemCommand(command) {
  switch (command.kind) {
    case "item_detail":
    case "item_use":
    case "item_custom":
    case "item_gift":
    case "item_sell":
    case "item_open":
    case "item_confirm":
    case "item_open_confirm":
    case "item_buy":
      return true;
    default:
      return false;
  }
}
function validItemQuantity(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= itemConfig.maxBatch;
}
function parsePlayerTarget(text) {
  const value = text.trim();
  if (/^\d{1,16}$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id >= 0 ? { kind: "number", id } : null;
  }
  const match = /^(?:@?id(\d{1,16})|\[id(\d{1,16})\|[^\]\r\n]{1,100}\])$/i.exec(value);
  if (match !== null) {
    const id = Number(match[1] ?? match[2]);
    return isPositiveId(id) ? { kind: "vk", id } : null;
  }
  const screen = /^(?:@|https:\/\/(?:www\.)?vk\.com\/)([a-zA-Z][a-zA-Z0-9_.]{0,63})\/?$/.exec(value)?.[1];
  return screen === void 0 ? null : { kind: "screen", name: screen };
}
function parseItemPrice(text) {
  const match = /^(\d{1,16})([kк]{1,2})?$/i.exec(text.trim());
  const whole = match?.[1];
  if (whole === void 0) {
    return null;
  }
  const suffix = match?.[2]?.length ?? 0;
  const amount = BigInt(whole) * 1000n ** BigInt(suffix) * BigInt(game.kcScale);
  return amount <= BigInt(game.maxAmount) ? Number(amount) : null;
}
function caseRewards(quantity, roll) {
  if (!validItemQuantity(quantity)) {
    throw new Error("Invalid case quantity");
  }
  const result = { kc: 0, euro: 0, counts: itemConfig.drops.map(() => 0) };
  for (let i = 0; i < quantity; i += 1) {
    const value = roll();
    if (!Number.isSafeInteger(value) || value < 0 || value >= 100) {
      throw new Error("Invalid case roll");
    }
    let edge = 0;
    for (const [index, drop] of itemConfig.drops.entries()) {
      edge += drop.weight;
      if (value < edge) {
        result[drop.currency] += drop.amount;
        result.counts[index] = (result.counts[index] ?? 0) + 1;
        break;
      }
    }
  }
  return result;
}
function validateOffer(offer) {
  if (!offer._id || offer._id.length > 200 || !isPositiveId(offer.sellerId) || !isPositiveId(offer.buyerId) || offer.sellerId === offer.buyerId || !isItemKind(offer.itemKind) || !validItemQuantity(offer.quantity) || !Number.isSafeInteger(offer.price) || offer.price < 0 || offer.price > game.maxAmount || !(offer.expiresAt instanceof Date) || !Number.isFinite(offer.expiresAt.getTime()) || !["pending", "completed", "expired"].includes(offer.state)) {
    throw new Error("Invalid item offer");
  }
}

// src/services/giveaway-rules.ts
function isGiveawayCommand(command) {
  return command.kind === "force_invalid" || command.kind === "force_giveaway" || command.kind === "giveaway_claim" || command.kind === "giveaway_cancel";
}
function isGiveawayAdminCommand(command) {
  return command.kind === "force_invalid" || command.kind === "force_giveaway" || command.kind === "giveaway_cancel";
}
function giveawayKey(peerId) {
  return `giveaway:${peerId}`;
}
function giveawayClaimKey(peerId, token, vkId) {
  return `giveaway-claim:${peerId}:${token}:${vkId}`;
}
function validGiveawayCount(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= game.maxAmount;
}
function validGiveawayReward(reward) {
  return reward.kind === "currency" ? isBalanceCurrency(reward.currency) && validGiveawayCount(reward.amount) : reward.kind === "item" && isItemKind(reward.itemKind) && validItemQuantity(reward.quantity);
}
function validGiveawayPeer(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 2e9;
}
function validGiveawayToken(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validateGiveaway(state) {
  if (!validGiveawayPeer(state.peerId) || state._id !== giveawayKey(state.peerId) || !validGiveawayToken(state.token) || !validGiveawayCount(state.count) || !Number.isSafeInteger(state.remaining) || state.remaining < 0 || state.remaining > state.count || !validGiveawayReward(state.reward) || state.stage === "active" && state.remaining === 0 || state.stage === "finished" && state.remaining !== 0 || state.stage !== "active" && state.stage !== "finished" && state.stage !== "cancelled") throw new Error("Invalid giveaway state");
}

// src/config/donate.ts
var donateConfig = {
  nicknameCost: 50 * game.euroScale,
  nicknameMin: 4,
  nicknameMax: 20,
  subscriptionCost: 200 * game.euroScale,
  subscriptionMs: 30 * 24 * 60 * 60 * 1e3,
  theftCooldownMs: 60 * 60 * 1e3,
  dealerCost: 15 * game.euroScale,
  dealerCooldownMs: 15 * 60 * 1e3,
  maxChatMembers: 1e4,
  chatPageSize: 1e3,
  timeZone: "Europe/Moscow"
};

// src/handlers/chat-members.ts
async function loadChatMembers(vk, peerId, groupId) {
  const ids = /* @__PURE__ */ new Set();
  let offset = 0;
  let total;
  const pages = Math.ceil(donateConfig.maxChatMembers / donateConfig.chatPageSize);
  for (let page = 0; page < pages; page += 1) {
    const response = await vk.api.messages.getConversationMembers({ peer_id: peerId, group_id: groupId, count: donateConfig.chatPageSize, offset });
    if (!Number.isSafeInteger(response.count) || response.count < 0 || response.count > donateConfig.maxChatMembers || total !== void 0 && response.count !== total || response.items.length > donateConfig.chatPageSize) throw new Error("Invalid chat membership response");
    total = response.count;
    for (const member of response.items) {
      if (!Number.isSafeInteger(member.member_id) || member.member_id === 0) throw new Error("Invalid chat member");
      if (isPositiveId(member.member_id)) ids.add(member.member_id);
    }
    offset += response.items.length;
    if (offset >= total) return [...ids];
    if (response.items.length === 0) throw new Error("Incomplete chat membership response");
  }
  throw new Error("Chat membership limit exceeded");
}

// src/handlers/messages.ts
import { randomInt } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { ExecuteError as ExecuteError2 } from "vk-io";

// src/handlers/giveaway.ts
function parseForce(text) {
  if (text === void 0 || !/^\/force(?=\s|$)/iu.test(text.trimStart())) return null;
  const invalid = { kind: "force_invalid" };
  if (text.length > game.maxMessageLength) return invalid;
  const parts = text.trim().toLowerCase().split(/\s+/u);
  if (parts[1] !== "раздача" || parts.length < 5) return invalid;
  const countText = parts.at(-2) ?? "";
  const amountText = parts.at(-1) ?? "";
  const count = /^\d{1,16}$/.test(countText) ? Number(countText) : 0;
  if (!validGiveawayCount(count)) return invalid;
  const name = parts.slice(2, -2).join(" ");
  const currency = name === "монеты" ? "kc" : name === "евро" ? "euro" : name === "биткоин" ? "bitcoin" : null;
  let reward;
  if (currency !== null) {
    const amount = parseBankMoney(amountText, currency);
    if (amount === null) return invalid;
    reward = { kind: "currency", currency, amount };
  } else {
    const itemKind = name === "кейс реферальный" ? "referral_case" : name === "кейс ждун" ? "zhdun_case" : name === "крупье" || name === "крупьер" ? "croupier" : null;
    if (itemKind === null || !/^\d{1,4}$/.test(amountText)) return invalid;
    reward = { kind: "item", itemKind, quantity: Number(amountText) };
  }
  return validGiveawayReward(reward) ? { kind: "force_giveaway", count, reward } : invalid;
}
function parseGiveawayPayload(value) {
  if (!isRecord(value) || value.command !== "giveaway_claim" && value.command !== "giveaway_cancel" || typeof value.peerId !== "number" || !validGiveawayPeer(value.peerId) || !validGiveawayToken(value.token)) return null;
  return { kind: value.command, peerId: value.peerId, token: value.token };
}

// src/handlers/dice.ts
function parseDiceText(text, isChat) {
  if (!isChat || text === void 0 || text.length > game.maxMessageLength || !/^кости(?:\s|$)/iu.test(text.trim())) return null;
  const parts = text.trim().toLowerCase().split(/\s+/u).slice(1);
  if (parts.length === 0) return { kind: "dice_list" };
  let currency = "kc";
  if (parts[0] === "донат" || parts[0] === "евро") {
    currency = "euro";
    parts.shift();
  } else if (parts[0] === "бит" || parts[0] === "биткоин") {
    currency = "bitcoin";
    parts.shift();
  }
  const stake = parts[0] ?? "";
  const amount = stake === "пол" ? "half" : stake === "все" || stake === "всё" || stake === "вб" ? "all" : parseBankMoney(stake, currency);
  const slotsText = parts[1] ?? String(diceConfig.minPlayers);
  const slots = /^\d$/.test(slotsText) ? Number(slotsText) : 0;
  if (parts.length > 2 || amount === null || slots < diceConfig.minPlayers || slots > diceConfig.maxPlayers) {
    return { kind: "dice_invalid", currency, minimum: amount === null && /^(?:0+(?:[.,]0+)?)$/.test(parts[0] ?? "") };
  }
  if (typeof amount === "number" && amount < diceMinimum(currency)) return { kind: "dice_invalid", currency, minimum: true };
  return { kind: "dice_create", currency, amount, slots };
}
function parseDicePayload(value) {
  if (!isRecord(value) || value.command !== "dice_join" && value.command !== "dice_leave") return null;
  if (typeof value.peerId !== "number" || !Number.isSafeInteger(value.peerId) || value.peerId <= 2e9 || typeof value.gameId !== "number" || !Number.isSafeInteger(value.gameId) || value.gameId < 1) return null;
  return { kind: value.command, peerId: value.peerId, gameId: value.gameId };
}

// src/handlers/private-casino.ts
function parsePrivateCasinoPayload(value) {
  if (!isRecord(value)) return null;
  if (value.command === "casino" || value.command === "casino_chats" || value.command === "jackpot" || value.command === "jackpot_join" || value.command === "coin") return { kind: value.command };
  if (typeof value.token !== "string" || value.token.length === 0 || value.token.length > 200 || typeof value.step !== "number" || !Number.isSafeInteger(value.step) || value.step < 0 || value.step > privateCasinoConfig.coinMultipliers.length) return null;
  if (value.command === "coin_cashout") return { kind: "coin_cashout", token: value.token, step: value.step };
  if (value.command === "coin_flip" && (value.side === "diamond" || value.side === "emerald")) return { kind: "coin_flip", side: value.side, token: value.token, step: value.step };
  return null;
}

// src/handlers/mailing.ts
function parseMailing(text) {
  if (text === void 0 || !/^\/mailing(?=\s|$)/iu.test(text.trimStart())) return null;
  const body = text.trimStart().slice("/mailing".length).trim();
  return body.length === 0 || body.length > mailingConfig.maxTextLength ? { kind: "mailing_invalid" } : { kind: "mailing", text: body };
}

// src/handlers/casino.ts
function isRouletteShorthand(text) {
  const target = /^(\S+)\s+\S/u.exec(text.trim())?.[1];
  return target !== void 0 && parseRouletteTarget(target) !== null;
}
function parseLine(text) {
  const line = isRouletteShorthand(text) ? `рулетка ${text.trim()}` : text.trim();
  const parts = /^(краш|дрим|рулетка)\s+(\S+)\s+(\S+)$/iu.exec(line);
  const mode = /^краш(?=\s|$)/iu.test(line) ? "crash" : /^рулетка(?=\s|$)/iu.test(line) ? "roulette" : "dream";
  const usage = mode === "crash" ? casinoTexts.crashUsage : mode === "roulette" ? casinoTexts.rouletteUsage : casinoTexts.dreamUsage;
  if (parts?.[2] === void 0 || parts[3] === void 0) return { error: usage };
  const amount = parseCasinoStake(parts[3]);
  if (mode === "roulette") {
    const target2 = parseRouletteTarget(parts[2]);
    if (target2 === null || amount === null) return { error: usage };
    return typeof amount === "number" && amount < casinoConfig.minimum ? { error: betMinimum(mode) } : { mode, amount, target: target2 };
  }
  if (mode === "crash") {
    if (!/^\d{1,4}(?:[.,]\d{1,2})?$/.test(parts[2])) return { error: casinoTexts.crashRange };
    const [whole = "", fraction = ""] = parts[2].replace(",", ".").split(".");
    const target2 = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (target2 <= 100 || target2 > casinoConfig.maxCrash) return { error: casinoTexts.crashRange };
    if (amount === null) return { error: casinoTexts.crashUsage };
    if (typeof amount === "number" && amount < casinoConfig.minimum) return { error: betMinimum(mode) };
    return { mode, amount, target: target2 };
  }
  const target = Number(parts[2]);
  if (!/^\d+$/.test(parts[2]) || !casinoConfig.sectors.some((sector) => sector === target) || amount === null) return { error: casinoTexts.dreamUsage };
  return typeof amount === "number" && amount < casinoConfig.minimum ? { error: betMinimum(mode) } : { mode, amount, target };
}
function parseCasinoText(text, isChat) {
  if (!isChat || text === void 0) return null;
  if (text.length > game.maxMessageLength) return null;
  const normalized = text.trim().toLowerCase();
  if (normalized === "директор") return { kind: "director_view" };
  if (normalized === "лог краш" || normalized === "лог дрим" || normalized === "лог рулетка") return { kind: "casino_log", mode: normalized === "лог краш" ? "crash" : normalized === "лог рулетка" ? "roulette" : "dream" };
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0 || !lines.some((line) => /^(краш|дрим|рулетка)(?=\s|$)/iu.test(line.trim()) || isRouletteShorthand(line))) return null;
  return { kind: "casino_bets", lines: lines.map(parseLine) };
}
function parseDirectorPayload(value) {
  if (!isRecord(value)) return null;
  if (value.command === "city_director" || value.command === "director_view" || value.command === "director_bid") return { kind: value.command };
  if (value.command === "director_confirm" && typeof value.token === "string" && value.token.length > 0 && value.token.length <= 200) return { kind: "director_confirm", token: value.token };
  return null;
}
function parseChatRanking(text, isChat) {
  if (!isChat) return null;
  const value = text?.trim().toLowerCase().replace(/\s+/gu, " ");
  switch (value) {
    case "топ":
      return "kc";
    case "топ бит":
    case "топ биткоин":
      return "bitcoin";
    case "топ вор":
    case "топ воров":
      return "stolenKC";
    case "топ реп":
      return "reputation";
    case "топ донат":
    case "топ евро":
      return "euro";
    case "топ реф":
    case "топ рефералы":
      return "referrals";
    case "топ майнинг":
      return "mining";
    default:
      return null;
  }
}

// src/handlers/bank.ts
function parseBankTransfer(text) {
  const value = text?.trim() ?? "";
  const command = /^(монеты|донат|евро|бит|биткоин)(?=\s|$)/i.exec(value)?.[1]?.toLowerCase();
  if (command === void 0) return null;
  if (value.length > 256) return { kind: "bank_transfer_invalid" };
  const match = /^(?:монеты|донат|евро|бит|биткоин)\s+(?:(.+)\s+)?(\S+)$/i.exec(value);
  const currency = command === "монеты" ? "kc" : command === "донат" || command === "евро" ? "euro" : "bitcoin";
  const amount = match?.[2] === void 0 ? null : parseBankMoney(match[2], currency);
  const target = match?.[1] === void 0 ? null : parsePlayerTarget(match[1]);
  if (amount === null || match?.[1] !== void 0 && target === null) return { kind: "bank_transfer_invalid" };
  return { kind: "bank_transfer", currency, target, amount };
}
function parseBankPayload(value) {
  if (!isRecord(value)) return null;
  switch (value.command) {
    case "city":
    case "bank":
    case "bank_savings":
    case "bank_deposit_money":
    case "bank_withdraw_money":
    case "bank_transfer_menu":
    case "bank_deposits":
    case "bank_deposit_create":
    case "bank_pension":
      return { kind: value.command };
    case "bank_currency":
      return isBalanceCurrency(value.currency) ? { kind: "bank_currency", currency: value.currency } : null;
    case "bank_deposit_amount":
      return typeof value.amount === "number" && safeBankMoney(value.amount) ? { kind: "bank_deposit_amount", amount: value.amount } : null;
    case "bank_deposit":
    case "bank_deposit_early":
      return typeof value.depositId === "number" && isPositiveId(value.depositId) ? { kind: value.command, depositId: value.depositId } : null;
    case "bank_deposit_term":
      if (isDepositDays(value.days) && typeof value.token === "string" && value.token.length > 0 && value.token.length <= 200) return { kind: "bank_deposit_term", days: value.days, token: value.token };
      return null;
    case "bank_deposit_confirm":
      return typeof value.token === "string" && value.token.length > 0 && value.token.length <= 200 ? { kind: "bank_deposit_confirm", token: value.token } : null;
    default:
      return null;
  }
}

// src/handlers/items.ts
function parseAdminItems(text) {
  const value = text?.trim() ?? "";
  if (/^!itemlist$/i.test(value)) {
    return { kind: "admin_itemlist" };
  }
  if (!/^!(?:giveitem|takeitem|itemlist)(?=\s|$)/i.test(value)) {
    return null;
  }
  const match = value.length <= 256 ? /^!(giveitem|takeitem)\s+(\d{1,16}|@?id\d{1,16}|\[id\d{1,16}\|[^\]\r\n]{1,100}\])\s+([123])(?:\s+(\d{1,4}))?$/i.exec(value) : null;
  const target = match?.[2] === void 0 ? null : parsePlayerTarget(match[2]);
  if (match === null || target === null || target.kind === "screen") {
    return { kind: "admin_item_invalid" };
  }
  const operation = match[1]?.toLowerCase() === "giveitem" ? "give" : "take";
  const quantity = match[4] === void 0 ? 1 : Number(match[4]);
  if (!validItemQuantity(quantity) || operation === "take" && match[4] !== void 0) {
    return { kind: "admin_item_invalid" };
  }
  return { kind: "admin_item", operation, target, catalogId: Number(match[3]), quantity };
}
function parseItemPayload(value) {
  if (!isRecord(value)) {
    return null;
  }
  if (isItemKind(value.itemKind)) {
    switch (value.command) {
      case "item_detail":
      case "item_use":
      case "item_custom":
      case "item_gift":
      case "item_sell":
        return { kind: value.command, itemKind: value.itemKind };
      case "item_open":
        if (value.quantity === 1 || value.quantity === 5 || value.quantity === 10) {
          return { kind: "item_open", itemKind: value.itemKind, quantity: value.quantity };
        }
    }
  }
  if ((value.command === "item_confirm" || value.command === "item_open_confirm") && typeof value.token === "string" && value.token.length > 0 && value.token.length <= 200) {
    return { kind: value.command, token: value.token };
  }
  if (value.command === "item_buy" && typeof value.offerId === "string" && value.offerId.length > 0 && value.offerId.length <= 200) {
    return { kind: "item_buy", offerId: value.offerId };
  }
  return null;
}

// src/handlers/admin-balance.ts
function parseAdminBalance(text) {
  const normalized = text?.trim() ?? "";
  const wallet = /^!(set|add|take)(donut|bit)(?=\s|$)/i.exec(normalized);
  if (wallet !== null) return parseWalletBalance(normalized, wallet[2]?.toLowerCase() === "donut" ? "euro" : "bitcoin");
  if (!/^!(?:set|add)(?=\s|$)/i.test(normalized)) {
    return null;
  }
  const invalid = { kind: "admin_balance_invalid" };
  if (normalized.length > 256) {
    return invalid;
  }
  const match = /^!(set|add)\s+(?:(?:@id(\d{1,16})|\[id(\d{1,16})\|[^\]\r\n]{1,100}\])\s+)?(\d{1,16})([kк]{1,2})?$/i.exec(normalized);
  if (match === null) {
    return invalid;
  }
  const operation = match[1]?.toLowerCase();
  const whole = match[4];
  if (operation !== "set" && operation !== "add" || whole === void 0) {
    return invalid;
  }
  const rawTarget = match[2] ?? match[3];
  const targetId = rawTarget === void 0 ? null : Number(rawTarget);
  if (targetId !== null && !isPositiveId(targetId)) {
    return invalid;
  }
  const amount = BigInt(whole) * 1000n ** BigInt(match[5]?.length ?? 0) * BigInt(game.kcScale);
  return amount <= BigInt(game.maxAmount) ? { kind: "admin_balance", operation, targetId, amount: Number(amount) } : invalid;
}
function parseWalletBalance(text, currency) {
  const invalid = { kind: "admin_balance_invalid", currency };
  if (text.length > 256) return invalid;
  const match = /^!(set|add|take)(?:donut|bit)\s+(?:(\d{1,16}|@?id\d{1,16}|\[id\d{1,16}\|[^\]\r\n]{1,100}\])\s+)?(\d{1,16})(?:[.,](\d{1,3}))?([kк])?$/i.exec(text);
  const operation = match?.[1]?.toLowerCase();
  const whole = match?.[3];
  if (operation !== "set" && operation !== "add" && operation !== "take" || whole === void 0) return invalid;
  const rawTarget = match?.[2];
  const targetMatch = rawTarget === void 0 ? void 0 : /^(?:@?id(\d+)|\[id(\d+)\|[^\]]+\]|(\d+))$/i.exec(rawTarget);
  const targetId = rawTarget === void 0 ? null : Number(targetMatch?.[1] ?? targetMatch?.[2] ?? targetMatch?.[3]);
  if (targetId !== null && !isPositiveId(targetId)) return invalid;
  const digits = currency === "euro" ? 2 : 8;
  const maxDecimals = currency === "euro" ? 2 : 3;
  const fraction = match?.[4] ?? "";
  if (fraction.length > maxDecimals) return invalid;
  const scale = currency === "euro" ? game.euroScale : game.bitcoinScale;
  const amount = (BigInt(whole) * BigInt(scale) + BigInt(fraction.padEnd(digits, "0"))) * (match?.[5] === void 0 ? 1n : 1000n);
  return amount <= BigInt(game.maxAmount) ? { kind: "admin_balance", operation, targetId, amount: Number(amount), currency } : invalid;
}

// src/services/rankings.ts
var rankingFields = {
  kc: "kc",
  bitcoin: "bitcoin",
  mining: "mining.rate",
  euro: "euro",
  referrals: "referrals",
  reputation: "reputation",
  stolenKC: "stolenKC"
};
function rankingScore(player, metric) {
  switch (metric) {
    case "mining":
      return player.mining?.rate ?? game.mining.initialRate;
    case "kc":
      return player.kc ?? 0;
    case "bitcoin":
      return player.bitcoin ?? 0;
    case "euro":
      return player.euro ?? 0;
    case "referrals":
      return player.referrals ?? 0;
    case "reputation":
      return player.reputation ?? 0;
    case "stolenKC":
      return player.stolenKC ?? 0;
    default:
      return assertNever(metric);
  }
}
function isRankingMetric(value) {
  return typeof value === "string" && Object.hasOwn(rankingFields, value);
}

// src/handlers/commands.ts
function parseCommand(text, payload, isChat = false) {
  const force = parseForce(text);
  if (force !== null) return force;
  const mailing = parseMailing(text);
  if (mailing !== null) return mailing;
  if (text?.trim() === "/dk") {
    return { kind: "delete_keyboards" };
  }
  const dice = parseDiceText(text, isChat);
  if (dice !== null) return dice;
  const casino = parseCasinoText(text, isChat);
  if (casino !== null) return casino;
  const ranking = parseChatRanking(text, isChat);
  if (ranking !== null) return { kind: "ranking", metric: ranking };
  const adminItem = parseAdminItems(text);
  if (adminItem !== null) {
    return adminItem;
  }
  const adminBalance = parseAdminBalance(text);
  if (adminBalance !== null) {
    return adminBalance;
  }
  const bankTransfer = parseBankTransfer(text);
  if (bankTransfer !== null) return bankTransfer;
  const normalizedText = text?.trim().toLowerCase();
  if (normalizedText === "купитькрупье" || normalizedText === "купить крупье") return { kind: "dealer_buy" };
  if (isChat && normalizedText === "вор") return { kind: "theft" };
  if (isChat && normalizedText === "крупье") return { kind: "dealer_view" };
  let value = payload;
  if (typeof payload === "string") {
    if (Buffer.byteLength(payload, "utf8") > 255) {
      return { kind: "development" };
    }
    try {
      value = JSON.parse(payload);
    } catch {
      return { kind: "development" };
    }
  }
  const giveaway = parseGiveawayPayload(value);
  if (giveaway !== null) return giveaway;
  const dicePayload = parseDicePayload(value);
  if (dicePayload !== null) return dicePayload;
  const privateCasino = parsePrivateCasinoPayload(value);
  if (privateCasino !== null) return privateCasino;
  const director = parseDirectorPayload(value);
  if (director !== null) return director;
  const bankCommand = parseBankPayload(value);
  if (bankCommand !== null) return bankCommand;
  const itemCommand = parseItemPayload(value);
  if (itemCommand !== null) {
    return itemCommand;
  }
  if (isRecord(value)) {
    if ((value.command === "donate_confirm" || value.command === "donate_cancel") && typeof value.token === "string" && value.token.length > 0 && value.token.length <= 200) return { kind: value.command, token: value.token };
    if (value.command === "donate" || value.command === "donate_nick" || value.command === "donate_thief" || value.command === "donate_dealer") return { kind: value.command };
    if (value.command === "item" && typeof value.itemId === "number" && Number.isSafeInteger(value.itemId) && value.itemId > 0) {
      return { kind: "item", itemId: value.itemId };
    }
    if (value.command === "promo_currency" && isPromoCurrency(value.currency)) {
      return { kind: "promo_currency", currency: value.currency };
    }
    if (value.command === "promo_confirm" && typeof value.token === "string" && value.token.length > 0 && value.token.length <= 200) {
      return { kind: "promo_confirm", token: value.token };
    }
    if (value.command === "promo_list" && (value.after === null || isPromoName(value.after))) {
      return { kind: "promo_list", after: value.after };
    }
    if (value.command === "promo" || value.command === "promo_create" || value.command === "promo_activate" || value.command === "promo_back") {
      return { kind: value.command };
    }
    if (value.command === "inventory" && typeof value.page === "number" && Number.isSafeInteger(value.page) && value.page >= 0 && value.page <= Math.floor(game.maxAmount / game.inventoryPageSize) - 1) {
      return { kind: "inventory", page: value.page };
    }
    if (value.command === "ranking" && isRankingMetric(value.metric)) {
      return { kind: "ranking", metric: value.metric };
    }
    if (value.command === "mining_confirm" && typeof value.level === "number" && Number.isSafeInteger(value.level) && value.level >= 0 && value.level < game.maxAmount) {
      return { kind: "mining_confirm", level: value.level };
    }
    if (value.command === "menu" || value.command === "mining" || value.command === "profile" || value.command === "bonus" || value.command === "mining_start" || value.command === "mining_withdraw" || value.command === "mining_upgrade" || value.command === "referrals" || value.command === "development") {
      return { kind: value.command };
    }
  }
  const normalized = text?.trim();
  if (isChat) {
    switch (normalized?.toLowerCase()) {
      case "я":
        return { kind: "profile" };
      case "и":
      case "инв":
      case "инвентарь":
        return { kind: "inventory", page: 0 };
    }
  }
  return { kind: "development" };
}
function parseReferrer(value, senderId) {
  if (typeof value !== "string" || value.length > 40 || !/^kreox_[1-9]\d*$/.test(value)) {
    return void 0;
  }
  const id = Number(value.slice(6));
  return Number.isSafeInteger(id) && id > 0 && id !== senderId ? id : void 0;
}

// src/services/giveaway-texts.ts
var giveawayTexts = {
  usage: "⚠️ Формат: /force Раздача монеты|евро|биткоин <игроков> <награда> или /force Раздача кейс реферальный|кейс ждун|крупьер <игроков> <количество 1–1000>. Награда указана для каждого игрока.",
  collect: "Получить",
  cancel: "Отмена",
  instruction: "Нажмите на кнопку, чтобы забрать награду.",
  already: "⚠️ Вы уже получали награды с этой раздачи!",
  old: "⚠ Нельзя принимать участие в старых раздачах.",
  ended: "⚠ Раздача закончилась.",
  finished: "Раздача завершена!",
  limit: "⚠️ Награда не получена: достигнут предел баланса или инвентаря. Активация не потрачена."
};
function giveawayAmount(reward) {
  const scale = BigInt(promoScale(reward.currency));
  const value = BigInt(reward.amount);
  const whole = formatAmount(Number(value / scale), 1);
  const fraction = String(value % scale).padStart(String(scale).length - 1, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole},${fraction}`;
}
function itemReward(reward) {
  const item = itemConfig.catalog.find((value) => value.kind === reward.itemKind);
  if (item === void 0) throw new Error("Invalid giveaway item");
  return `${item.name} х${formatAmount(reward.quantity, 1)}`;
}
function giveawayRewardText(reward) {
  if (reward.kind === "item") return itemReward(reward);
  const amount = giveawayAmount(reward);
  switch (reward.currency) {
    case "kc":
      return `${amount} KC`;
    case "euro":
      return `${amount}💶`;
    case "bitcoin":
      return `${amount}₿`;
    default:
      return assertNever(reward.currency);
  }
}
function giveawayRewardLine(reward) {
  if (reward.kind === "item") return itemReward(reward);
  const amount = giveawayAmount(reward);
  switch (reward.currency) {
    case "kc":
      return `💰 ${amount} KC`;
    case "euro":
      return `💶 ${amount} евро`;
    case "bitcoin":
      return `₿ ${amount} биткоинов`;
    default:
      return assertNever(reward.currency);
  }
}
function giveawayStarted(state) {
  const reward = state.reward.kind === "item" ? `Вы запустили раздачу на предмет ${giveawayRewardText(state.reward)}` : `🌟 Вы запустили раздачу на ${giveawayRewardText(state.reward)}`;
  return `${reward} на ${formatAmount(state.count, 1)} игроков!

${giveawayTexts.instruction}`;
}
function giveawayClaimed(state, player) {
  const footer = state.remaining === 0 ? giveawayTexts.finished : `Осталось ${formatAmount(state.remaining, 1)} возможностей получить награды!`;
  return `✅ ${mention(player)}, вы приняли участие в раздаче! Ваши награды:
${giveawayRewardLine(state.reward)}

${footer}`;
}
function giveawayCancelled(state) {
  return `⭐️ Раздача отменена!

${formatAmount(state.count - state.remaining, 1)} игроков успело получить ${giveawayRewardText(state.reward)}.`;
}

// src/services/donate-texts.ts
var donateLabels = { nickname: "👤 Ник", thief: "🥷 Вор", dealer: "🤵‍♂️ Крупье", confirm: "✅ Подтвердить", cancel: "💢 Отмена" };
var donateTexts = {
  title: "💶 Донат:",
  length: "⚠️ Допустимая длина 4-20 символов.",
  unsafe: "⚠️ Ник не должен содержать упоминания, переносы строк или управляющие символы.",
  cancelled: "Действие отменено.",
  stale: "⚠️ Подтверждение устарело. Начните действие заново.",
  funds: "⚠️ Недостаточно евро для покупки.",
  limit: "⚠️ Достигнут предел баланса. Действие не выполнено.",
  self: "⚠️ Вы итак являетесь крупье.",
  noVictim: "⚠️ В этой беседе нет других зарегистрированных игроков.",
  private: "⚠️ Откройте донат в личных сообщениях бота."
};
function moscowDate(date) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: donateConfig.timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(", ", " ");
}
function nicknamePrompt(player) {
  return `👤 Введите новый ник. Смена ника стоит ${formatAmount(donateConfig.nicknameCost, game.euroScale)} 💶 (у вас: ${formatAmount(player.euro, game.euroScale)} 💶).`;
}
function thiefPrompt(player) {
  return `${mention(player)}, команда "вор" дает Вам возможность случайно красть деньги у других игроков. Вы можете купить подписку на 30 дней: это будет стоить вам ${formatAmount(donateConfig.subscriptionCost, game.euroScale)} 💶

😔 Подписка на команду "вор" неактивна.`;
}
function subscriptionText(until, purchased) {
  return `${purchased ? "✅ Подписка на команду «вор» была приобретена." : "✅ Подписка на команду «вор» активна."}
📆 Подписка активна до ${moscowDate(until)}`;
}
function dealerMention(player) {
  return player === null ? "Государство" : mention(player);
}
function dealerPrompt(player, state) {
  return `🤴 Крупье получает 1% от всех проигрышей в казино.

💰 Крупье: ${dealerMention(player)} (заработал уже ${formatAmount(state.earnedKC, game.kcScale)} KC)

Стать крупье можно за ${formatAmount(donateConfig.dealerCost, game.euroScale)} 💶.`;
}

// src/services/item-texts.ts
var itemLabels = {
  use: "✅ Использовать",
  sell: "💰 Продать",
  gift: "🎁 Подарить",
  custom: "📦 Свое кол-во",
  open: "Открыть",
  confirm: "✅ Подтвердить",
  giftConfirm: "✅ Подтвредить"
};
var itemTexts = {
  done: "Done.",
  none: "⚠️ У вас нет данного предмета!",
  target: "👤 Введите ссылку на игрока.\n💡 Например [id888801846|@kreox_owner]",
  reserved: "⚠️ У вас есть активная сделка на данный предмет!\n\n⏳ Подождите принятия сделки или аннулирование сделки.",
  missing: "⚠️ Игрок не найден или ещё не зарегистрирован в боте.",
  self: "⚠️ Нельзя передать или продать предметы самому себе.",
  custom: "📦 Введите кол-во кейсов, которое хотите открыть.",
  cancelled: "Действие отменено.",
  ready: "📦 Держите!",
  giftConfirm: "Подтвердите передачу.",
  saleConfirm: "💡 Подтвердите продажу",
  sent: "Предложение о сделке отправлено.",
  price: "👤 Введите цену.",
  badPrice: "⚠️ Введите целую неотрицательную цену в KC. Можно использовать к и кк.",
  badQuantity: `⚠️ Введите целое количество от 1 до ${itemConfig.maxBatch}.`,
  stale: "⚠️ Подтверждение устарело. Начните действие заново.",
  limit: "⚠️ Достигнут предел баланса или инвентаря. Действие не выполнено.",
  funds: "⚠️ Недостаточно KC для покупки.",
  expired: "⚠️ Срок сделки истёк.",
  invalidOffer: "⚠️ Сделка недоступна или уже завершена.",
  private: "⚠️ Управляйте предметами в личных сообщениях бота.",
  adminUsage: "⚠️ Формат: !giveitem <ID игрока> <ID предмета> [количество] или !takeitem <ID игрока> <ID предмета>. Каталог: !itemlist. Количество — от 1 до 1000, по умолчанию 1."
};
function itemName(kind) {
  const entry = itemConfig.catalog.find((item) => item.kind === kind);
  if (entry === void 0) {
    throw new Error("Unknown item kind");
  }
  return entry.name;
}
function dropText(index) {
  const drop = itemConfig.drops[index];
  if (drop === void 0) {
    throw new Error("Unknown case drop");
  }
  return drop.currency === "kc" ? `💰 ${formatAmount(drop.amount, game.kcScale)} KC` : `💶 ${formatAmount(drop.amount, game.euroScale)} евро`;
}
function itemDetails(kind, count, use = false) {
  if (kind === "croupier") return `📒 Предмет "${itemName(kind)}" (x${count}):
Снимает КД на покупку крупье, пока находится в вашем инвентаре. Не расходуется.`;
  return (use ? `«${itemName(kind)}» (доступно: ${count} шт.):` : `📒 Предмет "${itemName(kind)}" (x${count}):`) + `
Может выпасть:

${itemConfig.drops.map((_, index) => dropText(index)).join("\n")}`;
}
function itemQuantityText(count) {
  return `🎒 Введите число предметов (у вас: ${count}).`;
}
function caseResultText(player, rewards) {
  return `${mention(player)}, 🎁 Вот что выпало:

` + rewards.counts.flatMap((count, index) => count === 0 ? [] : [`${dropText(index)}${count > 1 ? ` x${count}` : ""}`]).join("\n");
}
function giftSentText(receiver, kind, quantity) {
  return `✅ Вы успешно передали игроку ${mention(receiver)} ${itemName(kind)} x${quantity}`;
}
function giftReceivedText(sender, kind, quantity) {
  return `🎁 ${mention(sender)} подарил вам ${itemName(kind)} x${quantity}`;
}
function offerText(seller, offer) {
  return `Игрок ${mention(seller)} предлагает вам купить у него ${itemName(offer.itemKind)} x${offer.quantity} за ${formatAmount(offer.price, game.kcScale)} KC. Через 10 минут сделка аннулируется.`;
}
function boughtText(buyer) {
  return `${mention(buyer)}, сделка прошла успешно!`;
}
function soldText(buyer, offer) {
  return `${mention(buyer)} купил у вас ${itemName(offer.itemKind)} x${offer.quantity} за ${formatAmount(offer.price, game.kcScale)} KC`;
}
function itemCatalogText() {
  return "📖 ItemList:\n\n" + itemConfig.catalog.map((item) => `🆔 ${item.id} — ${item.name}`).join("\n\n");
}

// src/handlers/keyboards.ts
import { Keyboard } from "vk-io";
function buildKeyboard(spec) {
  const button = (label, action) => {
    const { kind, ...params } = action;
    return Keyboard.textButton({ label, payload: { command: kind, ...params } });
  };
  switch (spec.kind) {
    case "giveaway":
      return Keyboard.keyboard([[
        Keyboard.textButton({ label: giveawayTexts.collect, color: Keyboard.POSITIVE_COLOR, payload: { command: "giveaway_claim", peerId: spec.peerId, token: spec.token } }),
        Keyboard.textButton({ label: giveawayTexts.cancel, color: Keyboard.NEGATIVE_COLOR, payload: { command: "giveaway_cancel", peerId: spec.peerId, token: spec.token } })
      ]]).inline();
    case "dice_game":
      return Keyboard.keyboard([[
        Keyboard.textButton({ label: "Играть", color: Keyboard.POSITIVE_COLOR, payload: { command: "dice_join", peerId: spec.peerId, gameId: spec.gameId } }),
        Keyboard.textButton({ label: "Отмена", color: Keyboard.NEGATIVE_COLOR, payload: { command: "dice_leave", peerId: spec.peerId, gameId: spec.gameId } })
      ]]).inline();
    case "casino":
      return Keyboard.keyboard([
        [button(privateCasinoTexts.chats, { kind: "casino_chats" })],
        [button(privateCasinoTexts.jackpot, { kind: "jackpot" }), button(privateCasinoTexts.coin, { kind: "coin" })]
      ]).oneTime(false);
    case "casino_chats":
      return Keyboard.keyboard([
        [Keyboard.urlButton({ label: "Чат #1", url: privateCasinoConfig.chatUrl, payload: { command: "casino_chats" } })],
        [button(labels.back, { kind: "casino" })]
      ]).oneTime(false);
    case "jackpot":
      return Keyboard.keyboard([
        [button(privateCasinoTexts.join, { kind: "jackpot_join" })],
        [button(labels.back, { kind: "casino" }), button(labels.menu, { kind: "menu" })]
      ]).oneTime(false);
    case "coin":
      return Keyboard.keyboard([
        [button("💎", { kind: "coin_flip", side: "diamond", token: spec.token, step: spec.step }), button("🟢", { kind: "coin_flip", side: "emerald", token: spec.token, step: spec.step })],
        [button(privateCasinoTexts.cashout, { kind: "coin_cashout", token: spec.token, step: spec.step })],
        [button(labels.back, { kind: "casino" })]
      ]).oneTime(false);
    case "director":
      return Keyboard.keyboard([[button(casinoTexts.directorBid, { kind: "director_bid" })], [button(labels.back, { kind: "city" })]]).oneTime(false);
    case "director_back":
      return Keyboard.keyboard([[button(labels.back, { kind: "director_view" })]]).oneTime(false);
    case "director_confirm":
      return Keyboard.keyboard([[
        Keyboard.textButton({ label: donateLabels.confirm, color: Keyboard.POSITIVE_COLOR, payload: { command: "director_confirm", token: spec.token } }),
        Keyboard.textButton({ label: labels.back, color: Keyboard.NEGATIVE_COLOR, payload: { command: "director_view" } })
      ]]).oneTime(false);
    case "city":
      return Keyboard.keyboard([
        [button(bankLabels.director, { kind: "city_director" }), button(bankLabels.bank, { kind: "bank" }), button(bankLabels.casino, { kind: "casino" })],
        [button(labels.menu, { kind: "menu" })]
      ]).oneTime(false);
    case "bank":
      return Keyboard.keyboard([
        [button(bankLabels.savings, { kind: "bank_savings" })],
        [button(bankLabels.pension, { kind: "bank_pension" }), button(bankLabels.transfer, { kind: "bank_transfer_menu" })],
        [button(bankLabels.deposits, { kind: "bank_deposits" })],
        [button(labels.back, { kind: "city" })]
      ]).oneTime(false);
    case "bank_savings":
      return Keyboard.keyboard([
        [button(bankLabels.add, { kind: "bank_deposit_money" })],
        [button(bankLabels.withdraw, { kind: "bank_withdraw_money" })],
        [button(labels.back, { kind: "bank" }), button(labels.menu, { kind: "menu" })]
      ]).oneTime(false);
    case "bank_transfer_menu":
      return Keyboard.keyboard([[
        button("KC", { kind: "bank_currency", currency: "kc" }),
        button("💶", { kind: "bank_currency", currency: "euro" }),
        button("💠", { kind: "bank_currency", currency: "bitcoin" })
      ]]).oneTime(false);
    case "bank_back":
      return Keyboard.keyboard([[button(bankLabels.back, { kind: spec.destination })]]).oneTime(false);
    case "bank_deposits":
      return Keyboard.keyboard([
        [button(bankLabels.create, { kind: "bank_deposit_create" })],
        ...spec.depositIds.map((depositId) => [button(`🆔 ${depositId}`, { kind: "bank_deposit", depositId })]),
        [button(labels.menu, { kind: "menu" })]
      ]).oneTime(false);
    case "bank_deposit_amount":
      return Keyboard.keyboard([
        spec.amounts.slice(0, 3).map((amount) => button(formatAmount(amount, game.kcScale), { kind: "bank_deposit_amount", amount })),
        spec.amounts.slice(3, 5).map((amount) => button(formatAmount(amount, game.kcScale), { kind: "bank_deposit_amount", amount })),
        [button(bankLabels.back, { kind: "bank_deposits" })]
      ]).oneTime(false);
    case "bank_deposit_term":
      return Keyboard.keyboard([
        [button("3 дня", { kind: "bank_deposit_term", days: 3, token: spec.token }), button("10 дней", { kind: "bank_deposit_term", days: 10, token: spec.token })],
        [button(bankLabels.back, { kind: "bank_deposit_create" })]
      ]).oneTime(false);
    case "bank_deposit_early":
      return Keyboard.keyboard([[button(bankLabels.early, { kind: "bank_deposit_early", depositId: spec.depositId })]]).inline();
    case "bank_deposit_confirm":
      return Keyboard.keyboard([[Keyboard.textButton({ label: bankLabels.confirm, color: Keyboard.POSITIVE_COLOR, payload: { command: "bank_deposit_confirm", token: spec.token } })]]).inline();
    case "donate":
      return Keyboard.keyboard([
        [button(donateLabels.nickname, { kind: "donate_nick" }), button(donateLabels.thief, { kind: "donate_thief" }), button(donateLabels.dealer, { kind: "donate_dealer" })],
        [button(labels.back, { kind: "menu" })]
      ]).oneTime(false);
    case "donate_back":
      return Keyboard.keyboard([[button(labels.back, { kind: "donate" })]]).oneTime(false);
    case "donate_confirmation": {
      const keyboard = Keyboard.keyboard([[
        Keyboard.textButton({ label: donateLabels.confirm, color: Keyboard.POSITIVE_COLOR, payload: { command: "donate_confirm", token: spec.token } }),
        Keyboard.textButton({ label: donateLabels.cancel, color: Keyboard.NEGATIVE_COLOR, payload: { command: "donate_cancel", token: spec.token } })
      ]]);
      return spec.inline ? keyboard.inline() : keyboard.oneTime(false);
    }
    case "item_detail":
      return Keyboard.keyboard([
        ...spec.itemKind === "croupier" ? [] : [[Keyboard.textButton({ label: itemLabels.use, payload: { command: "item_use", itemKind: spec.itemKind } })]],
        [
          Keyboard.textButton({ label: itemLabels.sell, payload: { command: "item_sell", itemKind: spec.itemKind } }),
          Keyboard.textButton({ label: itemLabels.gift, payload: { command: "item_gift", itemKind: spec.itemKind } })
        ],
        [Keyboard.textButton({ label: labels.back, payload: { command: "inventory", page: 0 } })]
      ]).oneTime(false);
    case "item_use":
      return Keyboard.keyboard([
        [1, 5, 10].map((quantity) => Keyboard.textButton({ label: `x${quantity}`, payload: { command: "item_open", itemKind: spec.itemKind, quantity } })),
        [Keyboard.textButton({ label: itemLabels.custom, payload: { command: "item_custom", itemKind: spec.itemKind } })],
        [Keyboard.textButton({ label: labels.back, payload: { command: "item_detail", itemKind: spec.itemKind } })]
      ]).oneTime(false);
    case "item_back":
      return Keyboard.keyboard([[Keyboard.textButton({ label: labels.back, payload: { command: "item_detail", itemKind: spec.itemKind } })]]).oneTime(false);
    case "item_confirmation":
      if (spec.mode === "open") {
        return Keyboard.keyboard([
          [Keyboard.textButton({ label: itemLabels.open, payload: { command: "item_open_confirm", token: spec.token } })],
          [Keyboard.textButton({ label: labels.back, payload: { command: "inventory", page: 0 } })]
        ]).oneTime(false);
      }
      return Keyboard.keyboard([[Keyboard.textButton({
        label: spec.mode === "gift" ? itemLabels.giftConfirm : itemLabels.confirm,
        payload: { command: "item_confirm", token: spec.token }
      })]]).inline();
    case "item_offer":
      return Keyboard.keyboard([[Keyboard.textButton({
        label: itemLabels.confirm,
        payload: { command: "item_buy", offerId: spec.offerId }
      })]]).inline();
    case "none":
      return Keyboard.keyboard([]);
    case "promo":
      return Keyboard.keyboard([
        [Keyboard.textButton({ label: labels.createPromo, payload: { command: "promo_create" } })],
        [Keyboard.textButton({ label: labels.activatePromo, color: Keyboard.POSITIVE_COLOR, payload: { command: "promo_activate" } })],
        [Keyboard.textButton({ label: labels.myPromos, payload: { command: "promo_list", after: null } })]
      ]).oneTime(false);
    case "promo_currency":
      return Keyboard.keyboard([
        [
          Keyboard.textButton({ label: "KC", payload: { command: "promo_currency", currency: "kc" } }),
          Keyboard.textButton({ label: "💶", payload: { command: "promo_currency", currency: "euro" } }),
          Keyboard.textButton({ label: "💠", payload: { command: "promo_currency", currency: "bitcoin" } })
        ],
        [Keyboard.textButton({ label: labels.back, payload: { command: "promo_back" } })]
      ]).oneTime(false);
    case "promo_back":
      return Keyboard.keyboard([[Keyboard.textButton({ label: labels.back, payload: { command: "promo_back" } })]]).oneTime(false);
    case "promo_confirm":
      return Keyboard.keyboard([[Keyboard.textButton({
        label: labels.confirmPromo,
        payload: { command: "promo_confirm", token: spec.token }
      })]]).inline();
    case "promo_list":
      return Keyboard.keyboard([
        ...spec.after === null ? [] : [[Keyboard.textButton({ label: labels.next, payload: { command: "promo_list", after: spec.after } })]],
        [Keyboard.textButton({ label: labels.back, payload: { command: "promo_back" } })]
      ]).oneTime(false);
    case "main":
      return Keyboard.keyboard([
        [button(labels.battlePass, { kind: "development" })],
        [button(labels.profile, { kind: "profile" }), button(labels.bonus, { kind: "bonus" }), button(labels.rating, { kind: "ranking", metric: "kc" })],
        [button(labels.promo, { kind: "promo" }), Keyboard.textButton({ label: labels.city, color: Keyboard.PRIMARY_COLOR, payload: { command: "city" } }), button(labels.mining, { kind: "mining" })],
        [Keyboard.textButton({ label: labels.donate, color: Keyboard.POSITIVE_COLOR, payload: { command: "donate" } }), button(labels.boss, { kind: "development" }), button(labels.tasks, { kind: "development" })],
        [button(labels.help, { kind: "development" })]
      ]).oneTime(false);
    case "profile":
      return Keyboard.keyboard([[button(labels.referral, { kind: "referrals" }), button(labels.inventory, { kind: "inventory", page: 0 })], [button(labels.menu, { kind: "menu" })]]).oneTime(false);
    case "mining":
      return Keyboard.keyboard([
        [button(labels.startMining, { kind: "mining_start" }), button(labels.withdrawMining, { kind: "mining_withdraw" })],
        [button(labels.upgradeMining, { kind: "mining_upgrade" }), Keyboard.textButton({ label: labels.back, payload: { command: "menu" } })]
      ]).oneTime(false);
    case "mining_upgrade":
      return Keyboard.keyboard([
        [Keyboard.textButton({ label: labels.confirm, payload: { command: "mining_confirm", level: spec.level } })],
        [Keyboard.textButton({ label: labels.upgradeBack, payload: { command: "mining" } })]
      ]).oneTime(false);
    case "ranking":
      return Keyboard.keyboard([
        [button(labels.kc, { kind: "ranking", metric: "kc" }), button(labels.bitcoin, { kind: "ranking", metric: "bitcoin" }), Keyboard.textButton({ label: labels.mining, payload: { command: "ranking", metric: "mining" } })],
        [button(labels.euro, { kind: "ranking", metric: "euro" }), button(labels.referrals, { kind: "ranking", metric: "referrals" }), button(labels.reputation, { kind: "ranking", metric: "reputation" })],
        [button(labels.thieves, { kind: "ranking", metric: "stolenKC" })],
        [Keyboard.textButton({ label: labels.back, payload: { command: "menu" } })]
      ]).oneTime(false);
    case "referrals":
      return Keyboard.keyboard([[Keyboard.textButton({ label: labels.back, payload: { command: "profile" } })]]).oneTime(false);
    case "inventory": {
      const rows = spec.itemIds.map((id) => [Keyboard.textButton({ label: `🆔 ${id}`, payload: { command: "item", itemId: id } })]);
      const navigation = [];
      if (spec.page > 0) {
        navigation.push(Keyboard.textButton({ label: labels.previous, payload: { command: "inventory", page: spec.page - 1 } }));
      }
      if (spec.hasNext) {
        navigation.push(Keyboard.textButton({ label: labels.next, payload: { command: "inventory", page: spec.page + 1 } }));
      }
      if (navigation.length > 0) {
        rows.push(navigation);
      }
      rows.push([button(labels.back, { kind: "profile" })]);
      return Keyboard.keyboard(rows).oneTime(false);
    }
    default:
      return assertNever(spec);
  }
}

// src/handlers/messages.ts
async function sendReply(vk, peerId, randomId, reply3, clearKeyboard = false) {
  if (reply3.text.length > game.maxMessageLength) {
    throw new Error("Reply is too long");
  }
  const params = {
    peer_id: peerId,
    random_id: randomId,
    message: reply3.text,
    ...reply3.attachment === void 0 ? {} : { attachment: reply3.attachment },
    ...reply3.keyboard.kind === "none" && !clearKeyboard ? {} : { keyboard: buildKeyboard(reply3.keyboard).toString() },
    disable_mentions: true,
    dont_parse_links: true
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      await vk.api.messages.send(params);
      return;
    } catch (error) {
      if (!(error instanceof ExecuteError2) || error.code !== 6 || attempt >= 2) {
        throw error;
      }
      await setTimeout(1e3 * (attempt + 1));
    }
  }
}
function createMessageHandler(vk, game2, groupId, wakeNotifications) {
  return async (context) => {
    if (context.isOutbox || context.isEvent || !isPositiveId(context.senderId)) {
      return;
    }
    const messageId = context.conversationMessageId;
    if (messageId === void 0 || !isPositiveId(messageId) || messageId > game.maxRandomId || !isPositiveId(context.peerId)) {
      logError("invalid_message_identity", new Error("Invalid message identity"));
      return;
    }
    const eventId = `${groupId}:${context.peerId}:${messageId}`;
    let reply3;
    try {
      if (!context.isChat && context.text?.trim().toLowerCase() === "вор") return;
      const payload = context.messagePayload;
      const command = parseCommand(context.text, payload, context.isChat);
      if (isGiveawayCommand(command) && (!context.isChat || isGiveawayAdminCommand(command) && !adminIds.has(context.senderId))) return;
      if ((command.kind === "mailing" || command.kind === "mailing_invalid") && !adminIds.has(context.senderId)) return;
      if (isAdminItemCommand(command) && !adminIds.has(context.senderId)) {
        return;
      }
      if ((command.kind === "admin_balance" || command.kind === "admin_balance_invalid") && !adminIds.has(context.senderId)) {
        return;
      }
      if (command.kind === "delete_keyboards" && (!context.isChat || !adminIds.has(context.senderId))) {
        return;
      }
      if (context.isChat && command.kind === "development") {
        return;
      }
      const replySenderId = context.replyMessage?.senderId;
      const referrerId = context.isChat ? void 0 : parseReferrer(context.referralValue, context.senderId);
      reply3 = await game2.handle({
        eventId,
        vkId: context.senderId,
        peerId: context.peerId,
        command,
        ...replySenderId === void 0 ? {} : { replySenderId },
        ...payload === void 0 || payload === null ? {} : { hasPayload: true },
        ...context.text === void 0 ? {} : { text: context.text },
        ...context.isChat ? { isChat: true } : {},
        ...referrerId === void 0 ? {} : { referrerId }
      }, async () => {
        const users = await vk.api.users.get({ user_ids: [context.senderId] });
        const user = users[0];
        if (user === void 0 || user.id !== context.senderId) {
          throw new Error("VK user is unavailable");
        }
        return user.first_name;
      }, () => loadChatMembers(vk, context.peerId, groupId), wakeNotifications);
    } catch (error) {
      logError("message_processing", error, { eventId, vkId: context.senderId });
      try {
        await sendReply(vk, context.peerId, -randomInt(1, game.maxRandomId + 1), { text: texts.error, keyboard: { kind: context.isChat ? "none" : "main" } }, context.isChat);
      } catch (sendError) {
        logError("error_reply", sendError, { eventId });
      }
      return;
    }
    try {
      if (reply3.text.length > 0) await sendReply(vk, context.peerId, reply3.randomId, reply3, context.isChat);
    } catch (error) {
      logError("vk_reply", error, { eventId, vkId: context.senderId });
    }
  };
}

// src/handlers/referrals.ts
import { APIError as APIError4 } from "vk-io";
function createReferralLinkResolver(vk, groupId) {
  return async (vkId) => {
    if (!isPositiveId(vkId) || !isPositiveId(groupId)) {
      throw new Error("Invalid referral identity");
    }
    try {
      const response = await vk.api.utils.getShortLink({
        url: `https://vk.me/club${groupId}?ref=kreox_${vkId}`
      });
      return response.short_url;
    } catch (error) {
      const parameterHint = error instanceof APIError4 && error.code === 100 ? /\b(private|url)\b/i.exec(error.message)?.[1]?.toLowerCase() : void 0;
      logError("referral_short_link", error, {
        method: "utils.getShortLink",
        ...parameterHint === void 0 ? {} : { parameterHint }
      });
      throw error;
    }
  };
}

// src/handlers/notifications.ts
import { randomUUID } from "node:crypto";
import { APIError as APIError5 } from "vk-io";
function startNotifications(queue, vk, resolveRoulettePhoto) {
  let running;
  let stopped = false;
  let wakeRequested = false;
  const flush = async () => {
    try {
      for (let count = 0; count < 20 && !stopped; count += 1) {
        const leaseId = randomUUID();
        const notification = await queue.leaseNotification(leaseId);
        if (notification === null) {
          return;
        }
        let state = "sent";
        let delay = 0;
        try {
          const attachment = notification.roulettePhoto === void 0 || resolveRoulettePhoto === void 0 ? null : await resolveRoulettePhoto(notification.peerId, notification.roulettePhoto);
          await sendReply(vk, notification.peerId, notification.randomId, {
            text: notification.text,
            keyboard: notification.keyboard ?? { kind: "none" },
            ...attachment === null ? {} : { attachment }
          });
        } catch (error) {
          logError("notification_delivery", error, { notificationId: notification._id });
          const permanent = error instanceof APIError5 && typeof error.code === "number" && [7, 15, 100, 900, 901, 902, 917, 945, 946].includes(error.code);
          state = permanent ? "failed" : "pending";
          delay = Math.min(
            game.notificationMaxRetryMs,
            game.notificationRetryMs * 2 ** Math.min(notification.attempts - 1, 10)
          );
        }
        await queue.finishNotification(notification._id, leaseId, state, delay);
      }
    } catch (error) {
      logError("notification_worker", error);
    }
  };
  const tick = () => {
    if (running !== void 0 || stopped) {
      return;
    }
    wakeRequested = false;
    running = flush().finally(() => {
      running = void 0;
      if (wakeRequested) tick();
    });
  };
  const timer = setInterval(tick, game.notificationIntervalMs);
  timer.unref();
  tick();
  return Object.assign(async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  }, { wake: () => {
    if (stopped) return;
    wakeRequested = true;
    tick();
  } });
}

// src/repositories/mongo-mailing-migration.ts
import { MongoServerError as MongoServerError3 } from "mongodb";

// src/services/mailing-rules.ts
function historicalPrivateRecipient(message) {
  const parts = message._id.split(":");
  if (parts.length !== 3 || !parts.every((part) => /^[1-9]\d{0,15}$/.test(part))) return null;
  const [groupId, peerId, messageId] = parts.map(Number);
  return groupId !== void 0 && peerId !== void 0 && messageId !== void 0 && isPositiveId(groupId) && isPositiveId(messageId) && isPositiveId(message.vkId) && peerId === message.vkId ? message.vkId : null;
}

// src/repositories/mongo-mailing-migration.ts
async function migrateMailingRecipients(db) {
  const recipients = db.collection("mailing_recipients");
  const checkpoints = db.collection("mailing_migrations");
  for (; ; ) {
    const checkpoint = await checkpoints.findOne({ _id: "private_history" });
    if (checkpoint?.done === true) return;
    const page = await db.collection("processed_messages").find({ _id: { $gt: checkpoint?.after ?? "" } }, { projection: { _id: 1, vkId: 1 } }).sort({ _id: 1 }).limit(mailingConfig.migrationPageSize).toArray();
    const ids = new Set(page.flatMap((message) => {
      const vkId = historicalPrivateRecipient(message);
      return vkId === null ? [] : [vkId];
    }));
    await Promise.all([...ids].map(async (vkId) => {
      const result2 = await recipients.updateOne({ _id: vkId }, { $setOnInsert: { joinedAt: /* @__PURE__ */ new Date(0) } }, { upsert: true }).catch(async (error) => {
        if (!(error instanceof MongoServerError3) || error.code !== 11e3) throw error;
        return recipients.updateOne({ _id: vkId }, { $setOnInsert: { joinedAt: /* @__PURE__ */ new Date(0) } });
      });
      if (!result2.acknowledged || result2.matchedCount + result2.upsertedCount !== 1) throw new Error("Mailing recipient migration failed");
    }));
    const last = page.at(-1);
    const update = last === void 0 ? { $set: { done: true }, $setOnInsert: { after: checkpoint?.after ?? "" } } : { $max: { after: last._id }, $setOnInsert: { done: false } };
    const result = await checkpoints.updateOne({ _id: "private_history" }, update, { upsert: true }).catch(async (error) => {
      if (!(error instanceof MongoServerError3) || error.code !== 11e3) throw error;
      return checkpoints.updateOne({ _id: "private_history" }, update);
    });
    if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new Error("Mailing migration checkpoint failed");
  }
}

// src/repositories/mongo.ts
import { randomInt as randomInt3 } from "node:crypto";

// src/services/donate-rules.ts
function isDonateCommand(command) {
  switch (command.kind) {
    case "donate":
    case "donate_nick":
    case "donate_thief":
    case "donate_dealer":
    case "donate_confirm":
    case "donate_cancel":
    case "dealer_buy":
    case "dealer_view":
    case "theft":
      return true;
    default:
      return false;
  }
}
function validNickname(name) {
  if (name.length > 200 || /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069\u200b\ufeff\[\]|@*]/u.test(name)) {
    return false;
  }
  const length = [...new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(name)].length;
  return length >= donateConfig.nicknameMin && length <= donateConfig.nicknameMax;
}
function cooldownParts(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1e3));
  return `${Math.floor(seconds / 60)} мин. ${seconds % 60} сек.`;
}
function validDonateMoney(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= game.maxAmount;
}

// src/repositories/mongo-promos.ts
var MongoPromoStore = class {
  constructor(db, promoSession) {
    this.promoSession = promoSession;
    this.promoPlayers = db.collection("players");
    this.promoCodes = db.collection("promos");
    this.promoRedemptions = db.collection("promo_redemptions");
  }
  promoSession;
  promoPlayers;
  promoCodes;
  promoRedemptions;
  async setPromoDraft(vkId, draft) {
    const result = await this.promoPlayers.updateOne(
      { _id: vkId },
      draft === null ? { $unset: { promoDraft: "" } } : { $set: { promoDraft: draft } },
      { session: this.promoSession }
    );
    if (result.matchedCount !== 1) {
      throw new Error("Promo owner was not found");
    }
  }
  async promo(name) {
    const value = await this.promoCodes.findOne({ _id: name }, { session: this.promoSession, collation: { locale: "simple" } });
    if (value !== null) {
      validatePromo(value);
    }
    return value;
  }
  async promos(vkId, after) {
    const values = await this.promoCodes.find(
      { ownerId: vkId, ...after === null ? {} : { _id: { $gt: after } } },
      { session: this.promoSession, collation: { locale: "simple" } }
    ).sort({ _id: 1 }).limit(game.promo.pageSize + 1).toArray();
    for (const value of values) {
      validatePromo(value);
    }
    return values;
  }
  async createPromo(player, promo) {
    validatePromo(promo);
    const total = promoTotal(promo.amount, promo.quantity);
    if (promo.ownerId !== player._id || promo.remaining !== promo.quantity || total === null) {
      throw new Error("Invalid promo funding");
    }
    if (await this.promo(promo._id) !== null) {
      return "exists";
    }
    const debit = await this.promoPlayers.updateOne(
      { _id: player._id, [promo.currency]: { $gte: total, $lte: game.maxAmount } },
      { $inc: { [promo.currency]: -total } },
      { session: this.promoSession }
    );
    if (debit.matchedCount !== 1) {
      return "funds";
    }
    const result = await this.promoCodes.insertOne(promo, { session: this.promoSession });
    if (!result.acknowledged) {
      throw new Error("Promo creation was not acknowledged");
    }
    return "created";
  }
  async activatePromo(player, promo) {
    validatePromo(promo);
    if (promo.ownerId === player._id) {
      return "own";
    }
    const _id = promoRedemptionId(promo._id, player._id);
    if (await this.promoRedemptions.findOne({ _id }, { session: this.promoSession }) !== null) {
      return "already";
    }
    if (promo.remaining === 0) {
      return "empty";
    }
    const credit = await this.promoPlayers.updateOne(
      { _id: player._id, [promo.currency]: { $gte: 0, $lte: game.maxAmount - promo.amount } },
      { $inc: { [promo.currency]: promo.amount } },
      { session: this.promoSession }
    );
    if (credit.matchedCount !== 1) {
      return "balance_limit";
    }
    const used = await this.promoCodes.updateOne(
      { _id: promo._id, ownerId: { $ne: player._id }, remaining: { $gt: 0 } },
      { $inc: { remaining: -1 } },
      { session: this.promoSession, collation: { locale: "simple" } }
    );
    if (used.matchedCount !== 1) {
      throw new Error("Promo activation conflict");
    }
    const receipt = await this.promoRedemptions.insertOne({ _id, promoName: promo._id, vkId: player._id }, { session: this.promoSession });
    if (!receipt.acknowledged) {
      throw new Error("Promo activation was not acknowledged");
    }
    return "redeemed";
  }
};

// src/repositories/mongo-items.ts
var MongoItemStore = class extends MongoPromoStore {
  constructor(db, itemSession) {
    super(db, itemSession);
    this.itemSession = itemSession;
    this.itemPlayers = db.collection("players");
    this.itemUnits = db.collection("inventory");
    this.offers = db.collection("item_offers");
  }
  itemSession;
  itemPlayers;
  itemUnits;
  offers;
  async playerByAccountId(accountId) {
    return this.itemPlayers.findOne({ accountId }, { session: this.itemSession });
  }
  async ownedItem(vkId, itemId) {
    return this.itemUnits.findOne({ vkId, itemId }, { session: this.itemSession });
  }
  available(vkId, kind, now) {
    if (!isItemKind(kind)) {
      throw new Error("Invalid item kind");
    }
    return { vkId, kind, $or: [{ reservedUntil: { $exists: false } }, { reservedUntil: { $lte: now } }] };
  }
  async itemCount(vkId, kind, now) {
    return this.itemUnits.countDocuments(this.available(vkId, kind, now), { session: this.itemSession });
  }
  async hasReservedItems(vkId, kind, now) {
    if (!isItemKind(kind)) {
      throw new Error("Invalid item kind");
    }
    return await this.itemUnits.findOne({ vkId, kind, reservedUntil: { $gt: now } }, {
      session: this.itemSession,
      projection: { _id: 1 }
    }) !== null;
  }
  async setItemDraft(vkId, draft) {
    const result = await this.itemPlayers.updateOne({ _id: vkId }, draft === null ? { $unset: { itemDraft: "" } } : { $set: { itemDraft: draft } }, { session: this.itemSession });
    if (result.matchedCount !== 1) {
      throw new Error("Item actor was not found");
    }
  }
  async select(vkId, kind, quantity, now) {
    if (!validItemQuantity(quantity)) {
      throw new Error("Invalid item quantity");
    }
    return this.itemUnits.find(this.available(vkId, kind, now), { session: this.itemSession }).sort({ itemId: 1 }).limit(quantity).toArray();
  }
  async grantItems(vkId, kind, quantity) {
    if (!isItemKind(kind) || !validItemQuantity(quantity)) {
      throw new Error("Invalid item grant");
    }
    const player = await this.itemPlayers.findOneAndUpdate({
      _id: vkId,
      nextItemId: { $gte: 1, $lte: game.maxAmount - quantity },
      $expr: { $eq: ["$nextItemId", { $trunc: "$nextItemId" }] }
    }, { $inc: { nextItemId: quantity } }, { session: this.itemSession, returnDocument: "before", includeResultMetadata: false });
    if (player === null) {
      return false;
    }
    await this.insertUnits(vkId, kind, quantity, player.nextItemId);
    return true;
  }
  async insertUnits(vkId, kind, quantity, firstId) {
    const result = await this.itemUnits.insertMany(Array.from({ length: quantity }, (_, index) => ({
      _id: `${vkId}:${firstId + index}`,
      vkId,
      kind,
      itemId: firstId + index
    })), { session: this.itemSession });
    if (!result.acknowledged || result.insertedCount !== quantity) {
      throw new Error("Item insert failed");
    }
  }
  async deleteUnits(units) {
    const result = await this.itemUnits.deleteMany({ _id: { $in: units.map((unit) => unit._id) } }, { session: this.itemSession });
    if (result.deletedCount !== units.length) {
      throw new Error("Item consumption conflict");
    }
  }
  async removeItems(vkId, kind, quantity, now) {
    const units = await this.select(vkId, kind, quantity, now);
    if (units.length !== quantity) {
      return false;
    }
    await this.deleteUnits(units);
    return true;
  }
  async openItems(player, kind, quantity, rewards, now) {
    if (kind === "croupier") throw new Error("Not a case");
    if (![rewards.kc, rewards.euro].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= game.maxAmount)) {
      throw new Error("Invalid case rewards");
    }
    if (![player.kc, player.euro].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= game.maxAmount)) {
      return "limit";
    }
    const units = await this.select(player._id, kind, quantity, now);
    if (units.length !== quantity) {
      return "items";
    }
    const result = await this.itemPlayers.updateOne({
      _id: player._id,
      kc: { $gte: 0, $lte: game.maxAmount - rewards.kc },
      euro: { $gte: 0, $lte: game.maxAmount - rewards.euro }
    }, { $inc: { kc: rewards.kc, euro: rewards.euro } }, { session: this.itemSession });
    if (result.matchedCount !== 1) {
      return "limit";
    }
    await this.deleteUnits(units);
    return "ok";
  }
  async giftItems(sender, receiver, kind, quantity, now) {
    if (sender._id === receiver._id) {
      throw new Error("Self transfer");
    }
    const units = await this.select(sender._id, kind, quantity, now);
    if (units.length !== quantity) {
      return "items";
    }
    if (!await this.grantItems(receiver._id, kind, quantity)) {
      return "limit";
    }
    await this.deleteUnits(units);
    return "ok";
  }
  async reserveOffer(offer, now) {
    validateOffer(offer);
    if (offer.state !== "pending" || offer.expiresAt <= now) {
      throw new Error("Invalid offer reservation");
    }
    const units = await this.select(offer.sellerId, offer.itemKind, offer.quantity, now);
    if (units.length !== offer.quantity) {
      return false;
    }
    const result = await this.itemUnits.updateMany({ _id: { $in: units.map((unit) => unit._id) } }, {
      $set: { reservedUntil: offer.expiresAt, offerId: offer._id }
    }, { session: this.itemSession });
    if (result.matchedCount !== offer.quantity) {
      throw new Error("Reservation conflict");
    }
    if (!(await this.offers.insertOne(offer, { session: this.itemSession })).acknowledged) {
      throw new Error("Offer insert failed");
    }
    return true;
  }
  async itemOffer(id) {
    const offer = await this.offers.findOne({ _id: id }, { session: this.itemSession });
    if (offer !== null) {
      validateOffer(offer);
    }
    return offer;
  }
  async purchaseOffer(offer, buyer, seller, now) {
    validateOffer(offer);
    if (offer.buyerId !== buyer._id || offer.sellerId !== seller._id || offer.state !== "pending") {
      return "invalid";
    }
    if (offer.expiresAt <= now) {
      await this.offers.updateOne({ _id: offer._id, state: "pending" }, { $set: { state: "expired" } }, { session: this.itemSession });
      return "expired";
    }
    const units = await this.itemUnits.find({
      vkId: seller._id,
      kind: offer.itemKind,
      offerId: offer._id,
      reservedUntil: { $gt: now }
    }, { session: this.itemSession }).limit(offer.quantity).toArray();
    if (units.length !== offer.quantity) {
      return "items";
    }
    if (!Number.isSafeInteger(seller.kc) || seller.kc < 0 || seller.kc > game.maxAmount - offer.price) {
      return "limit";
    }
    if (!Number.isSafeInteger(buyer.kc) || buyer.kc < 0 || buyer.kc > game.maxAmount) {
      return "limit";
    }
    if (buyer.kc < offer.price) {
      return "funds";
    }
    const debit = await this.itemPlayers.findOneAndUpdate({
      _id: buyer._id,
      kc: { $gte: offer.price, $lte: game.maxAmount },
      nextItemId: { $gte: 1, $lte: game.maxAmount - offer.quantity },
      $expr: { $eq: ["$nextItemId", { $trunc: "$nextItemId" }] }
    }, { $inc: { kc: -offer.price, nextItemId: offer.quantity } }, {
      session: this.itemSession,
      returnDocument: "before",
      includeResultMetadata: false
    });
    if (debit === null) {
      return "limit";
    }
    const credit = await this.itemPlayers.updateOne({ _id: seller._id, kc: { $gte: 0, $lte: game.maxAmount - offer.price } }, {
      $inc: { kc: offer.price }
    }, { session: this.itemSession });
    const completed = await this.offers.updateOne({ _id: offer._id, state: "pending", expiresAt: { $gt: now }, $expr: { $gt: ["$expiresAt", "$$NOW"] } }, {
      $set: { state: "completed" }
    }, { session: this.itemSession });
    if (credit.matchedCount !== 1 || completed.matchedCount !== 1) {
      throw new Error("Purchase conflict");
    }
    await this.deleteUnits(units);
    await this.insertUnits(buyer._id, offer.itemKind, offer.quantity, debit.nextItemId);
    return "ok";
  }
};

// src/repositories/mongo-donate.ts
var MongoDonateStore = class extends MongoItemStore {
  constructor(db, donateSession) {
    super(db, donateSession);
    this.donateSession = donateSession;
    this.donatePlayers = db.collection("players");
    this.donateItems = db.collection("inventory");
    this.dealers = db.collection("dealer");
  }
  donateSession;
  donatePlayers;
  donateItems;
  dealers;
  async setDonateDraft(vkId, draft) {
    const result = await this.donatePlayers.updateOne({ _id: vkId }, draft === null ? { $unset: { donateDraft: "" } } : { $set: { donateDraft: draft } }, { session: this.donateSession });
    if (result.matchedCount !== 1) throw new Error("Missing donate actor");
  }
  async changeNickname(player, nickname) {
    if (!validNickname(nickname)) throw new Error("Invalid nickname");
    if (!validDonateMoney(player.euro)) return "limit";
    const result = await this.donatePlayers.updateOne({ _id: player._id, euro: { $gte: donateConfig.nicknameCost, $lte: game.maxAmount }, $expr: { $eq: ["$euro", { $trunc: "$euro" }] } }, {
      $inc: { euro: -donateConfig.nicknameCost },
      $set: { name: nickname },
      $unset: { donateDraft: "" }
    }, { session: this.donateSession });
    return result.matchedCount === 1 ? "ok" : "funds";
  }
  async buyThief(player, now) {
    if (player.thiefUntil !== void 0 && player.thiefUntil > now) return "active";
    if (!validDonateMoney(player.euro)) return "limit";
    const result = await this.donatePlayers.updateOne({
      _id: player._id,
      euro: { $gte: donateConfig.subscriptionCost, $lte: game.maxAmount },
      $expr: { $eq: ["$euro", { $trunc: "$euro" }] },
      $or: [{ thiefUntil: { $exists: false } }, { thiefUntil: { $lte: now } }]
    }, { $inc: { euro: -donateConfig.subscriptionCost }, $set: { thiefUntil: new Date(now.getTime() + donateConfig.subscriptionMs) }, $unset: { donateDraft: "" } }, { session: this.donateSession });
    return result.matchedCount === 1 ? "ok" : "funds";
  }
  async theftTargetCount(actorId, memberIds) {
    return this.donatePlayers.countDocuments({ _id: { $in: [...memberIds], $ne: actorId } }, { session: this.donateSession });
  }
  async theftTarget(actorId, memberIds, offset) {
    return this.donatePlayers.find({ _id: { $in: [...memberIds], $ne: actorId } }, { session: this.donateSession }).sort({ _id: 1 }).skip(offset).limit(1).next();
  }
  async steal(actor, victim, amount, now) {
    if (actor._id === victim._id || !Number.isSafeInteger(amount) || amount < 0 || amount > game.maxAmount || amount % game.kcScale !== 0) throw new Error("Invalid theft");
    if (!validDonateMoney(actor.kc) || !validDonateMoney(actor.stolenKC ?? 0) || !validDonateMoney(victim.kc)) return false;
    if (actor.kc > game.maxAmount - amount || (actor.stolenKC ?? 0) > game.maxAmount - amount) return false;
    const credit = await this.donatePlayers.updateOne({
      _id: actor._id,
      thiefUntil: { $gt: now },
      $expr: { $and: [
        { $eq: ["$kc", { $trunc: "$kc" }] },
        { $eq: [{ $ifNull: ["$stolenKC", 0] }, { $trunc: { $ifNull: ["$stolenKC", 0] } }] }
      ] },
      $and: [
        { $or: [{ nextTheftAt: { $exists: false } }, { nextTheftAt: { $lte: now } }] },
        { $or: [{ stolenKC: { $exists: false } }, { stolenKC: { $gte: 0, $lte: game.maxAmount - amount } }] }
      ],
      kc: { $gte: 0, $lte: game.maxAmount - amount }
    }, { $inc: { kc: amount, stolenKC: amount }, $set: { nextTheftAt: new Date(now.getTime() + donateConfig.theftCooldownMs) } }, { session: this.donateSession });
    if (credit.matchedCount !== 1) return false;
    const debit = await this.donatePlayers.updateOne({ _id: victim._id, kc: { $gte: amount, $lte: game.maxAmount }, $expr: { $eq: ["$kc", { $trunc: "$kc" }] } }, { $inc: { kc: -amount } }, { session: this.donateSession });
    if (debit.matchedCount !== 1) throw new Error("Theft conflict");
    return true;
  }
  async dealer() {
    const state = await this.dealers.findOne({ _id: "casino" }, { session: this.donateSession });
    if (state === null || !Number.isSafeInteger(state.earnedKC) || state.earnedKC < 0 || state.earnedKC > game.maxAmount || !(state.nextChangeAt instanceof Date) || !Number.isFinite(state.nextChangeAt.getTime()) || state.holderId !== null && (!Number.isSafeInteger(state.holderId) || state.holderId <= 0)) throw new Error("Invalid dealer state");
    return state;
  }
  async hasCroupier(vkId) {
    return await this.donateItems.findOne({ vkId, kind: "croupier" }, { session: this.donateSession, projection: { _id: 1 } }) !== null;
  }
  async buyDealer(player, previous, state, now) {
    if (state.holderId === player._id) return "self";
    if (state.holderId === null && previous !== null) return "limit";
    if (!validDonateMoney(player.euro) || !validDonateMoney(state.earnedKC) || previous !== null && !validDonateMoney(previous.kc)) return "limit";
    if (state.nextChangeAt > now && !await this.hasCroupier(player._id)) return "cooldown";
    if (state.holderId !== null && (previous === null || previous._id !== state.holderId || previous.kc > game.maxAmount - state.earnedKC)) return "limit";
    const debit = await this.donatePlayers.updateOne({ _id: player._id, euro: { $gte: donateConfig.dealerCost, $lte: game.maxAmount }, $expr: { $eq: ["$euro", { $trunc: "$euro" }] } }, { $inc: { euro: -donateConfig.dealerCost }, $unset: { donateDraft: "" } }, { session: this.donateSession });
    if (debit.matchedCount !== 1) return "funds";
    if (previous !== null) {
      const credit = await this.donatePlayers.updateOne({ _id: previous._id, kc: { $gte: 0, $lte: game.maxAmount - state.earnedKC }, $expr: { $eq: ["$kc", { $trunc: "$kc" }] } }, { $inc: { kc: state.earnedKC } }, { session: this.donateSession });
      if (credit.matchedCount !== 1) throw new Error("Dealer payout conflict");
    }
    const changed = await this.dealers.updateOne({ _id: "casino", holderId: state.holderId, earnedKC: state.earnedKC, nextChangeAt: state.nextChangeAt }, { $set: {
      holderId: player._id,
      earnedKC: 0,
      nextChangeAt: new Date(now.getTime() + donateConfig.dealerCooldownMs)
    } }, { session: this.donateSession });
    if (changed.matchedCount !== 1) throw new Error("Dealer change conflict");
    return "ok";
  }
};

// src/repositories/mongo-bank.ts
var MongoBankStore = class extends MongoDonateStore {
  constructor(db, bankSession) {
    super(db, bankSession);
    this.bankSession = bankSession;
    this.bankPlayers = db.collection("players");
    this.bankDeposits = db.collection("deposits");
  }
  bankSession;
  bankPlayers;
  bankDeposits;
  async setBankDraft(vkId, draft) {
    const result = await this.bankPlayers.updateOne({ _id: vkId }, draft === null ? { $unset: { bankDraft: "" } } : { $set: { bankDraft: draft } }, { session: this.bankSession });
    if (result.matchedCount !== 1) throw new Error("Missing bank actor");
  }
  async saveSavings(player, balance, since, walletDelta) {
    if (!safeBankMoney(balance) || !Number.isSafeInteger(walletDelta) || !Number.isFinite(since.getTime())) throw new Error("Invalid savings change");
    const result = await this.bankPlayers.updateOne({
      _id: player._id,
      kc: { $gte: Math.max(0, -walletDelta), $lte: game.maxAmount - Math.max(0, walletDelta) },
      savingsBalance: player.savingsBalance ?? { $exists: false },
      savingsSince: player.savingsSince ?? { $exists: false },
      $expr: { $eq: ["$kc", { $trunc: "$kc" }] }
    }, { $inc: { kc: walletDelta }, $set: { savingsBalance: balance, savingsSince: since } }, { session: this.bankSession });
    return result.matchedCount === 1;
  }
  async transferMoney(sender, receiver, currency, gross, net) {
    if (!isBalanceCurrency(currency) || sender._id === receiver._id || !safeBankMoney(gross) || gross <= 0 || net !== transferNet(gross)) throw new Error("Invalid transfer");
    if (!safeBankMoney(sender[currency]) || !safeBankMoney(receiver[currency]) || receiver[currency] > game.maxAmount - net) return false;
    const debit = await this.bankPlayers.updateOne({ _id: sender._id, [currency]: { $gte: gross, $lte: game.maxAmount }, $expr: { $eq: [`$${currency}`, { $trunc: `$${currency}` }] } }, { $inc: { [currency]: -gross } }, { session: this.bankSession });
    if (debit.matchedCount !== 1) return false;
    const credit = await this.bankPlayers.updateOne({ _id: receiver._id, [currency]: { $gte: 0, $lte: game.maxAmount - net }, $expr: { $eq: [`$${currency}`, { $trunc: `$${currency}` }] } }, { $inc: { [currency]: net } }, { session: this.bankSession });
    if (credit.matchedCount !== 1) throw new Error("Transfer conflict");
    return true;
  }
  async claimPension(player, amount, now) {
    const age = player.registeredAt === void 0 ? 0 : bankDays(player.registeredAt, now);
    const rewards = age > bankConfig.pensionHighDays ? bankConfig.pensionHigh : bankConfig.pensionBasic;
    if (age < bankConfig.pensionMinDays || !rewards.some((value) => value * game.kcScale === amount)) throw new Error("Invalid pension");
    const result = await this.bankPlayers.updateOne({
      _id: player._id,
      registeredAt: { $lte: new Date(now.getTime() - bankConfig.pensionMinDays * bankConfig.dayMs) },
      $or: [{ nextPensionAt: { $exists: false } }, { nextPensionAt: { $lte: now } }],
      kc: { $gte: 0, $lte: game.maxAmount - amount },
      $expr: { $eq: ["$kc", { $trunc: "$kc" }] }
    }, { $inc: { kc: amount }, $set: { nextPensionAt: new Date(now.getTime() + bankConfig.dayMs) } }, { session: this.bankSession });
    return result.matchedCount === 1;
  }
  async deposits(vkId) {
    return this.bankDeposits.find({ vkId, state: "active" }, { session: this.bankSession }).sort({ depositId: 1 }).limit(bankConfig.maxDeposits + 1).toArray();
  }
  async deposit(vkId, depositId) {
    return this.bankDeposits.findOne({ vkId, depositId, state: "active" }, { session: this.bankSession });
  }
  async nextDueDeposit(now) {
    return this.bankDeposits.find({ state: "active", nextAttemptAt: { $lte: now }, expiresAt: { $lte: now } }, { session: this.bankSession }).sort({ nextAttemptAt: 1, _id: 1 }).limit(1).next();
  }
  async createDeposit(player, amount, days, now) {
    if (!safeBankMoney(amount) || amount <= 0 || amount > bankConfig.maxDeposit || !isDepositDays(days)) throw new Error("Invalid deposit creation");
    if ((await this.deposits(player._id)).length >= bankConfig.maxDeposits) return "limit";
    const id = player.nextDepositId ?? 1;
    if (!Number.isSafeInteger(id) || id < 1 || id >= game.maxAmount) return "limit";
    const debit = await this.bankPlayers.updateOne({
      _id: player._id,
      kc: { $gte: amount, $lte: game.maxAmount },
      nextDepositId: player.nextDepositId ?? { $exists: false },
      $expr: { $eq: ["$kc", { $trunc: "$kc" }] }
    }, { $inc: { kc: -amount }, $set: { nextDepositId: id + 1 }, $unset: { bankDraft: "" } }, { session: this.bankSession });
    if (debit.matchedCount !== 1) return "funds";
    const expiresAt = new Date(now.getTime() + days * bankConfig.dayMs);
    const deposit = { _id: `${player._id}:${id}`, vkId: player._id, depositId: id, amount, days, createdAt: now, expiresAt, nextAttemptAt: expiresAt, state: "active" };
    if (!(await this.bankDeposits.insertOne(deposit, { session: this.bankSession })).acknowledged) throw new Error("Deposit insert failed");
    return deposit;
  }
  async closeDeposit(player, deposit, payout, now, early) {
    if (deposit.vkId !== player._id || payout !== (early ? earlyDepositValue(deposit, now) : depositValue(deposit, deposit.expiresAt))) throw new Error("Invalid deposit payout");
    if (!safeBankMoney(player.kc) || player.kc > game.maxAmount - payout) return false;
    const claimed = await this.bankDeposits.updateOne({
      _id: deposit._id,
      vkId: player._id,
      state: "active",
      expiresAt: early ? { $gt: now } : { $lte: now },
      $expr: early ? { $gt: ["$expiresAt", "$$NOW"] } : { $lte: ["$expiresAt", "$$NOW"] }
    }, { $set: { state: early ? "early" : "completed" } }, { session: this.bankSession });
    if (claimed.matchedCount !== 1) return false;
    const credited = await this.bankPlayers.updateOne({ _id: player._id, kc: { $gte: 0, $lte: game.maxAmount - payout }, $expr: { $eq: ["$kc", { $trunc: "$kc" }] } }, { $inc: { kc: payout } }, { session: this.bankSession });
    if (credited.matchedCount !== 1) throw new Error("Deposit payout conflict");
    return true;
  }
  async deferDeposit(deposit, now) {
    await this.bankDeposits.updateOne({ _id: deposit._id, state: "active" }, { $set: { nextAttemptAt: new Date(now.getTime() + bankConfig.retryMs) } }, { session: this.bankSession });
  }
};

// src/repositories/mongo-casino.ts
var MongoCasinoStore = class extends MongoBankStore {
  constructor(db, casinoSession) {
    super(db, casinoSession);
    this.casinoSession = casinoSession;
    this.casinoPlayers = db.collection("players");
    this.records = db.collection("casino_records");
    this.notices = db.collection("notifications");
    this.casinoDealers = db.collection("dealer");
  }
  casinoSession;
  casinoPlayers;
  records;
  notices;
  casinoDealers;
  async setDirectorDraft(vkId, draft) {
    const result = await this.casinoPlayers.updateOne({ _id: vkId }, draft === null ? { $unset: { directorDraft: "" } } : { $set: { directorDraft: draft } }, { session: this.casinoSession });
    if (result.matchedCount !== 1) throw new Error("Missing director actor");
  }
  async casinoGet(id) {
    return this.records.findOne({ _id: id }, { session: this.casinoSession });
  }
  async casinoList(query, limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > accountCapacity) throw new Error("Invalid casino query bound");
    let filter;
    switch (query.kind) {
      case "dice_chat":
        filter = { kind: "dice_chat", dueAt: { $lte: query.dueAt } };
        break;
      case "dice_credit":
        filter = { kind: "dice_credit", stage: "pending", dueAt: { $lte: query.dueAt } };
        break;
      case "jackpot_entries":
        filter = { kind: "jackpot_entry", roundId: query.roundId, _id: { $gt: query.after } };
        break;
      case "jackpot_draw":
        filter = { kind: "jackpot_draw", stage: "broadcast", dueAt: { $lte: query.dueAt } };
        break;
      case "roulette_photo":
        filter = { kind: "round", mode: "roulette", stage: { $in: ["open", "closed", "waiting", "settling", "announcing"] }, _id: { $gt: query.after } };
        break;
      case "round":
        filter = { kind: "round", stage: { $in: ["open", "closed", "waiting", "settling", "announcing"] }, dueAt: { $lte: query.dueAt } };
        break;
      case "election":
        filter = { kind: "election", stage: { $in: ["refunds", "broadcast"] }, dueAt: { $lte: query.dueAt } };
        break;
      case "credit":
        filter = { kind: "credit", stage: "pending", dueAt: { $lte: query.dueAt } };
        break;
      case "delivery":
        filter = { kind: "delivery", stage: "pending", dueAt: { $lte: query.dueAt } };
        break;
      case "bet":
        filter = { kind: "bet", roundId: query.roundId, ...query.vkId === void 0 ? {} : { vkId: query.vkId }, ...query.settled === void 0 ? {} : { settled: query.settled } };
        break;
      case "bid":
        filter = { kind: "bid", electionId: query.electionId, ...query.settled === void 0 ? {} : { settled: query.settled } };
        break;
      case "chat":
        filter = { kind: "chat", active: true, _id: { $gt: query.after } };
        break;
    }
    return this.records.find(filter, { session: this.casinoSession }).sort(query.kind === "bet" || query.kind === "bid" || query.kind === "chat" || query.kind === "roulette_photo" || query.kind === "jackpot_entries" ? { _id: 1 } : { dueAt: 1, _id: 1 }).limit(limit).toArray();
  }
  async casinoInsert(record) {
    if (record.version !== 0) throw new Error("Invalid initial casino version");
    if (!(await this.records.insertOne(record, { session: this.casinoSession })).acknowledged) throw new Error("Casino insert failed");
  }
  async casinoSave(record, notAfter) {
    if (!Number.isSafeInteger(record.version) || record.version < 0 || record.version >= game.maxAmount) throw new Error("Invalid casino revision");
    if (notAfter !== void 0 && !Number.isFinite(notAfter.getTime())) throw new Error("Invalid casino deadline");
    const result = await this.records.replaceOne({ _id: record._id, kind: record.kind, version: record.version, ...notAfter === void 0 ? {} : { $expr: { $lt: ["$$NOW", notAfter] } } }, { ...record, version: record.version + 1 }, { session: this.casinoSession });
    if (result.matchedCount !== 1) throw new DuplicateWriteError();
    record.version += 1;
  }
  async casinoNotificationDone(id) {
    return await this.notices.findOne({ _id: id, state: { $in: ["sent", "failed"] } }, { session: this.casinoSession, projection: { _id: 1 } }) !== null;
  }
  async casinoDealerIncome(vkId, amount) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > game.maxAmount) throw new Error("Invalid casino income");
    const result = await this.casinoDealers.updateOne({ _id: "casino", holderId: vkId, earnedKC: { $gte: 0, $lte: game.maxAmount - amount }, $expr: { $eq: ["$earnedKC", { $trunc: "$earnedKC" }] } }, { $inc: { earnedKC: amount } }, { session: this.casinoSession });
    return result.matchedCount === 1;
  }
};

// src/repositories/mongo.ts
import { MongoBulkWriteError, MongoServerError as MongoServerError4 } from "mongodb";

// src/services/rules.ts
function bonusDay(player, now) {
  if (player.lastBonusAt === null || now.getTime() - player.lastBonusAt.getTime() >= game.bonusResetMs) {
    return 1;
  }
  return player.bonusDay % game.rewards.length + 1;
}
function rewardForDay(day) {
  const reward = game.rewards[day - 1];
  if (!Number.isSafeInteger(day) || reward === void 0) {
    throw new Error("Invalid bonus day");
  }
  return reward;
}
function availableAccountIds(taken) {
  const occupied = new Set(taken);
  return Array.from(
    { length: game.randomAccountMax - game.randomAccountMin + 1 },
    (_, index) => index + game.randomAccountMin
  ).filter((id) => !occupied.has(id));
}
function normalizeName(name) {
  const safe = name.replace(/[\[\]|@*\r\n\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 80);
  return safe || "Игрок";
}

// src/services/mining.ts
import { randomInt as randomInt2 } from "node:crypto";
function initialFarm() {
  return {
    rate: game.mining.initialRate,
    balance: 0,
    remainder: 0,
    level: 0,
    upgradeCost: game.mining.prices[0],
    updatedAt: /* @__PURE__ */ new Date(0),
    activeUntil: /* @__PURE__ */ new Date(0)
  };
}
function settleFarm(farm, now) {
  if ([farm.rate, farm.balance, farm.remainder, farm.level, farm.upgradeCost].some((value) => !Number.isSafeInteger(value) || value < 0 || value > game.maxAmount) || farm.rate === 0 || farm.upgradeCost === 0 || farm.remainder >= game.mining.hourMs || !Number.isFinite(now.getTime()) || !Number.isFinite(farm.updatedAt.getTime()) || !Number.isFinite(farm.activeUntil.getTime())) {
    throw new Error("Invalid mining state");
  }
  const end = Math.min(now.getTime(), farm.activeUntil.getTime());
  const elapsed = Math.max(0, end - farm.updatedAt.getTime());
  const numerator = BigInt(farm.rate) * BigInt(elapsed) + BigInt(farm.remainder);
  const amount = BigInt(farm.balance) + numerator / BigInt(game.mining.hourMs);
  const capped = amount >= BigInt(game.maxAmount);
  return {
    ...farm,
    balance: capped ? game.maxAmount : Number(amount),
    remainder: capped ? 0 : Number(numerator % BigInt(game.mining.hourMs)),
    updatedAt: new Date(Math.max(now.getTime(), farm.updatedAt.getTime()))
  };
}
function nextUpgradeCost(level, current) {
  if (!Number.isSafeInteger(level) || level < 0 || !Number.isSafeInteger(current) || current <= 0) {
    throw new Error("Invalid upgrade cost");
  }
  const listed = game.mining.prices[level + 1];
  if (listed !== void 0) {
    return listed;
  }
  const numerator = BigInt(current) * BigInt(game.mining.growthNumerator);
  const unit = BigInt(game.mining.growthDenominator) * BigInt(game.mining.precision);
  const cost = (numerator + unit - 1n) / unit * BigInt(game.mining.precision);
  return cost <= BigInt(game.maxAmount) ? Number(cost) : null;
}
function randomMiningIncrease() {
  return randomInt2(
    game.mining.minIncrease / game.mining.precision,
    game.mining.maxIncrease / game.mining.precision + 1
  ) * game.mining.precision;
}

// src/repositories/mongo.ts
var MongoGameDatabase = class {
  constructor(client, database) {
    this.client = client;
    this.db = client.db(database);
  }
  client;
  db;
  async initialize() {
    const hello = await this.db.command({ hello: 1 });
    if (!isRecord(hello) || typeof hello.setName !== "string" && hello.msg !== "isdbgrid") {
      throw new Error("MongoDB replica set is required");
    }
    await this.db.collection("mailing_campaigns").createIndex({ state: 1, createdAt: 1, _id: 1 });
    await this.db.collection("notifications").createIndex({ state: 1, priority: 1, nextAttemptAt: 1 });
    await migrateMailingRecipients(this.db);
    await this.db.collection("casino_records").createIndexes([
      { key: { kind: 1, stage: 1, dueAt: 1, _id: 1 } },
      { key: { kind: 1, dueAt: 1, _id: 1 } },
      { key: { kind: 1, roundId: 1, settled: 1, _id: 1 } },
      { key: { kind: 1, roundId: 1, _id: 1 } },
      { key: { kind: 1, roundId: 1, vkId: 1, _id: 1 } },
      { key: { kind: 1, electionId: 1, settled: 1, _id: 1 } },
      { key: { kind: 1, active: 1, _id: 1 } },
      { key: { kind: 1, mode: 1, stage: 1, _id: 1 } }
    ]);
    await this.db.collection("deposits").createIndex({ vkId: 1, state: 1, depositId: 1 });
    await this.db.collection("deposits").createIndex({ vkId: 1, depositId: 1 }, { unique: true });
    await this.db.collection("deposits").createIndex({ state: 1, nextAttemptAt: 1, _id: 1 });
    const registrationMigration = await this.db.collection("players").updateMany({ registeredAt: { $exists: false } }, [{ $set: { registeredAt: "$$NOW" } }]);
    if (!registrationMigration.acknowledged || registrationMigration.modifiedCount !== registrationMigration.matchedCount) throw new Error("Registration date migration failed");
    const dealer = await this.db.collection("dealer").updateOne({ _id: "casino" }, { $setOnInsert: { holderId: null, earnedKC: 0, nextChangeAt: /* @__PURE__ */ new Date(0) } }, { upsert: true });
    if (!dealer.acknowledged || dealer.matchedCount + dealer.upsertedCount !== 1) throw new Error("Dealer initialization failed");
    await this.db.collection("item_offers").createIndex({ buyerId: 1, state: 1, expiresAt: 1 });
    await this.db.collection("inventory").createIndex({ vkId: 1, kind: 1, reservedUntil: 1, itemId: 1 });
    await this.db.collection("inventory").createIndex({ offerId: 1, vkId: 1 });
    await this.db.collection("promos").createIndex({ ownerId: 1, _id: 1 }, { collation: { locale: "simple" } });
    await this.db.collection("promo_redemptions").createIndex({ promoName: 1, vkId: 1 }, { unique: true, collation: { locale: "simple" } });
    await this.db.collection("players").createIndex({ accountId: 1 }, { unique: true });
    await this.db.collection("inventory").createIndex({ vkId: 1, itemId: 1 }, { unique: true });
    await this.db.collection("processed_messages").createIndex({ _id: 1 });
    await this.db.collection("notifications").createIndex({ state: 1, nextAttemptAt: 1 });
    await this.db.collection("players").createIndexes(Object.entries(rankingFields).map(([metric, field]) => ({
      key: { [field]: -1, accountId: 1 },
      name: `ranking_${metric}`
    })));
    const migration = await this.db.collection("players").updateMany({ $or: [
      { mining: { $exists: false } },
      { referrals: { $exists: false } },
      { stolenKC: { $exists: false } }
    ] }, [{ $set: {
      mining: { $ifNull: ["$mining", { $literal: initialFarm() }] },
      referrals: { $ifNull: ["$referrals", 0] },
      stolenKC: { $ifNull: ["$stolenKC", 0] }
    } }]);
    if (!migration.acknowledged || migration.modifiedCount !== migration.matchedCount) {
      throw new Error("Player migration failed");
    }
    const ids = ["registrations", "responses"];
    const result = await this.db.collection("counters").bulkWrite(ids.map((_id) => ({
      updateOne: { filter: { _id }, update: { $setOnInsert: { value: 0 } }, upsert: true }
    })), { ordered: false }).catch((error) => {
      if (error instanceof MongoBulkWriteError && error.err === void 0) {
        const writes = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
        if (writes.length > 0 && writes.every((write) => write.code === 11e3)) {
          return null;
        }
      }
      throw error;
    });
    if (result !== null && result.matchedCount + result.upsertedCount !== ids.length) {
      throw new Error("Counter initialization failed");
    }
    if (result === null && await this.db.collection("counters").countDocuments(
      { _id: { $in: [...ids] } },
      { limit: ids.length }
    ) !== ids.length) {
      throw new Error("Concurrent counter initialization failed");
    }
  }
  async recordChat(peerId, active = true) {
    if (!Number.isSafeInteger(peerId) || peerId <= 2e9 || peerId > Number.MAX_SAFE_INTEGER) throw new Error("Invalid chat peer");
    const records = this.db.collection("casino_records");
    const filter = { _id: `chat:${peerId}`, kind: "chat" };
    const result = await records.updateOne(filter, { $set: { active, peerId }, $setOnInsert: { kind: "chat", version: 0 } }, { upsert: true }).catch(async (error) => {
      if (!(error instanceof MongoServerError4) || error.code !== 11e3) throw error;
      return records.updateOne(filter, { $set: { active, peerId } });
    });
    if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new Error("Chat registry update failed");
  }
  async leaseNotification(leaseId) {
    return this.db.collection("notifications").findOneAndUpdate(
      { state: "pending", $expr: { $lte: ["$nextAttemptAt", "$$NOW"] } },
      [{ $set: {
        leaseId,
        nextAttemptAt: { $add: ["$$NOW", game.notificationLeaseMs] },
        attempts: { $add: ["$attempts", 1] }
      } }],
      { sort: { priority: 1, nextAttemptAt: 1 }, returnDocument: "after", includeResultMetadata: false }
    );
  }
  async finishNotification(id, leaseId, state, delayMs) {
    const result = await this.db.collection("notifications").updateOne(
      { _id: id, state: "pending", leaseId },
      [{ $set: { state, nextAttemptAt: { $add: ["$$NOW", delayMs] } } }, { $unset: "leaseId" }]
    );
    if (result.matchedCount !== 1) {
      throw new Error("Notification lease was lost");
    }
  }
  async hasPlayer(vkId) {
    return await this.db.collection("players").findOne(
      { _id: vkId },
      { projection: { _id: 1 } }
    ) !== null;
  }
  async transaction(action) {
    try {
      return await this.client.withSession(async (session) => session.withTransaction(
        async () => action(new MongoGameStore(this.db, session)),
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 2e4 }
      ));
    } catch (error) {
      if (error instanceof MongoServerError4 && error.code === 11e3) {
        throw new DuplicateWriteError();
      }
      throw error;
    }
  }
};
var MongoGameStore = class extends MongoCasinoStore {
  constructor(db, session) {
    super(db, session);
    this.session = session;
    this.players = db.collection("players");
    this.items = db.collection("inventory");
    this.messages = db.collection("processed_messages");
    this.counters = db.collection("counters");
    this.notifications = db.collection("notifications");
    this.mailingCampaigns = db.collection("mailing_campaigns");
    this.mailingAudience = db.collection("mailing_recipients");
  }
  session;
  queuedNotifications = false;
  notificationsQueued() {
    return this.queuedNotifications;
  }
  players;
  items;
  messages;
  counters;
  notifications;
  mailingCampaigns;
  mailingAudience;
  async setCoinOpen(vkId, open2) {
    const result = await this.players.updateOne({ _id: vkId }, open2 ? { $set: { coinOpen: true } } : { $unset: { coinOpen: "" } }, { session: this.session });
    if (result.matchedCount !== 1) throw new Error("Missing coin player");
  }
  async updateKC(vkId, operation, amount) {
    return this.updateBalance(vkId, "kc", operation, amount);
  }
  async updateBalance(vkId, currency, operation, amount) {
    if (!isBalanceCurrency(currency) || !validBalanceChange(operation, amount)) {
      throw new Error("Invalid balance change");
    }
    const filter = operation === "set" ? { _id: vkId } : {
      _id: vkId,
      [currency]: { $gte: operation === "take" ? amount : 0, $lte: operation === "add" ? game.maxAmount - amount : game.maxAmount },
      $expr: { $eq: [`$${currency}`, { $trunc: `$${currency}` }] }
    };
    const update = operation === "set" ? { $set: { [currency]: amount } } : { $inc: { [currency]: operation === "take" ? -amount : amount } };
    const result = await this.players.updateOne(filter, update, { session: this.session });
    return result.matchedCount === 1;
  }
  async joinMailing(vkId, now) {
    const result = await this.mailingAudience.updateOne({ _id: vkId }, [{ $set: { joinedAt: { $ifNull: ["$joinedAt", now ?? "$$NOW"] } } }], { upsert: true, session: this.session });
    if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new Error("Mailing recipient write failed");
  }
  async createMailing(campaign) {
    if (!(await this.mailingCampaigns.insertOne(campaign, { session: this.session })).acknowledged) throw new Error("Mailing creation failed");
  }
  async pendingMailing() {
    return this.mailingCampaigns.findOne({ state: "pending" }, { sort: { createdAt: 1, _id: 1 }, session: this.session });
  }
  async mailingRecipients(after, until) {
    return (await this.mailingAudience.find({ _id: { $gt: after }, joinedAt: { $lte: until } }, { projection: { _id: 1 }, session: this.session }).sort({ _id: 1 }).limit(mailingConfig.batchSize).toArray()).map((recipient) => recipient._id);
  }
  async saveMailing(campaign) {
    const result = await this.mailingCampaigns.replaceOne({ _id: campaign._id, version: campaign.version }, { ...campaign, version: campaign.version + 1 }, { session: this.session });
    if (result.matchedCount !== 1) throw new DuplicateWriteError();
  }
  async enqueueMailing(id, vkId, text) {
    const result = await this.notifications.insertOne({
      _id: id,
      peerId: vkId,
      text,
      randomId: await this.nextRandomId(),
      priority: 1,
      state: "pending",
      nextAttemptAt: /* @__PURE__ */ new Date(0),
      attempts: 0
    }, { session: this.session });
    if (!result.acknowledged) throw new Error("Mailing notification insert failed");
    this.queuedNotifications = true;
  }
  async enqueueItemNotification(id, peerId, text, keyboard, roulettePhoto) {
    if (roulettePhoto !== void 0 && (!Number.isSafeInteger(roulettePhoto) || roulettePhoto < 0 || roulettePhoto >= rouletteConfig.numbers)) throw new Error("Invalid roulette photo");
    const result = await this.notifications.insertOne({
      _id: id,
      peerId,
      text,
      keyboard,
      ...roulettePhoto === void 0 ? {} : { roulettePhoto },
      randomId: await this.nextRandomId(),
      state: "pending",
      nextAttemptAt: /* @__PURE__ */ new Date(0),
      attempts: 0
    }, { session: this.session });
    if (!result.acknowledged) {
      throw new Error("Item notification insert failed");
    }
    this.queuedNotifications = true;
  }
  async processed(eventId) {
    return this.messages.findOne({ _id: eventId }, { session: this.session });
  }
  async nextRandomId() {
    const counter = await this.counters.findOneAndUpdate(
      { _id: "responses", value: { $gte: 0, $lt: game.maxRandomId } },
      { $inc: { value: 1 } },
      { session: this.session, returnDocument: "after", includeResultMetadata: false }
    );
    if (counter === null) {
      throw new Error("Response ID range is exhausted");
    }
    return counter.value;
  }
  async remember(input, reply3) {
    const prepared = { ...reply3, randomId: await this.nextRandomId() };
    const result = await this.messages.insertOne(
      { _id: input.eventId, vkId: input.vkId, reply: prepared },
      { session: this.session }
    );
    if (!result.acknowledged) {
      throw new Error("Message record was not acknowledged");
    }
    return prepared;
  }
  async player(vkId) {
    return this.players.findOne({ _id: vkId }, { session: this.session });
  }
  async register(vkId, name) {
    const counter = await this.counters.findOneAndUpdate(
      { _id: "registrations", value: { $gte: 0, $lt: accountCapacity } },
      { $inc: { value: 1 } },
      { session: this.session, returnDocument: "before", includeResultMetadata: false }
    );
    if (counter === null) {
      return null;
    }
    let accountId = counter.value;
    if (accountId >= game.sequentialAccounts) {
      const taken = await this.players.find(
        { accountId: { $gte: game.randomAccountMin, $lte: game.randomAccountMax } },
        { session: this.session, projection: { accountId: 1, _id: 0 } }
      ).limit(accountCapacity).toArray();
      const available = availableAccountIds(taken.map((player2) => player2.accountId));
      const selected = available.length > 0 ? available[randomInt3(available.length)] : void 0;
      if (selected === void 0) {
        throw new Error("Account counter is inconsistent");
      }
      accountId = selected;
    }
    const player = {
      _id: vkId,
      accountId,
      name,
      kc: 0,
      euro: 0,
      bitcoin: 0,
      reputation: 0,
      completedTasks: 0,
      bonusDay: 0,
      lastBonusAt: null,
      nextBonusAt: /* @__PURE__ */ new Date(0),
      nextItemId: 1,
      mining: initialFarm(),
      referrals: 0,
      stolenKC: 0,
      registeredAt: await this.now()
    };
    const result = await this.players.insertOne(player, { session: this.session });
    if (!result.acknowledged) {
      throw new Error("Registration was not acknowledged");
    }
    return player;
  }
  async now() {
    const value = await this.counters.aggregate([
      { $match: { _id: "registrations" } },
      { $project: { _id: 0, now: "$$NOW" } },
      { $limit: 1 }
    ], { session: this.session }).next();
    if (value === null || !(value.now instanceof Date) || !Number.isFinite(value.now.getTime())) {
      throw new Error("Database time is unavailable");
    }
    return value.now;
  }
  async claim(player, day, reward, now) {
    const updated = await this.players.findOneAndUpdate(
      {
        _id: player._id,
        bonusDay: player.bonusDay,
        lastBonusAt: player.lastBonusAt,
        nextBonusAt: { $lte: now },
        kc: { $gte: 0, $lte: game.maxAmount - reward.kc },
        bitcoin: { $gte: 0, $lte: game.maxAmount - reward.bitcoin },
        nextItemId: { $gte: 1, $lte: game.maxAmount - (reward.case ? 1 : 0) }
      },
      {
        $inc: { kc: reward.kc, bitcoin: reward.bitcoin, nextItemId: reward.case ? 1 : 0 },
        $set: { bonusDay: day, lastBonusAt: now, nextBonusAt: new Date(now.getTime() + game.bonusIntervalMs) }
      },
      { session: this.session, returnDocument: "after", includeResultMetadata: false, projection: { _id: 1 } }
    );
    if (updated === null) {
      return false;
    }
    if (reward.case) {
      const result = await this.items.insertOne({
        _id: `${player._id}:${player.nextItemId}`,
        vkId: player._id,
        itemId: player.nextItemId,
        kind: "zhdun_case"
      }, { session: this.session });
      if (!result.acknowledged) {
        throw new Error("Inventory insert was not acknowledged");
      }
    }
    return true;
  }
  async inventory(vkId, page) {
    return this.inventoryStacks(vkId, page * game.inventoryPageSize, game.inventoryPageSize + 1);
  }
  async inventoryAll(vkId) {
    return this.inventoryStacks(vkId, 0, game.chatInventoryLimit + 1);
  }
  async inventoryStacks(vkId, offset, limit) {
    return this.items.aggregate([
      { $match: { vkId } },
      { $group: { _id: "$kind", itemId: { $min: "$itemId" }, quantity: { $sum: 1 } } },
      { $project: { _id: 0, kind: "$_id", itemId: 1, quantity: 1 } },
      { $sort: { itemId: 1 } },
      { $skip: offset },
      { $limit: limit }
    ], { session: this.session }).toArray();
  }
  async saveMining(player, farm, bitcoinDelta) {
    const result = await this.players.updateOne({
      _id: player._id,
      mining: player.mining ?? { $exists: false },
      bitcoin: { $gte: Math.max(0, -bitcoinDelta), $lte: game.maxAmount - Math.max(0, bitcoinDelta) }
    }, { $set: { mining: farm }, $inc: { bitcoin: bitcoinDelta } }, { session: this.session });
    return result.matchedCount === 1;
  }
  async ranking(metric, player) {
    const field = rankingFields[metric];
    const score = rankingScore(player, metric);
    const leaders = await this.players.find({}, {
      session: this.session,
      projection: { _id: 1, name: 1, accountId: 1, [field]: 1 }
    }).sort({ [field]: -1, accountId: 1 }).limit(game.leaderboardSize).toArray();
    const ahead = await this.players.countDocuments({ $or: [
      { [field]: { $gt: score } },
      { [field]: score, accountId: { $lt: player.accountId } }
    ] }, { session: this.session });
    return {
      leaders: leaders.map((leader) => ({
        _id: leader._id,
        name: leader.name,
        accountId: leader.accountId,
        score: rankingScore(leader, metric)
      })),
      place: ahead + 1
    };
  }
  async saveReferralUrl(vkId, url) {
    const result = await this.players.updateOne({ _id: vkId }, { $set: { referralUrl: url } }, { session: this.session });
    if (result.matchedCount !== 1) {
      throw new Error("Referral link owner was not found");
    }
  }
  async rewardReferral(inviter, newcomer, text) {
    if (inviter._id === newcomer._id) {
      throw new Error("Self referral is not allowed");
    }
    const result = await this.players.updateOne({
      _id: inviter._id,
      kc: { $gte: 0, $lte: game.maxAmount - game.referralRewardKC },
      referrals: { $gte: 0, $lt: game.maxAmount },
      nextItemId: { $eq: inviter.nextItemId, $gte: 1, $lt: game.maxAmount }
    }, { $inc: { kc: game.referralRewardKC, referrals: 1, nextItemId: 1 } }, { session: this.session });
    if (result.matchedCount !== 1) {
      throw new Error("Referral reward limits exceeded");
    }
    const item = await this.items.insertOne({
      _id: `${inviter._id}:${inviter.nextItemId}`,
      vkId: inviter._id,
      itemId: inviter.nextItemId,
      kind: "referral_case"
    }, { session: this.session });
    const notification = await this.notifications.insertOne({
      _id: `referral:${newcomer._id}`,
      peerId: inviter._id,
      text,
      randomId: await this.nextRandomId(),
      state: "pending",
      nextAttemptAt: /* @__PURE__ */ new Date(0),
      attempts: 0
    }, { session: this.session });
    if (!item.acknowledged || !notification.acknowledged) {
      throw new Error("Referral reward was not acknowledged");
    }
    this.queuedNotifications = true;
  }
};

// src/services/giveaway.ts
import { createHash as createHash2 } from "node:crypto";
var reply2 = (text = "") => ({ text, keyboard: { kind: "none" } });
async function currentGiveaway(store, peerId) {
  const state = await store.casinoGet(giveawayKey(peerId));
  if (state === null) return null;
  if (state.kind !== "giveaway") throw new Error("Invalid giveaway record");
  validateGiveaway(state);
  return state;
}
async function prepareGiveawayClaim(store, input, command) {
  if (!input.isChat || !validGiveawayPeer(input.peerId)) return reply2();
  if (command.peerId !== input.peerId) return reply2(giveawayTexts.old);
  const state = await currentGiveaway(store, input.peerId);
  if (state === null || state.token !== command.token) return reply2(giveawayTexts.old);
  if (state.stage !== "active") return reply2(giveawayTexts.ended);
  if (command.kind === "giveaway_claim") {
    const claim = await store.casinoGet(giveawayClaimKey(input.peerId, command.token, input.vkId));
    if (claim !== null) {
      if (claim.kind !== "giveaway_claim" || claim.vkId !== input.vkId) throw new Error("Invalid giveaway claim record");
      return reply2(giveawayTexts.already);
    }
  }
  return state;
}
async function giveawayAdminAction(store, input, command) {
  if (command.kind === "giveaway_claim") throw new Error("Giveaway claim requires a player");
  if (!adminIds.has(input.vkId)) throw new Error("Administrator access is required");
  if (!input.isChat || !validGiveawayPeer(input.peerId)) return reply2();
  if (command.kind === "force_invalid") return reply2(giveawayTexts.usage);
  if (command.kind === "giveaway_cancel") {
    const state2 = await prepareGiveawayClaim(store, input, command);
    if ("text" in state2) return state2;
    state2.stage = "cancelled";
    await store.casinoSave(state2);
    return reply2(giveawayCancelled(state2));
  }
  if (!validGiveawayCount(command.count) || !validGiveawayReward(command.reward)) return reply2(giveawayTexts.usage);
  const previous = await currentGiveaway(store, input.peerId);
  const state = {
    _id: giveawayKey(input.peerId),
    kind: "giveaway",
    version: previous?.version ?? 0,
    peerId: input.peerId,
    token: createHash2("sha256").update(input.eventId).digest("hex"),
    reward: command.reward,
    count: command.count,
    remaining: command.count,
    stage: "active"
  };
  if (previous === null) await store.casinoInsert(state);
  else await store.casinoSave(state);
  return { text: giveawayStarted(state), keyboard: { kind: "giveaway", peerId: input.peerId, token: state.token } };
}
async function claimGiveaway(store, input, player, command, prepared) {
  if (command.kind !== "giveaway_claim" || input.vkId !== player._id) throw new Error("Invalid giveaway claimant");
  const state = prepared ?? await prepareGiveawayClaim(store, input, command);
  if ("text" in state) return state;
  validateGiveaway(state);
  if (!input.isChat || !validGiveawayPeer(input.peerId)) return reply2();
  if (state.peerId !== input.peerId || command.peerId !== input.peerId || state.token !== command.token) return reply2(giveawayTexts.old);
  if (state.stage !== "active") return reply2(giveawayTexts.ended);
  const reward = state.reward;
  const paid = reward.kind === "currency" ? await store.updateBalance(input.vkId, reward.currency, "add", reward.amount) : await store.grantItems(input.vkId, reward.itemKind, reward.quantity);
  if (!paid) return reply2(giveawayTexts.limit);
  await store.casinoInsert({ _id: giveawayClaimKey(command.peerId, command.token, input.vkId), kind: "giveaway_claim", version: 0, vkId: input.vkId });
  state.remaining -= 1;
  if (state.remaining === 0) state.stage = "finished";
  await store.casinoSave(state);
  return reply2(giveawayClaimed(state, player));
}

// src/services/coin-rules.ts
import { createHash as createHash3 } from "node:crypto";
function coinMultiplier(step) {
  const value = privateCasinoConfig.coinMultipliers[step - 1];
  if (value === void 0 || !Number.isSafeInteger(step)) throw new Error("Invalid coin step");
  return value;
}
function coinPayout(amount, step) {
  if (!safeBankMoney(amount)) throw new Error("Invalid coin amount");
  const value = BigInt(amount) * BigInt(coinMultiplier(step)) / BigInt(privateCasinoConfig.multiplierScale);
  return value > BigInt(game.maxAmount) ? null : Number(value);
}
function coinActive(state) {
  return state.stage === "staked" || state.stage === "playing";
}
function coinKey(vkId) {
  return `coin:${vkId}`;
}
function coinSession(eventId) {
  return createHash3("sha256").update(eventId).digest("hex");
}

// src/services/coin.ts
async function coinState(store, vkId) {
  const state = await store.casinoGet(coinKey(vkId));
  if (state === null) return null;
  if (state.kind !== "coin" || state.vkId !== vkId || !safeBankMoney(state.amount) || state.history.length > privateCasinoConfig.coinMultipliers.length || state.history.some((side) => side !== "diamond" && side !== "emerald") || coinActive(state) && state.amount < privateCasinoConfig.coinMinimum || state.stage === "staked" && state.history.length !== 0 || state.stage === "playing" && (state.history.length === 0 || state.history.length >= privateCasinoConfig.coinMultipliers.length)) throw new Error("Invalid coin state");
  return state;
}
function coinReply(text, state) {
  return { text, keyboard: { kind: "coin", token: state.sessionId, step: state.history.length } };
}
async function saveCoin(store, state, exists) {
  if (exists) await store.casinoSave(state);
  else await store.casinoInsert(state);
}
async function openCoin(store, player, input) {
  const previous = await coinState(store, player._id);
  await store.setCoinOpen(player._id, true);
  if (previous !== null && coinActive(previous)) {
    const payout = previous.history.length === 0 ? null : coinPayout(previous.amount, previous.history.length);
    return coinReply(payout === null ? coinStakeText(previous.amount) : coinWinText(previous, coinMultiplier(previous.history.length), payout, player.kc), previous);
  }
  const state = {
    _id: coinKey(player._id),
    kind: "coin",
    version: previous?.version ?? 0,
    vkId: player._id,
    sessionId: coinSession(input.eventId),
    stage: "ready",
    amount: 0,
    history: []
  };
  await saveCoin(store, state, previous !== null);
  return coinReply(privateCasinoTexts.intro, state);
}
async function coinStakeInput(store, player, input) {
  const previous = await coinState(store, player._id);
  if (previous === null) throw new Error("Missing open coin state");
  if (previous.stage === "playing") return coinReply(privateCasinoTexts.cannotChange, previous);
  const parsed = parseCasinoStake(input.text ?? "");
  if (parsed === null) return coinReply(privateCasinoTexts.stakeUsage, previous);
  const old = previous.stage === "staked" ? previous.amount : 0;
  const available = BigInt(player.kc) + BigInt(old);
  const raw = parsed === "all" ? available : parsed === "half" ? available / 2n : BigInt(parsed);
  if (raw < BigInt(privateCasinoConfig.coinMinimum)) return coinReply(privateCasinoTexts.stakeUsage, previous);
  if (raw > BigInt(game.maxAmount)) return coinReply(casinoTexts.limit, previous);
  const amount = Number(raw);
  if (coinPayout(amount, privateCasinoConfig.coinMultipliers.length) === null) return coinReply(casinoTexts.limit, previous);
  const delta = amount - old;
  if (delta !== 0 && !await store.updateBalance(player._id, "kc", delta > 0 ? "take" : "add", Math.abs(delta))) return coinReply(delta > 0 ? casinoTexts.funds : casinoTexts.limit, previous);
  const state = { ...previous, sessionId: coinSession(input.eventId), amount, history: [], stage: "staked" };
  await store.casinoSave(state);
  return coinReply(coinStakeText(amount), state);
}
async function finishCoin(store, player, state, final) {
  const payout = coinPayout(state.amount, state.history.length);
  if (payout === null) throw new Error("Coin payout exceeded reserved bound");
  const paid = await store.updateBalance(player._id, "kc", "add", payout);
  if (!paid) await addCasinoCredit(store, `coin:${state.sessionId}`, player._id, payout);
  state.stage = "finished";
  await store.casinoSave(state);
  return coinReply(`${coinPaidText(state.amount, payout, final)}${paid ? "" : `

${casinoTexts.creditWaiting}`}`, state);
}
async function coinAction(store, player, command, random) {
  const state = await coinState(store, player._id);
  if (state === null) return { text: privateCasinoTexts.firstStake, keyboard: { kind: "casino" } };
  if (!coinActive(state)) return coinReply(privateCasinoTexts.firstStake, state);
  if (command.token !== state.sessionId || command.step !== state.history.length) return coinReply(casinoTexts.stale, state);
  if (command.kind === "coin_cashout") return state.history.length === 0 ? coinReply(privateCasinoTexts.noFlips, state) : finishCoin(store, player, state, false);
  if (command.side !== "diamond" && command.side !== "emerald") throw new Error("Invalid coin choice");
  if (state.history.length === 0) {
    const director = await directorState(store, await store.now());
    if (director.dueAt <= await store.now()) return coinReply(casinoTexts.electionPending, state);
    const fee = casinoPercent(state.amount, casinoConfig.directorPercent);
    if (director.holderId !== null) {
      if (director.earnedKC > game.maxAmount - fee) return coinReply(casinoTexts.limit, state);
      director.earnedKC += fee;
    }
    await store.casinoSave(director, director.dueAt);
  }
  const side = random(`coin:${state.sessionId}:${state.history.length}`, 2) === 0 ? "diamond" : "emerald";
  state.history.push(side);
  if (side !== command.side) {
    state.stage = "finished";
    const dealer = await store.dealer();
    if (dealer.holderId !== null) await addCasinoCredit(store, `coin-dealer:${state.sessionId}`, dealer.holderId, casinoPercent(state.amount, casinoConfig.dealerPercent), "dealer");
    await store.casinoSave(state);
    return coinReply(coinLossText(player.kc), state);
  }
  if (state.history.length === privateCasinoConfig.coinMultipliers.length) return finishCoin(store, player, state, true);
  state.stage = "playing";
  await store.casinoSave(state);
  const payout = coinPayout(state.amount, state.history.length);
  if (payout === null) throw new Error("Invalid coin payout");
  return coinReply(coinWinText(state, coinMultiplier(state.history.length), payout, player.kc), state);
}

// src/services/private-casino.ts
async function privateCasinoAction(store, player, command, input, random) {
  if (input.isChat) return { text: privateCasinoTexts.private, keyboard: { kind: "none" } };
  switch (command.kind) {
    case "casino": {
      const dealer = await store.dealer();
      const holder = dealer.holderId === null ? null : await store.player(dealer.holderId);
      return { text: casinoLobbyText(player, holder, dealer.earnedKC), keyboard: { kind: "casino" } };
    }
    case "casino_chats":
      return { text: privateCasinoTexts.chats, keyboard: { kind: "casino_chats" } };
    case "jackpot":
      return jackpotAction(store, player, false, input, random);
    case "jackpot_join":
      return jackpotAction(store, player, true, input, random);
    case "coin":
      return openCoin(store, player, input);
    case "coin_flip":
    case "coin_cashout":
      return coinAction(store, player, command, random);
  }
}

// src/services/private-casino-rules.ts
function isPrivateCasinoCommand(command) {
  return command.kind === "casino" || command.kind === "casino_chats" || command.kind === "jackpot" || command.kind === "jackpot_join" || command.kind === "coin" || command.kind === "coin_flip" || command.kind === "coin_cashout";
}

// src/services/casino.ts
function messageParts(text) {
  const parts = [];
  let buffer = "";
  for (const line of text.split("\n")) {
    if (line.length > game.maxMessageLength) throw new Error("Unbounded casino line");
    const next = buffer.length === 0 ? line : `${buffer}
${line}`;
    if (next.length > game.maxMessageLength) {
      parts.push(buffer);
      buffer = line;
    } else buffer = next;
  }
  if (buffer.length > 0) parts.push(buffer);
  return parts;
}
async function acceptBet(store, player, line, input, index, random) {
  if ("error" in line) return line.error;
  const peerId = input.peerId;
  if (peerId === void 0 || !Number.isSafeInteger(peerId) || peerId <= 2e9) throw new Error("Missing casino chat");
  const current = typeof line.amount === "number" ? player : await store.player(player._id);
  if (current === null) throw new Error("Missing casino actor");
  const amount = resolveCasinoStake(line.amount, current.kc);
  if (!safeBankMoney(amount) || !Number.isSafeInteger(line.target) || (line.mode === "crash" ? line.target <= 100 || line.target > casinoConfig.maxCrash : line.mode === "roulette" ? !validRouletteTarget(line.target) : !casinoConfig.sectors.some((sector) => sector === line.target))) throw new Error("Invalid typed casino bet");
  if (amount < casinoConfig.minimum) return betMinimum(line.mode);
  const now = await store.now();
  const director = await directorState(store, now);
  if (director.dueAt <= now) return casinoTexts.electionPending;
  const existing = await store.casinoGet(roundKey(peerId, line.mode));
  if (existing !== null && existing.kind !== "round") throw new Error("Invalid active round");
  if (existing !== null && existing.stage !== "finished" && (existing.stage !== "open" || existing.closesAt <= now)) return casinoTexts.closed;
  const active = existing !== null && existing.stage !== "finished";
  const roundId = active ? existing.roundId : `game:${input.eventId}:${index}`;
  if ((await store.casinoList({ kind: "bet", roundId, vkId: player._id }, casinoConfig.maxBets)).length >= casinoConfig.maxBets) return betLimit(line.mode);
  const liability = betPayout(line.mode, amount, line.target, line.mode === "dream" ? 7 : 1);
  if (liability === null) return casinoTexts.limit;
  const fee = casinoPercent(amount, casinoConfig.directorPercent);
  if (director.holderId !== null && director.earnedKC > game.maxAmount - fee) return casinoTexts.limit;
  if (active && (existing.total > game.maxAmount - amount || existing.liability > game.maxAmount - liability)) return casinoTexts.limit;
  if (!await store.updateBalance(player._id, "kc", "take", amount)) return casinoTexts.funds;
  if (director.holderId !== null) director.earnedKC += fee;
  await store.casinoSave(director, director.dueAt);
  const selected = active ? { result: existing.result, bonus: existing.bonus } : selectOutcome(line.mode, random, roundId);
  const closesAt = active ? new Date(existing.closesAt.getTime() + casinoConfig.extensionMs) : new Date(now.getTime() + casinoConfig.acceptanceMs);
  const round = active ? { ...existing, closesAt, dueAt: closesAt, total: existing.total + amount, liability: existing.liability + liability } : {
    _id: roundKey(peerId, line.mode),
    kind: "round",
    version: existing?.version ?? 0,
    peerId,
    mode: line.mode,
    roundId,
    stage: "open",
    dueAt: closesAt,
    closesAt,
    ...selected,
    total: amount,
    liability,
    losses: 0,
    winners: 0,
    buffer: "",
    pages: 0,
    nextPage: 0,
    dealerId: null,
    history: existing?.history ?? []
  };
  if (existing === null) await store.casinoInsert(round);
  else await store.casinoSave(round, active ? existing.closesAt : void 0);
  await store.casinoInsert({ _id: `bet:${input.eventId}:${index}`, kind: "bet", version: 0, roundId, vkId: player._id, name: player.name, amount, target: line.target, settled: false });
  return betAccepted(player, line.mode, amount, line.target);
}
async function casinoAction(store, player, command, input, random) {
  if (command.kind === "city_director") return directorAction(store, player, { kind: "director_view" }, input);
  if (command.kind === "director_view" || command.kind === "director_bid" || command.kind === "director_confirm") return directorAction(store, player, command, input);
  if (!input.isChat) return { text: casinoTexts.private, keyboard: { kind: "none" } };
  if (command.kind === "casino_log") {
    if (input.peerId === void 0) throw new Error("Missing history chat");
    const round = await store.casinoGet(roundKey(input.peerId, command.mode));
    if (round !== null && round.kind !== "round") throw new Error("Invalid history");
    return { text: historyText(command.mode, round?.history ?? []), keyboard: { kind: "none" } };
  }
  const replies = [];
  for (const [index, line] of command.lines.entries()) replies.push(await acceptBet(store, player, line, input, index, random));
  const parts = messageParts(replies.join("\n"));
  if (parts.length > 1) {
    if (input.peerId === void 0) throw new Error("Missing delivery peer");
    await store.casinoInsert({ _id: `delivery:${input.eventId}`, kind: "delivery", version: 0, peerId: input.peerId, texts: parts, index: 0, stage: "pending", dueAt: /* @__PURE__ */ new Date(0) });
    return { text: "", keyboard: { kind: "none" } };
  }
  return { text: parts[0] ?? casinoTexts.crashUsage, keyboard: { kind: "none" } };
}

// src/services/items.ts
async function resolveStoredTarget(store, target, resolved) {
  switch (target.kind) {
    case "number":
      return await store.playerByAccountId(target.id) ?? await store.player(target.id);
    case "vk":
      return store.player(target.id);
    case "screen":
      return resolved === void 0 ? "target" : resolved === null ? null : store.player(resolved);
    default:
      return assertNever(target);
  }
}
var back = (text, kind) => ({ text, keyboard: { kind: "item_back", itemKind: kind } });
async function adminItems(store, command) {
  const reply3 = (text) => ({ text, keyboard: { kind: "none" } });
  if (command.kind === "admin_itemlist") {
    return reply3(itemCatalogText());
  }
  if (command.kind === "admin_item_invalid") {
    return reply3(itemTexts.adminUsage);
  }
  const entry = itemConfig.catalog.find((item) => item.id === command.catalogId);
  if (entry === void 0 || command.target.kind === "screen" || !validItemQuantity(command.quantity) || command.operation === "take" && command.quantity !== 1) {
    return reply3(itemTexts.adminUsage);
  }
  const receiver = await resolveStoredTarget(store, command.target, void 0);
  if (receiver === null || receiver === "target") {
    return reply3(itemTexts.missing);
  }
  const success = command.operation === "give" ? await store.grantItems(receiver._id, entry.kind, command.quantity) : await store.removeItems(receiver._id, entry.kind, 1, await store.now());
  return reply3(success ? itemTexts.done : command.operation === "take" ? itemTexts.none : itemTexts.limit);
}
async function unavailableText(store, player, kind, now) {
  return await store.hasReservedItems(player._id, kind, now) ? itemTexts.reserved : itemTexts.none;
}
async function itemView(store, player, itemKind, use = false) {
  const now = await store.now();
  const count = await store.itemCount(player._id, itemKind, now);
  return count === 0 ? { text: await unavailableText(store, player, itemKind, now), keyboard: { kind: "profile" } } : {
    text: itemDetails(itemKind, count, use && itemKind !== "croupier"),
    keyboard: { kind: use && itemKind !== "croupier" ? "item_use" : "item_detail", itemKind }
  };
}
async function open(store, player, kind, quantity, roll) {
  if (kind === "croupier") return itemView(store, player, kind);
  if (!validItemQuantity(quantity)) {
    return back(itemTexts.badQuantity, kind);
  }
  const now = await store.now();
  if (await store.itemCount(player._id, kind, now) < quantity) {
    return back(await unavailableText(store, player, kind, now), kind);
  }
  const rewards = caseRewards(quantity, roll);
  const result = await store.openItems(player, kind, quantity, rewards, now);
  if (result !== "ok") {
    return back(result === "items" ? await unavailableText(store, player, kind, now) : itemTexts.limit, kind);
  }
  await store.setItemDraft(player._id, null);
  return { text: caseResultText(player, rewards), keyboard: { kind: "item_use", itemKind: kind } };
}
async function itemAction(store, player, command, input, roll) {
  switch (command.kind) {
    case "item_detail":
    case "item_use":
      await store.setItemDraft(player._id, null);
      return itemView(store, player, command.itemKind, command.kind === "item_use");
    case "item_custom":
    case "item_gift":
    case "item_sell": {
      if (command.kind === "item_custom" && command.itemKind === "croupier") return itemView(store, player, command.itemKind);
      const now = await store.now();
      const count = await store.itemCount(player._id, command.itemKind, now);
      if (count === 0) {
        return back(await unavailableText(store, player, command.itemKind, now), command.itemKind);
      }
      const draft = command.kind === "item_custom" ? { step: "custom", itemKind: command.itemKind } : { step: "target", itemKind: command.itemKind, mode: command.kind === "item_gift" ? "gift" : "sale" };
      await store.setItemDraft(player._id, draft);
      return back(command.kind === "item_custom" ? itemTexts.custom : itemTexts.target, command.itemKind);
    }
    case "item_open":
      if (![1, 5, 10].includes(command.quantity)) {
        return back(itemTexts.badQuantity, command.itemKind);
      }
      return open(store, player, command.itemKind, command.quantity, roll);
    case "item_open_confirm": {
      const draft = player.itemDraft;
      if (draft?.step !== "open_confirm" || draft.token !== command.token) {
        return { text: itemTexts.stale, keyboard: { kind: "profile" } };
      }
      return open(store, player, draft.itemKind, draft.quantity, roll);
    }
    case "item_confirm": {
      const draft = player.itemDraft;
      if (draft?.step !== "gift_confirm" && draft?.step !== "sale_confirm" || draft.token !== command.token || !validItemQuantity(draft.quantity) || draft.targetId === player._id) {
        return { text: itemTexts.stale, keyboard: { kind: "profile" } };
      }
      const target = await store.player(draft.targetId);
      if (target === null) {
        return back(itemTexts.missing, draft.itemKind);
      }
      const now = await store.now();
      if (draft.step === "gift_confirm") {
        const result = await store.giftItems(player, target, draft.itemKind, draft.quantity, now);
        if (result !== "ok") {
          return back(result === "items" ? await unavailableText(store, player, draft.itemKind, now) : itemTexts.limit, draft.itemKind);
        }
        await store.enqueueItemNotification(
          `gift:${input.eventId}`,
          target._id,
          giftReceivedText(player, draft.itemKind, draft.quantity),
          { kind: "none" }
        );
        await store.setItemDraft(player._id, null);
        return back(giftSentText(target, draft.itemKind, draft.quantity), draft.itemKind);
      }
      const offer = {
        _id: input.eventId,
        sellerId: player._id,
        buyerId: target._id,
        itemKind: draft.itemKind,
        quantity: draft.quantity,
        price: draft.price,
        expiresAt: new Date(now.getTime() + itemConfig.offerDurationMs),
        state: "pending"
      };
      if (!await store.reserveOffer(offer, now)) {
        return back(await unavailableText(store, player, draft.itemKind, now), draft.itemKind);
      }
      await store.enqueueItemNotification(`offer:${offer._id}`, target._id, offerText(player, offer), { kind: "item_offer", offerId: offer._id });
      await store.setItemDraft(player._id, null);
      return back(itemTexts.sent, draft.itemKind);
    }
    case "item_buy": {
      const offer = await store.itemOffer(command.offerId);
      if (offer === null || offer.buyerId !== player._id || offer.state !== "pending") {
        return { text: itemTexts.invalidOffer, keyboard: { kind: "profile" } };
      }
      const seller = await store.player(offer.sellerId);
      if (seller === null) {
        return { text: itemTexts.invalidOffer, keyboard: { kind: "profile" } };
      }
      const result = await store.purchaseOffer(offer, player, seller, await store.now());
      if (result !== "ok") {
        const text = result === "funds" ? itemTexts.funds : result === "expired" ? itemTexts.expired : result === "invalid" ? itemTexts.invalidOffer : result === "items" ? itemTexts.none : itemTexts.limit;
        return { text, keyboard: { kind: "profile" } };
      }
      await store.enqueueItemNotification(`sold:${offer._id}`, seller._id, soldText(player, offer), { kind: "item_back", itemKind: offer.itemKind });
      return { text: boughtText(player), keyboard: { kind: "profile" } };
    }
    default:
      return assertNever(command);
  }
}
async function itemText(store, player, draft, input, resolved) {
  const text = input.text?.trim() ?? "";
  if (/^(отменить|отмена)$/i.test(text)) {
    await store.setItemDraft(player._id, null);
    return { text: itemTexts.cancelled, keyboard: { kind: "main" } };
  }
  switch (draft.step) {
    case "custom": {
      const quantity = parsePromoInteger(text);
      if (quantity === null || !validItemQuantity(quantity)) {
        return back(itemTexts.badQuantity, draft.itemKind);
      }
      const now = await store.now();
      if (await store.itemCount(player._id, draft.itemKind, now) < quantity) {
        return back(await unavailableText(store, player, draft.itemKind, now), draft.itemKind);
      }
      await store.setItemDraft(player._id, { step: "open_confirm", itemKind: draft.itemKind, quantity, token: input.eventId });
      return { text: itemTexts.ready, keyboard: { kind: "item_confirmation", mode: "open", token: input.eventId } };
    }
    case "target": {
      const parsed = parsePlayerTarget(text);
      if (parsed === null) {
        return back(itemTexts.missing, draft.itemKind);
      }
      const target = await resolveStoredTarget(store, parsed, resolved);
      if (target === "target") {
        return "target";
      }
      if (target === null || target._id === player._id) {
        return back(target === null ? itemTexts.missing : itemTexts.self, draft.itemKind);
      }
      await store.setItemDraft(player._id, { ...draft, step: "quantity", targetId: target._id });
      return back(itemQuantityText(await store.itemCount(player._id, draft.itemKind, await store.now())), draft.itemKind);
    }
    case "quantity": {
      const quantity = parsePromoInteger(text);
      if (quantity === null || !validItemQuantity(quantity)) {
        return back(itemTexts.badQuantity, draft.itemKind);
      }
      const now = await store.now();
      if (await store.itemCount(player._id, draft.itemKind, now) < quantity) {
        return back(await unavailableText(store, player, draft.itemKind, now), draft.itemKind);
      }
      if (draft.mode === "sale") {
        await store.setItemDraft(player._id, { step: "price", itemKind: draft.itemKind, quantity, targetId: draft.targetId });
        return back(itemTexts.price, draft.itemKind);
      }
      await store.setItemDraft(player._id, { step: "gift_confirm", itemKind: draft.itemKind, targetId: draft.targetId, quantity, token: input.eventId });
      return { text: itemTexts.giftConfirm, keyboard: { kind: "item_confirmation", mode: "gift", token: input.eventId } };
    }
    case "price": {
      const price = parseItemPrice(text);
      if (price === null) {
        return back(itemTexts.badPrice, draft.itemKind);
      }
      await store.setItemDraft(player._id, { ...draft, step: "sale_confirm", price, token: input.eventId });
      return { text: itemTexts.saleConfirm, keyboard: { kind: "item_confirmation", mode: "sale", token: input.eventId } };
    }
    case "open_confirm":
      return { text: itemTexts.ready, keyboard: { kind: "item_confirmation", mode: "open", token: draft.token } };
    case "gift_confirm":
      return { text: itemTexts.giftConfirm, keyboard: { kind: "item_confirmation", mode: "gift", token: draft.token } };
    case "sale_confirm":
      return { text: itemTexts.saleConfirm, keyboard: { kind: "item_confirmation", mode: "sale", token: draft.token } };
    default:
      return assertNever(draft);
  }
}

// src/services/bank.ts
var back2 = (text, destination = "bank") => ({ text, keyboard: { kind: "bank_back", destination } });
async function depositMenu(store, player) {
  return { text: bankTexts.deposits, keyboard: { kind: "bank_deposits", depositIds: (await store.deposits(player._id)).map((deposit) => deposit.depositId) } };
}
async function savings(store, player, now) {
  const state = settleSavings(player.savingsBalance ?? 0, player.savingsSince ?? now, now);
  if (!await store.saveSavings(player, state.balance, state.since, 0)) throw new Error("Savings update failed");
  return state;
}
async function transfer(store, sender, receiver, currency, amount, input) {
  if (!safeBankMoney(amount) || amount <= 0) return back2(bankTexts.invalid, "bank_transfer_menu");
  if (sender._id === receiver._id) return back2(bankTexts.self, "bank_transfer_menu");
  if (sender[currency] < amount) return back2(currency === "kc" ? bankTexts.funds : bankTexts.fundsCurrency, "bank_transfer_menu");
  const net = transferNet(amount);
  if (!await store.transferMoney(sender, receiver, currency, amount, net)) return back2(bankTexts.limit, "bank_transfer_menu");
  await store.enqueueItemNotification(`transfer:${input.eventId}`, receiver._id, transferReceivedText(sender, net, currency), { kind: "none" });
  if (!input.isChat) await store.setBankDraft(sender._id, null);
  return { text: transferSuccessText(receiver, net, currency, input.isChat ?? false), keyboard: { kind: input.isChat ? "none" : "bank_transfer_menu" } };
}
async function selectDepositAmount(store, player, amount, token) {
  if (!safeBankMoney(amount) || amount <= 0) return back2(bankTexts.invalid, "bank_deposits");
  if (amount > bankConfig.maxDeposit) return back2(bankTexts.depositMax, "bank_deposits");
  if (amount > player.kc) return back2(bankTexts.funds, "bank_deposits");
  await store.setBankDraft(player._id, { step: "deposit_days", amount, token });
  return { text: bankTexts.depositTerm, keyboard: { kind: "bank_deposit_term", token } };
}
async function bankAction(store, player, command, input, resolved, random) {
  const now = await store.now();
  if (["city", "bank", "bank_savings", "bank_deposit_money", "bank_withdraw_money", "bank_transfer_menu", "bank_currency", "bank_deposits", "bank_deposit_create", "bank_deposit", "bank_pension"].some((kind) => kind === command.kind)) await store.setBankDraft(player._id, null);
  switch (command.kind) {
    case "city":
      return { text: bankTexts.city, keyboard: { kind: "city" } };
    case "bank":
      return { text: bankTexts.bank, keyboard: { kind: "bank" } };
    case "bank_savings":
      return { text: savingsText((await savings(store, player, now)).balance), keyboard: { kind: "bank_savings" } };
    case "bank_deposit_money":
    case "bank_withdraw_money": {
      const state = await savings(store, player, now);
      const direction = command.kind === "bank_deposit_money" ? "in" : "out";
      await store.setBankDraft(player._id, { step: "savings_amount", direction });
      return back2(savingsPrompt(player, state.balance, direction), "bank_savings");
    }
    case "bank_transfer_menu":
      return { text: bankTexts.transfer, keyboard: { kind: "bank_transfer_menu" } };
    case "bank_currency":
      await store.setBankDraft(player._id, { step: "transfer_target", currency: command.currency });
      return back2(bankTexts.target, "bank_transfer_menu");
    case "bank_transfer_invalid":
      return back2(bankTexts.usage, "bank_transfer_menu");
    case "bank_transfer": {
      const target = command.target ?? (input.replySenderId !== void 0 && isPositiveId(input.replySenderId) ? { kind: "vk", id: input.replySenderId } : null);
      if (target === null) return back2(bankTexts.usage, "bank_transfer_menu");
      const receiver = await resolveStoredTarget(store, target, resolved);
      if (receiver === "target") return "target";
      return receiver === null ? back2(bankTexts.missing, "bank_transfer_menu") : transfer(store, player, receiver, command.currency, command.amount, input);
    }
    case "bank_pension": {
      const age = player.registeredAt === void 0 ? 0 : bankDays(player.registeredAt, now);
      if (age < bankConfig.pensionMinDays) return back2(bankTexts.young);
      if (player.nextPensionAt !== void 0 && player.nextPensionAt > now) return back2(pensionWaitText(player.nextPensionAt.getTime() - now.getTime()));
      const rewards = age > bankConfig.pensionHighDays ? bankConfig.pensionHigh : bankConfig.pensionBasic;
      const reward = rewards[random(rewards.length)];
      if (reward === void 0) throw new Error("Invalid pension roll");
      return back2(await store.claimPension(player, reward * game.kcScale, now) ? pensionSuccessText(reward * game.kcScale) : bankTexts.limit);
    }
    case "bank_deposits":
      return depositMenu(store, player);
    case "bank_deposit_create":
      if ((await store.deposits(player._id)).length >= bankConfig.maxDeposits) return back2(bankTexts.depositLimit, "bank_deposits");
      await store.setBankDraft(player._id, { step: "deposit_amount" });
      return { text: bankTexts.depositAmount, keyboard: { kind: "bank_deposit_amount", amounts: depositButtons(player.kc) } };
    case "bank_deposit_amount":
      return selectDepositAmount(store, player, command.amount, input.eventId);
    case "bank_deposit_term": {
      const draft = player.bankDraft;
      if (draft?.step !== "deposit_days" || draft.token !== command.token) return back2(bankTexts.stale, "bank_deposits");
      const created = await store.createDeposit(player, draft.amount, command.days, now);
      if (created === "funds" || created === "limit") return back2(created === "funds" ? bankTexts.funds : bankTexts.depositLimit, "bank_deposits");
      return depositMenu(store, player);
    }
    case "bank_deposit":
    case "bank_deposit_early": {
      const deposit = await store.deposit(player._id, command.depositId);
      if (deposit === null) return back2(bankTexts.unavailable, "bank_deposits");
      if (deposit.expiresAt <= now) return back2(await finishDeposit(store, deposit, now) ? bankTexts.ended : bankTexts.limit, "bank_deposits");
      if (command.kind === "bank_deposit") return { text: depositText(deposit, now), keyboard: { kind: "bank_deposit_early", depositId: deposit.depositId } };
      const payout = earlyDepositValue(deposit, now);
      await store.setBankDraft(player._id, { step: "deposit_early", depositId: deposit.depositId, token: input.eventId });
      return { text: depositEarlyPrompt(deposit, payout), keyboard: { kind: "bank_deposit_confirm", token: input.eventId } };
    }
    case "bank_deposit_confirm": {
      const draft = player.bankDraft;
      if (draft?.step !== "deposit_early" || draft.token !== command.token) return back2(bankTexts.stale, "bank_deposits");
      const deposit = await store.deposit(player._id, draft.depositId);
      if (deposit === null) return back2(bankTexts.unavailable, "bank_deposits");
      if (deposit.expiresAt <= now) return back2(await finishDeposit(store, deposit, now) ? bankTexts.ended : bankTexts.limit, "bank_deposits");
      const payout = earlyDepositValue(deposit, now);
      const balance = player.kc + payout;
      if (!await store.closeDeposit(player, deposit, payout, now, true)) return back2(bankTexts.limit, "bank_deposits");
      await store.setBankDraft(player._id, null);
      return back2(depositEarlySuccessText(deposit, payout, balance), "bank_deposits");
    }
    default:
      return assertNever(command);
  }
}
async function bankText(store, player, draft, input, resolved) {
  const text = input.text?.trim() ?? "";
  if (/^(отмена|отменить)$/i.test(text)) {
    await store.setBankDraft(player._id, null);
    return back2(bankTexts.cancelled);
  }
  switch (draft.step) {
    case "savings_amount": {
      const amount = parseBankMoney(text, "kc");
      if (amount === null) return back2(bankTexts.invalid, "bank_savings");
      const now = await store.now();
      const state = settleSavings(player.savingsBalance ?? 0, player.savingsSince ?? now, now);
      if (draft.direction === "in" && player.kc < amount || draft.direction === "out" && state.balance < amount) return back2(bankTexts.funds, "bank_savings");
      const delta = draft.direction === "in" ? -amount : amount;
      const wallet = player.kc + delta;
      const balance = state.balance - delta;
      if (!safeBankMoney(wallet) || !safeBankMoney(balance)) return back2(bankTexts.limit, "bank_savings");
      if (!await store.saveSavings(player, balance, now, delta)) return back2(bankTexts.limit, "bank_savings");
      await store.setBankDraft(player._id, null);
      return { text: savingsResult(wallet, balance), keyboard: { kind: "bank_savings" } };
    }
    case "transfer_target": {
      const target = parsePlayerTarget(text);
      if (target === null) return back2(bankTexts.missing, "bank_transfer_menu");
      const receiver = await resolveStoredTarget(store, target, resolved);
      if (receiver === "target") return "target";
      if (receiver === null || receiver._id === player._id) return back2(receiver === null ? bankTexts.missing : bankTexts.self, "bank_transfer_menu");
      await store.setBankDraft(player._id, { step: "transfer_amount", targetId: receiver._id, currency: draft.currency });
      return back2(transferPrompt(player, receiver, draft.currency), "bank_transfer_menu");
    }
    case "transfer_amount": {
      const amount = parseBankMoney(text, draft.currency);
      if (amount === null) return back2(bankTexts.invalid, "bank_transfer_menu");
      const receiver = await store.player(draft.targetId);
      return receiver === null ? back2(bankTexts.missing, "bank_transfer_menu") : transfer(store, player, receiver, draft.currency, amount, input);
    }
    case "deposit_amount": {
      const amount = parseBankMoney(text, "kc");
      return amount === null ? back2(bankTexts.invalid, "bank_deposits") : selectDepositAmount(store, player, amount, input.eventId);
    }
    case "deposit_days":
    case "deposit_early":
      return back2(bankTexts.stale, "bank_deposits");
    default:
      return assertNever(draft);
  }
}

// src/services/donate.ts
var main = (text) => ({ text, keyboard: { kind: "main" } });
var back3 = (text) => ({ text, keyboard: { kind: "donate_back" } });
var confirm = (text, token, inline = false) => ({ text, keyboard: { kind: "donate_confirmation", token, inline } });
async function donateText(store, player, draft, input) {
  if (/^(отмена|отменить)$/i.test(input.text?.trim() ?? "")) {
    await store.setDonateDraft(player._id, null);
    return main(donateTexts.cancelled);
  }
  if (draft.step !== "nickname") {
    return draft.step === "confirm_nickname" ? confirm(`Вы уверены, что хотите сменить свой ник на: ${draft.nickname}?`, draft.token) : back3(donateTexts.stale);
  }
  const nickname = input.text?.trim() ?? "";
  const length = [...new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(nickname)].length;
  if (length < donateConfig.nicknameMin || length > donateConfig.nicknameMax) return back3(donateTexts.length);
  if (!validNickname(nickname)) return back3(donateTexts.unsafe);
  await store.setDonateDraft(player._id, { step: "confirm_nickname", nickname, token: input.eventId });
  return confirm(`Вы уверены, что хотите сменить свой ник на: ${nickname}?`, input.eventId);
}
async function buyDealer(store, player, now, eventId) {
  const state = await store.dealer();
  const previous = state.holderId === null ? null : await store.player(state.holderId);
  const result = await store.buyDealer(player, previous, state, now);
  switch (result) {
    case "self":
      return main(donateTexts.self);
    case "cooldown":
      return main(`⚠️ Вы уже недавно становились крупье! Подождите еще ${cooldownParts(state.nextChangeAt.getTime() - now.getTime())}`);
    case "funds":
      return main(donateTexts.funds);
    case "limit":
      return main(donateTexts.limit);
    case "ok":
      if (previous !== null) await store.enqueueItemNotification(
        `dealer:${eventId}`,
        previous._id,
        `${mention(player)} стал новым крупье. Вы успели заработать: ${formatAmount(state.earnedKC, game.kcScale)} KC`,
        { kind: "none" }
      );
      await store.setDonateDraft(player._id, null);
      return main(`${mention(player)}, вы успешно стали новым крупье.`);
    default:
      return assertNever(result);
  }
}
async function donateAction(store, player, command, input, members, random) {
  const now = await store.now();
  switch (command.kind) {
    case "donate":
      await store.setDonateDraft(player._id, null);
      return { text: donateTexts.title, keyboard: { kind: "donate" } };
    case "donate_nick":
      await store.setDonateDraft(player._id, { step: "nickname" });
      return back3(nicknamePrompt(player));
    case "donate_thief":
      if (player.thiefUntil !== void 0 && player.thiefUntil > now) {
        await store.setDonateDraft(player._id, null);
        return back3(subscriptionText(player.thiefUntil, false));
      }
      await store.setDonateDraft(player._id, { step: "confirm_thief", token: input.eventId });
      return confirm(thiefPrompt(player), input.eventId);
    case "donate_dealer": {
      const state = await store.dealer();
      const holder = state.holderId === null ? null : await store.player(state.holderId);
      await store.setDonateDraft(player._id, { step: "confirm_dealer", token: input.eventId });
      return confirm(dealerPrompt(holder, state), input.eventId, true);
    }
    case "donate_cancel":
    case "donate_confirm": {
      const draft = player.donateDraft;
      if (draft === void 0 || draft.step === "nickname" || draft.token !== command.token) return main(donateTexts.stale);
      if (command.kind === "donate_cancel") {
        await store.setDonateDraft(player._id, null);
        return main(donateTexts.cancelled);
      }
      switch (draft.step) {
        case "confirm_nickname": {
          const result = await store.changeNickname(player, draft.nickname);
          return main(result === "ok" ? `${mention({ _id: player._id, name: draft.nickname })}, отличный ник!` : result === "funds" ? donateTexts.funds : donateTexts.limit);
        }
        case "confirm_thief": {
          const result = await store.buyThief(player, now);
          if (result === "active" && player.thiefUntil !== void 0) return main(subscriptionText(player.thiefUntil, false));
          return main(result === "ok" ? subscriptionText(new Date(now.getTime() + donateConfig.subscriptionMs), true) : result === "funds" ? donateTexts.funds : donateTexts.limit);
        }
        case "confirm_dealer":
          return buyDealer(store, player, now, input.eventId);
        default:
          return assertNever(draft);
      }
    }
    case "dealer_buy":
      return buyDealer(store, player, now, input.eventId);
    case "dealer_view": {
      const state = await store.dealer();
      return { text: `🤑 Крупье: ${dealerMention(state.holderId === null ? null : await store.player(state.holderId))} (заработал: ${formatAmount(state.earnedKC, game.kcScale)} KC)`, keyboard: { kind: "none" } };
    }
    case "theft": {
      if (!input.isChat) throw new Error("Theft is chat-only");
      if (player.thiefUntil === void 0 || player.thiefUntil <= now) return main(`${mention(player)}, купите подписку на эту команду в ЛС!`);
      if (player.nextTheftAt !== void 0 && player.nextTheftAt > now) return main(`${mention(player)}, своровать можно будет через ${cooldownParts(player.nextTheftAt.getTime() - now.getTime())}`);
      if (members === void 0) return "members";
      const count = await store.theftTargetCount(player._id, members);
      if (count === 0) return main(donateTexts.noVictim);
      const victim = await store.theftTarget(player._id, members, random("victim", count));
      if (victim === null || !Number.isSafeInteger(victim.kc) || victim.kc < 0 || victim.kc > game.maxAmount) throw new Error("Invalid theft target");
      const amount = random("amount", Math.floor(victim.kc / game.kcScale) + 1) * game.kcScale;
      if (!await store.steal(player, victim, amount, now)) return main(donateTexts.limit);
      await store.enqueueItemNotification(`theft:${input.eventId}`, victim._id, `${mention(player)} украл у тебя ${formatAmount(amount, game.kcScale)} KC`, { kind: "none" });
      return main(`${mention(player)} украл у игрока ${mention(victim)} ${formatAmount(amount, game.kcScale)} KC.`);
    }
    default:
      return assertNever(command);
  }
}

// src/services/game.ts
import { randomInt as randomInt4 } from "node:crypto";

// src/services/promo-texts.ts
var promoTexts = {
  menu: "🎁 Меню промокодов:",
  currency: "💰 Выберите валюту своего промокода.",
  name: "💡 Теперь введите название.",
  nameLength: "⚠️ Введите 5-20 символов.",
  nameInvalid: "⚠️ Введите название одной строкой без управляющих символов.",
  quantity: "🔢 Введите количество.\n\n💡 Мин. количество промокодов: 5",
  confirm: "☑️ Подтвердите создание промокода.",
  created: "✅ Промокод создан",
  activate: "🎁 Введите название промокода для активации.",
  notFound: "⚠️ Такого промокода не существует!",
  exists: "⚠️ Промокод с таким названием уже существует!",
  funds: "⚠️ Недостаточно средств для создания промокода.",
  stale: "⚠️ Подтверждение устарело. Создайте промокод заново.",
  already: "⚠️ Вы уже активировали этот промокод!",
  empty: "⚠️ Активации этого промокода закончились!",
  own: "⚠️ Нельзя активировать свой промокод!",
  balanceLimit: "⚠️ Достигнут предел баланса. Промокод не активирован.",
  limit: "⚠️ Сумма или количество слишком велики.",
  emptyList: "У Вас пока нет промокодов.",
  private: "⚠️ Откройте промокоды в личных сообщениях бота."
};
function promoAmountPrompt(currency) {
  const minimum = game.promo.minimum[currency];
  const amount = currency === "kc" ? `${formatAmount(minimum, 1)} KC` : currency === "euro" ? `${minimum} 💴` : `${minimum}₿`;
  return `🔢 Введите сумму 1-го промо.

💡 Мин. сумма: ${amount}`;
}
function promoRewardText(currency, amount) {
  const value = formatAmount(amount, promoScale(currency));
  switch (currency) {
    case "kc":
      return `💰 ${value} KC`;
    case "euro":
      return `💶 ${value}`;
    case "bitcoin":
      return `💠 ${value}₿`;
  }
}
function promoActivatedText(promo) {
  return `🎁 Активация промокода успешна! Ваши награды:

${promoRewardText(promo.currency, promo.amount)}`;
}
function promoListText(promos) {
  return "🎁 Ваши промокоды:\n\n" + (promos.length === 0 ? promoTexts.emptyList : promos.map(
    (promo) => `${promo._id} — ${promo.remaining} активаций, награды:
${promoRewardText(promo.currency, promo.amount)}`
  ).join("\n\n"));
}

// src/services/promos.ts
function back4(text) {
  return { text, keyboard: { kind: "promo_back" } };
}
async function promoAction(store, player, command) {
  switch (command.kind) {
    case "promo":
    case "promo_back":
      await store.setPromoDraft(player._id, null);
      return { text: promoTexts.menu, keyboard: { kind: "promo" } };
    case "promo_create":
      await store.setPromoDraft(player._id, { step: "currency" });
      return { text: promoTexts.currency, keyboard: { kind: "promo_currency" } };
    case "promo_currency":
      if (player.promoDraft?.step !== "currency") {
        return back4(promoTexts.stale);
      }
      await store.setPromoDraft(player._id, { step: "name", currency: command.currency });
      return back4(promoTexts.name);
    case "promo_activate":
      await store.setPromoDraft(player._id, { step: "activate" });
      return back4(promoTexts.activate);
    case "promo_list": {
      if (command.after !== null && !isPromoName(command.after)) {
        return back4(promoTexts.stale);
      }
      await store.setPromoDraft(player._id, null);
      const promos = await store.promos(player._id, command.after);
      const visible = promos.slice(0, game.promo.pageSize);
      const last = visible.at(-1);
      return {
        text: promoListText(visible),
        keyboard: { kind: "promo_list", after: promos.length > game.promo.pageSize && last !== void 0 ? last._id : null }
      };
    }
    case "promo_confirm": {
      const draft = player.promoDraft;
      if (draft?.step !== "confirm" || draft.token !== command.token || !isPromoName(draft.name) || !validPromoReward(draft.currency, draft.amount) || promoTotal(draft.amount, draft.quantity) === null) {
        return back4(promoTexts.stale);
      }
      const result = await store.createPromo(player, {
        _id: draft.name,
        ownerId: player._id,
        currency: draft.currency,
        amount: draft.amount,
        quantity: draft.quantity,
        remaining: draft.quantity
      });
      if (result === "funds") {
        return { text: promoTexts.funds, keyboard: { kind: "promo_confirm", token: draft.token } };
      }
      if (result === "exists") {
        await store.setPromoDraft(player._id, { step: "name", currency: draft.currency });
        return back4(`${promoTexts.exists}

${promoTexts.name}`);
      }
      await store.setPromoDraft(player._id, null);
      return { text: promoTexts.created, keyboard: { kind: "promo" } };
    }
    default:
      return assertNever(command);
  }
}
async function promoText(store, player, draft, input) {
  const text = input.text?.trim() ?? "";
  switch (draft.step) {
    case "currency":
      return { text: promoTexts.currency, keyboard: { kind: "promo_currency" } };
    case "name": {
      const length = Array.from(text).length;
      if (length < game.promo.minNameLength || length > game.promo.maxNameLength) {
        return back4(promoTexts.nameLength);
      }
      if (!isPromoName(text)) {
        return back4(promoTexts.nameInvalid);
      }
      if (await store.promo(text) !== null) {
        return back4(`${promoTexts.exists}

${promoTexts.name}`);
      }
      await store.setPromoDraft(player._id, { step: "amount", currency: draft.currency, name: text });
      return back4(promoAmountPrompt(draft.currency));
    }
    case "amount": {
      const whole = parsePromoInteger(text);
      if (whole === null || whole < game.promo.minimum[draft.currency]) {
        return back4(promoAmountPrompt(draft.currency));
      }
      const amount = BigInt(whole) * BigInt(promoScale(draft.currency));
      if (amount > BigInt(game.maxAmount)) {
        return back4(promoTexts.limit);
      }
      await store.setPromoDraft(player._id, { step: "quantity", currency: draft.currency, name: draft.name, amount: Number(amount) });
      return back4(promoTexts.quantity);
    }
    case "quantity": {
      const quantity = parsePromoInteger(text);
      if (quantity === null || quantity < game.promo.minQuantity) {
        return back4(promoTexts.quantity);
      }
      if (promoTotal(draft.amount, quantity) === null) {
        return back4(promoTexts.limit);
      }
      await store.setPromoDraft(player._id, { ...draft, step: "confirm", quantity, token: input.eventId });
      return { text: promoTexts.confirm, keyboard: { kind: "promo_confirm", token: input.eventId } };
    }
    case "confirm":
      return { text: promoTexts.confirm, keyboard: { kind: "promo_confirm", token: draft.token } };
    case "activate": {
      const promo = isPromoName(text) ? await store.promo(text) : null;
      if (promo === null) {
        return back4(promoTexts.notFound);
      }
      const result = await store.activatePromo(player, promo);
      switch (result) {
        case "redeemed":
          await store.setPromoDraft(player._id, null);
          return { text: promoActivatedText(promo), keyboard: { kind: "promo" } };
        case "already":
          return back4(promoTexts.already);
        case "empty":
          return back4(promoTexts.empty);
        case "own":
          return back4(promoTexts.own);
        case "balance_limit":
          return back4(promoTexts.balanceLimit);
        default:
          return assertNever(result);
      }
    }
    default:
      return assertNever(draft);
  }
}

// src/services/mining-actions.ts
async function miningAction(store, player, command) {
  const now = await store.now();
  const farm = settleFarm(player.mining ?? initialFarm(), now);
  let text;
  switch (command.kind) {
    case "mining":
      text = miningText(farm, now);
      break;
    case "mining_start":
      if (farm.activeUntil.getTime() > now.getTime()) {
        text = texts.miningAlreadyStarted;
      } else {
        farm.activeUntil = new Date(now.getTime() + game.mining.durationMs);
        text = await store.saveMining(player, farm, 0) ? texts.miningStarted : texts.miningLimit;
      }
      break;
    case "mining_withdraw": {
      if (farm.balance < game.mining.minWithdrawal) {
        text = texts.miningEmpty;
        break;
      }
      const amount = farm.balance;
      farm.balance = 0;
      text = await store.saveMining(player, farm, amount) ? miningWithdrawalText(amount) : texts.miningLimit;
      break;
    }
    case "mining_upgrade":
      return { text: miningOfferText(farm.upgradeCost), keyboard: { kind: "mining_upgrade", level: farm.level } };
    case "mining_confirm": {
      if (command.level !== farm.level || !Number.isSafeInteger(command.level) || command.level < 0) {
        text = texts.miningStaleOffer;
        break;
      }
      const cost = farm.upgradeCost;
      if (player.bitcoin < cost) {
        text = texts.miningInsufficient;
        break;
      }
      const nextCost = nextUpgradeCost(farm.level, cost);
      const increase = randomMiningIncrease();
      if (nextCost === null || farm.rate > game.maxAmount - increase || farm.level >= game.maxAmount) {
        text = texts.miningLimit;
        break;
      }
      farm.rate += increase;
      farm.level += 1;
      farm.upgradeCost = nextCost;
      text = await store.saveMining(player, farm, -cost) ? miningUpgradedText(farm, increase) : texts.miningLimit;
      break;
    }
    default:
      return assertNever(command);
  }
  return { text, keyboard: { kind: "mining" } };
}

// src/services/game.ts
var GameService = class {
  constructor(database, resolveReferralUrl, resolveItemTarget, caseRoll = () => randomInt4(100), donateRoll = (_purpose, maximum) => randomInt4(maximum), bankRoll = (maximum) => randomInt4(maximum), casinoRoll = casinoRandom) {
    this.database = database;
    this.resolveReferralUrl = resolveReferralUrl;
    this.resolveItemTarget = resolveItemTarget;
    this.caseRoll = caseRoll;
    this.donateRoll = donateRoll;
    this.bankRoll = bankRoll;
    this.casinoRoll = casinoRoll;
  }
  database;
  resolveReferralUrl;
  resolveItemTarget;
  caseRoll;
  donateRoll;
  bankRoll;
  casinoRoll;
  async handle(input, resolveName, resolveChatMembers, wakeNotifications) {
    if (!isPositiveId(input.vkId) || !input.eventId || input.eventId.length > 200) {
      throw new Error("Invalid event identity");
    }
    if (isGiveawayAdminCommand(input.command) && !adminIds.has(input.vkId)) throw new Error("Administrator access is required");
    if (input.command.kind === "delete_keyboards" && (!input.isChat || !adminIds.has(input.vkId))) {
      throw new Error("Administrator chat access is required");
    }
    if ((input.command.kind === "admin_balance" || input.command.kind === "admin_balance_invalid") && !adminIds.has(input.vkId)) {
      throw new Error("Administrator access is required");
    }
    if (isAdminItemCommand(input.command) && !adminIds.has(input.vkId)) {
      throw new Error("Administrator access is required");
    }
    if ((input.command.kind === "mailing" || input.command.kind === "mailing_invalid") && !adminIds.has(input.vkId)) throw new Error("Administrator access is required");
    if (input.command.kind === "theft" && !input.isChat) throw new Error("Theft is chat-only");
    const casinoRoll = cachedCasinoRandom(this.casinoRoll);
    const bankRolls = /* @__PURE__ */ new Map();
    const bankRandom = (maximum) => {
      const value = bankRolls.get(maximum) ?? this.bankRoll(maximum);
      if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) throw new Error("Invalid bank roll");
      bankRolls.set(maximum, value);
      return value;
    };
    let members;
    const donationRolls = /* @__PURE__ */ new Map();
    const donationRandom = (purpose, maximum) => {
      const key = `${purpose}:${maximum}`;
      const value = donationRolls.get(key) ?? this.donateRoll(purpose, maximum);
      if (!Number.isSafeInteger(value) || value < 0 || value >= maximum) throw new Error("Invalid donate random value");
      donationRolls.set(key, value);
      return value;
    };
    let resolvedTarget;
    let rolls;
    let rollIndex = 0;
    const roll = () => {
      rolls ??= [];
      const value = rolls[rollIndex] ?? this.caseRoll();
      rolls[rollIndex++] = value;
      return value;
    };
    let name = null;
    let referralUrl = null;
    for (let attempt = 0; attempt < game.duplicateRetries; ) {
      try {
        const outcome2 = await this.database.transaction(async (store) => {
          const previous = await store.processed(input.eventId);
          if (previous !== null) {
            if (previous.vkId !== input.vkId) {
              throw new Error("Event sender mismatch");
            }
            return { reply: previous.reply, wake: false };
          }
          if (!input.isChat && input.peerId === input.vkId) await store.joinMailing(input.vkId);
          rollIndex = 0;
          const reply4 = await this.execute(store, input, name, referralUrl, resolvedTarget, roll, members, donationRandom, bankRandom, casinoRoll);
          if (typeof reply4 === "string") {
            return { reply: reply4, wake: false };
          }
          const prepared = await store.remember(input, input.isChat && reply4.keyboard.kind !== "dice_game" && reply4.keyboard.kind !== "giveaway" ? { ...reply4, keyboard: { kind: "none" } } : reply4);
          return { reply: prepared, wake: store.notificationsQueued() };
        });
        const reply3 = outcome2.reply;
        if (typeof reply3 !== "string") {
          if (outcome2.wake) {
            try {
              wakeNotifications?.();
            } catch (error) {
              logError("notification_wake", error);
            }
          }
          return reply3;
        }
        if (reply3 === "name") {
          name = normalizeName(await resolveName());
        } else if (reply3 === "members") {
          if (resolveChatMembers === void 0 || !input.isChat || input.command.kind !== "theft") throw new Error("Chat members provider is unavailable");
          const ids = await resolveChatMembers();
          if (ids.length > donateConfig.maxChatMembers || ids.some((id) => !isPositiveId(id))) throw new Error("Invalid chat members");
          members = [...new Set(ids)];
        } else if (reply3 === "target") {
          const target = input.command.kind === "bank_transfer" ? input.command.target : parsePlayerTarget(input.text ?? "");
          if (target?.kind !== "screen" || this.resolveItemTarget === void 0) {
            throw new Error("Item target provider is unavailable");
          }
          resolvedTarget = await this.resolveItemTarget(target.name);
          if (resolvedTarget !== null && !isPositiveId(resolvedTarget)) {
            throw new Error("Invalid resolved VK identity");
          }
        } else {
          if (this.resolveReferralUrl === void 0) {
            throw new Error("Referral link provider is unavailable");
          }
          referralUrl = await this.resolveReferralUrl(input.vkId);
          const url = new URL(referralUrl);
          if (url.protocol !== "https:" || url.hostname !== "vk.cc" || url.username || url.password) {
            throw new Error("Invalid short referral URL");
          }
        }
      } catch (error) {
        attempt += 1;
        if (!(error instanceof DuplicateWriteError) || attempt === game.duplicateRetries) {
          throw error;
        }
        continue;
      }
    }
    throw new Error("Transaction retry limit reached");
  }
  async execute(store, input, name, referralUrl, resolvedTarget, roll, members, donateRandom, bankRandom, casinoRoll) {
    if (input.command.kind === "mailing" || input.command.kind === "mailing_invalid") return mailingAction(store, input, input.command);
    if (input.command.kind === "delete_keyboards") {
      return { text: texts.keyboardsDeleted, keyboard: { kind: "none" } };
    }
    if (input.command.kind === "admin_balance" || input.command.kind === "admin_balance_invalid") {
      return adminBalanceAction(store, input, input.command);
    }
    if (isAdminItemCommand(input.command)) {
      return adminItems(store, input.command);
    }
    let giveawayState;
    if (isGiveawayCommand(input.command)) {
      if (input.command.kind !== "giveaway_claim") return giveawayAdminAction(store, input, input.command);
      const prepared = await prepareGiveawayClaim(store, input, input.command);
      if ("text" in prepared) return prepared;
      giveawayState = prepared;
    }
    if (isDiceCommand(input.command)) {
      if (!await diceButtonActive(store, input, input.command)) return { text: "", keyboard: { kind: "none" } };
      if (input.command.kind === "dice_leave" || input.command.kind === "dice_list" || input.command.kind === "dice_invalid") return diceAction(store, input, null, input.command, casinoRoll);
    }
    const player = await store.player(input.vkId);
    if (player === null) {
      if (name === null) {
        return "name";
      }
      const registered = await store.register(input.vkId, name);
      if (registered !== null && input.referrerId !== void 0 && isPositiveId(input.referrerId) && input.referrerId !== input.vkId) {
        const inviter = await store.player(input.referrerId);
        if (inviter !== null) {
          await store.rewardReferral(inviter, registered, referralRewardText(registered));
        }
      }
      if (registered !== null && input.command.kind === "giveaway_claim") return claimGiveaway(store, input, registered, input.command, giveawayState);
      return { text: registered === null ? texts.registrationLimit : texts.welcome, keyboard: { kind: "main" } };
    }
    const command = input.command;
    if (isGiveawayCommand(command)) {
      if (command.kind === "giveaway_claim") return claimGiveaway(store, input, player, command, giveawayState);
      return giveawayAdminAction(store, input, command);
    }
    if (isDiceCommand(command)) return diceAction(store, input, player, command, casinoRoll);
    if (!input.isChat && player.coinOpen === true) {
      if (!input.hasPayload && command.kind === "development" && input.text !== void 0) return coinStakeInput(store, player, input);
      const state = await coinState(store, player._id);
      const coinCommand = command.kind === "coin" || command.kind === "coin_flip" || command.kind === "coin_cashout";
      if (state !== null && coinActive(state) && !coinCommand) return coinReply(privateCasinoTexts.active, state);
      if (!coinCommand) await store.setCoinOpen(player._id, false);
    }
    if (isPrivateCasinoCommand(command)) {
      if (!input.isChat) {
        if (player.bankDraft !== void 0) await store.setBankDraft(player._id, null);
        if (player.donateDraft !== void 0) await store.setDonateDraft(player._id, null);
        if (player.promoDraft !== void 0) await store.setPromoDraft(player._id, null);
        if (player.itemDraft !== void 0) await store.setItemDraft(player._id, null);
        if (player.directorDraft !== void 0) await store.setDirectorDraft(player._id, null);
      }
      return privateCasinoAction(store, player, command, input, casinoRoll);
    }
    if (command.kind === "casino_bets" || command.kind === "casino_log" || command.kind === "director_view" || command.kind === "director_bid" || command.kind === "director_confirm" || command.kind === "city_director") {
      if (!input.isChat) {
        await store.setBankDraft(player._id, null);
        await store.setDonateDraft(player._id, null);
        await store.setPromoDraft(player._id, null);
        await store.setItemDraft(player._id, null);
      }
      return casinoAction(store, player, command, input, casinoRoll);
    }
    if (!input.isChat && !input.hasPayload && command.kind === "development" && player.directorDraft !== void 0 && input.text !== void 0) return directorTextInput(store, player, input);
    if (!input.isChat && player.directorDraft !== void 0) await store.setDirectorDraft(player._id, null);
    if (!input.isChat && !input.hasPayload && command.kind === "development" && player.bankDraft !== void 0 && input.text !== void 0) {
      return bankText(store, player, player.bankDraft, input, resolvedTarget);
    }
    if (isBankCommand(command)) {
      if (input.isChat && command.kind !== "bank_transfer" && command.kind !== "bank_transfer_invalid") return { text: bankTexts.private, keyboard: { kind: "none" } };
      if (!input.isChat) {
        await store.setItemDraft(player._id, null);
        await store.setPromoDraft(player._id, null);
        await store.setDonateDraft(player._id, null);
      }
      return bankAction(store, player, command, input, resolvedTarget, bankRandom);
    }
    if (!input.isChat && player.bankDraft !== void 0) await store.setBankDraft(player._id, null);
    if (!input.isChat && !input.hasPayload && command.kind === "development" && player.donateDraft !== void 0 && input.text !== void 0) {
      return donateText(store, player, player.donateDraft, input);
    }
    if (isDonateCommand(command)) {
      if (input.isChat && command.kind !== "dealer_buy" && command.kind !== "dealer_view" && command.kind !== "theft") return { text: donateTexts.private, keyboard: { kind: "none" } };
      if (!input.isChat) {
        await store.setItemDraft(player._id, null);
        await store.setPromoDraft(player._id, null);
      }
      return donateAction(store, player, command, input, members, donateRandom);
    }
    if (!input.isChat && player.donateDraft !== void 0) await store.setDonateDraft(player._id, null);
    if (!input.isChat && !input.hasPayload && player.itemDraft !== void 0 && input.text !== void 0 && command.kind !== "menu" && command.kind !== "inventory" && command.kind !== "profile" && command.kind !== "item") {
      return itemText(store, player, player.itemDraft, input, resolvedTarget);
    }
    if (isItemCommand(command)) {
      if (input.isChat) {
        return { text: itemTexts.private, keyboard: { kind: "none" } };
      }
      if (player.promoDraft !== void 0) {
        await store.setPromoDraft(player._id, null);
      }
      return itemAction(store, player, command, input, roll);
    }
    if (!input.isChat && player.itemDraft !== void 0) {
      await store.setItemDraft(player._id, null);
    }
    if (!input.isChat && !input.hasPayload && player.promoDraft !== void 0 && input.text !== void 0) {
      return promoText(store, player, player.promoDraft, input);
    }
    if (isPromoCommand(command)) {
      return input.isChat ? { text: promoTexts.private, keyboard: { kind: "none" } } : promoAction(store, player, command);
    }
    if (!input.isChat && player.promoDraft !== void 0) {
      await store.setPromoDraft(player._id, null);
    }
    switch (command.kind) {
      case "profile":
        return { text: profileText(player, input.isChat ? void 0 : await store.now()), keyboard: { kind: "profile" } };
      case "menu":
        return { text: `${mention(player)}, меню:

${profileText(player, input.isChat ? void 0 : await store.now())}`, keyboard: { kind: "main" } };
      case "bonus": {
        const now = await store.now();
        const remaining = player.nextBonusAt.getTime() - now.getTime();
        if (remaining > 0) {
          return { text: cooldownText(remaining), keyboard: { kind: "main" } };
        }
        const day = bonusDay(player, now);
        const reward = rewardForDay(day);
        const claimed = await store.claim(player, day, reward, now);
        return { text: claimed ? bonusText(day, reward) : texts.balanceLimit, keyboard: { kind: "main" } };
      }
      case "mining":
      case "mining_start":
      case "mining_withdraw":
      case "mining_upgrade":
      case "mining_confirm":
        return miningAction(store, player, command);
      case "ranking": {
        const ranking = await store.ranking(command.metric, player);
        return { text: rankingText(command.metric, ranking, player, rankingScore(player, command.metric)), keyboard: { kind: "ranking" } };
      }
      case "referrals": {
        const url = player.referralUrl ?? referralUrl;
        if (url === null) {
          return "link";
        }
        if (player.referralUrl === void 0) {
          await store.saveReferralUrl(player._id, url);
        }
        return { text: referralText(url, player.referrals ?? 0), keyboard: { kind: "referrals" } };
      }
      case "inventory": {
        if (input.isChat) {
          const items2 = await store.inventoryAll(input.vkId);
          const text = inventoryText(items2);
          return {
            text: items2.length > game.chatInventoryLimit || text.length > game.maxMessageLength ? texts.inventoryTooLarge : text,
            keyboard: { kind: "none" }
          };
        }
        if (!Number.isSafeInteger(command.page) || command.page < 0 || command.page > Math.floor(game.maxAmount / game.inventoryPageSize) - 1) {
          throw new Error("Invalid inventory page");
        }
        const items = await store.inventory(input.vkId, command.page);
        const visible = items.slice(0, game.inventoryPageSize);
        return {
          text: inventoryText(visible),
          keyboard: {
            kind: "inventory",
            page: command.page,
            itemIds: visible.map((item) => item.itemId),
            hasNext: items.length > game.inventoryPageSize
          }
        };
      }
      case "item": {
        if (input.isChat) {
          return { text: itemTexts.private, keyboard: { kind: "none" } };
        }
        const item = await store.ownedItem(player._id, command.itemId);
        return item === null ? { text: itemTexts.none, keyboard: { kind: "profile" } } : itemView(store, player, item.kind);
      }
      case "development":
        return { text: texts.development, keyboard: { kind: "main" } };
      default:
        return assertNever(command);
    }
  }
};

// src/main.ts
async function main2() {
  const env = readEnvironment(process.env);
  const client = new MongoClient2(env.mongoUri, {
    serverSelectionTimeoutMS: 1e4,
    connectTimeoutMS: 1e4,
    maxPoolSize: 10,
    retryWrites: true
  });
  const vk = new VK({
    token: env.vkToken,
    pollingGroupId: env.vkGroupId,
    ...vkApiOptions
  });
  const pending = /* @__PURE__ */ new Set();
  let stopping;
  let stopDice;
  let stopJackpot;
  let stopMailing;
  let stopPhotos;
  let stopCasino;
  let stopChats;
  let stopBank;
  let stopNotifications;
  const stop = () => {
    stopping ??= (async () => {
      try {
        await vk.updates.stop();
        await stopChats?.();
        await stopDice?.();
        await stopJackpot?.();
        await stopCasino?.();
        await stopBank?.();
        await stopPhotos?.();
        await stopMailing?.();
        await stopNotifications?.();
        await Promise.allSettled([...pending]);
      } finally {
        await client.close();
      }
    })();
    return stopping;
  };
  const onSignal = () => {
    void stop().catch((error) => {
      logError("shutdown", error);
      process.exitCode = 1;
    });
  };
  try {
    await client.connect();
    const database = new MongoGameDatabase(client, env.mongoDb);
    await database.initialize();
    await syncChatRegistry(vk, database, env.vkGroupId).catch((error) => {
      logError("chat_registry", error);
    });
    const service = new GameService(database, createReferralLinkResolver(vk, env.vkGroupId), createItemTargetResolver(vk));
    const resolvePhoto = createRoulettePhotoResolver(vk, new MongoMessagePhotos(client.db(env.mongoDb)), env.vkGroupId);
    const notifications = startNotifications(database, vk, resolvePhoto);
    const handle = createMessageHandler(vk, service, env.vkGroupId, notifications.wake);
    stopPhotos = startRoulettePhotoWorker(database, resolvePhoto);
    stopNotifications = notifications;
    stopMailing = startMailingWorker(database, notifications.wake);
    stopBank = startBankWorker(database, notifications.wake);
    stopCasino = startCasinoWorker(database, notifications.wake);
    stopDice = startDiceWorker(database, notifications.wake);
    stopJackpot = startJackpotWorker(database, notifications.wake);
    stopChats = startChatRegistry(vk, database, env.vkGroupId);
    vk.updates.on("message_new", async (context) => {
      if (stopping !== void 0) {
        return;
      }
      const task = handleRegisteredMessage(context, env.vkGroupId, database, handle);
      pending.add(task);
      try {
        await task;
      } catch (error) {
        logError("message_boundary", error);
      } finally {
        pending.delete(task);
      }
    });
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    await vk.updates.startPolling();
    if (stopping !== void 0) {
      await vk.updates.stop();
    } else {
      console.info("Kreox Bot запущен.");
    }
  } catch (error) {
    await stop();
    throw error;
  }
}
process.on("unhandledRejection", (error) => {
  logError("unhandled_rejection", error);
});
await main2().catch((error) => {
  logError("startup", error);
  process.exitCode = 1;
});
