const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const black = range(1, 36).filter(number => !red.includes(number));

export const rouletteConfig = {
  numbers: 37,
  straightMultiplier: 36,
  red,
  black,
  groups: [
    { target: 37, label: 'п1', multiplier: 2, numbers: range(1, 18) },
    { target: 38, label: 'п2', multiplier: 2, numbers: range(19, 36) },
    { target: 39, label: 'д1', multiplier: 3, numbers: range(1, 12) },
    { target: 40, label: 'д2', multiplier: 3, numbers: range(13, 24) },
    { target: 41, label: 'д3', multiplier: 3, numbers: range(25, 36) },
    { target: 42, label: 'ч1', multiplier: 4, numbers: range(1, 9) },
    { target: 43, label: 'ч2', multiplier: 4, numbers: range(10, 18) },
    { target: 44, label: 'ч3', multiplier: 4, numbers: range(19, 27) },
    { target: 45, label: 'ч4', multiplier: 4, numbers: range(28, 36) },
    { target: 46, label: 'четное', multiplier: 2, numbers: range(1, 36).filter(number => number % 2 === 0) },
    { target: 47, label: 'нечетное', multiplier: 2, numbers: range(1, 36).filter(number => number % 2 !== 0) },
    { target: 48, label: 'красное', multiplier: 2, numbers: red },
    { target: 49, label: 'черное', multiplier: 2, numbers: black },
    { target: 50, label: 'большие', multiplier: 2, numbers: range(19, 36) },
    { target: 51, label: 'малые', multiplier: 2, numbers: range(1, 18) }
  ],
  photoTimeoutMs: 30_000,
  maxPhotoBytes: 10 * 1024 * 1024
} as const;

export const roulettePhotos: readonly string[] = [
  'https://cdn.kleymorf.xyz/other/1a62ac90c1eb_photo_e53303d6.jpg',
  'https://cdn.kleymorf.xyz/other/fbe8f35afd63_photo_f1bc5cf6.jpg',
  'https://cdn.kleymorf.xyz/other/fb85c6a73e91_photo_9b34e1f8.jpg',
  'https://cdn.kleymorf.xyz/other/7c1bafb26aca_photo_9db44ec7.jpg',
  'https://cdn.kleymorf.xyz/other/0438e7e24f69_photo_5b24244a.jpg',
  'https://cdn.kleymorf.xyz/other/7ae4dd4cf8f6_photo_cc159f8b.jpg',
  'https://cdn.kleymorf.xyz/other/74cbd17307a9_photo_5e554b4c.jpg',
  'https://cdn.kleymorf.xyz/other/61b3c35ea629_photo_8c3da6e5.jpg',
  'https://cdn.kleymorf.xyz/other/ec47421fe334_photo_94789985.jpg',
  'https://cdn.kleymorf.xyz/other/6ed406a3592a_photo_581af863.jpg',
  'https://cdn.kleymorf.xyz/other/89165b9da39f_photo_92c6c31c.jpg',
  'https://cdn.kleymorf.xyz/other/61c7f4bee516_photo_e4d52fa6.jpg',
  'https://cdn.kleymorf.xyz/other/5e357483f0cd_photo_b9bee276.jpg',
  'https://cdn.kleymorf.xyz/other/de7b6e64c4b3_photo_691e9b96.jpg',
  'https://cdn.kleymorf.xyz/other/b905849f901b_photo_d73c3f1a.jpg',
  'https://cdn.kleymorf.xyz/other/33b7861f489e_photo_e47b4208.jpg',
  'https://cdn.kleymorf.xyz/other/fff75695a9d5_photo_cf522a83.jpg',
  'https://cdn.kleymorf.xyz/other/d6e6a37f7aa5_photo_d2f7dac3.jpg',
  'https://cdn.kleymorf.xyz/other/eda40c9fd86e_photo_7d9467c9.jpg',
  'https://cdn.kleymorf.xyz/other/fc3c1cd99a28_photo_fc200894.jpg',
  'https://cdn.kleymorf.xyz/other/a20e6698d442_photo_c4c5b043.jpg',
  'https://cdn.kleymorf.xyz/other/18b1007baf49_photo_30ee0385.jpg',
  'https://cdn.kleymorf.xyz/other/85578fb1f31d_photo_1c5bbf23.jpg',
  'https://cdn.kleymorf.xyz/other/e51ee81c280f_photo_38c03142.jpg',
  'https://cdn.kleymorf.xyz/other/7ede9b1adfcd_photo_45cd354a.jpg',
  'https://cdn.kleymorf.xyz/other/aa182cb6130f_photo_4f2ff8a7.jpg',
  'https://cdn.kleymorf.xyz/other/a5419b8c2b4b_photo_e18c46e7.jpg',
  'https://cdn.kleymorf.xyz/other/4baa5d148032_photo_c1cb97d3.jpg',
  'https://cdn.kleymorf.xyz/other/23d243c27159_photo_7ac390d7.jpg',
  'https://cdn.kleymorf.xyz/other/b6d98877f6ad_photo_6f971d44.jpg',
  'https://cdn.kleymorf.xyz/other/82dac72c9de1_photo_684ed4ae.jpg',
  'https://cdn.kleymorf.xyz/other/cc209b27f01e_photo_72709488.jpg',
  'https://cdn.kleymorf.xyz/other/1347dde8199b_photo_307137d6.jpg',
  'https://cdn.kleymorf.xyz/other/ede101d4a4a8_photo_09f6eb4c.jpg',
  'https://cdn.kleymorf.xyz/other/4f6d0e5880a6_photo_b7c695a7.jpg',
  'https://cdn.kleymorf.xyz/other/ea453e77163d_photo_9b9769fe.jpg',
  'https://cdn.kleymorf.xyz/other/e7c188483369_photo_a2c319c7.jpg'
];
