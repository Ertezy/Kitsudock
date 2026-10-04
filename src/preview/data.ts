// Синтетические данные стенда. Названия игр — наши поддерживаемые, всё остальное
// выдумано: имена героев, баннеров и роликов, коды, награды. Фоны и иконки —
// свои нарисованные заглушки (`art.ts`), а не арт игр. Времена считаются от
// «сейчас», чтобы таймеры на стенде выглядели одинаково при каждом открытии.

import type { Banner, Code, FoundGame, GameView, HubData, HubGame, SourceKind, Video } from "../types";
import { backgroundArt, iconArt, imageUrl } from "./art";

const H = 3600;
const D = 86400;

interface Preset {
  id: string;
  title: string;
  /** Идентификатор в данных хаба; `null` — у игры нет ни кодов, ни баннеров, ни роликов. */
  contentId: string | null;
  sourceKind: SourceKind;
  /** Откуда у игры фон, пока своего нет. */
  artSource: GameView["artSource"];
  /** Показывается своя картинка вместо фона из `artSource`: есть что убирать на вкладке «Вид». */
  ownPicture?: boolean;
  /** Два оттенка заглушек; `null` — у игры нет ни фона, ни иконки (рисуются запасные). */
  hues: [number, number] | null;
}

const PRESETS: Preset[] = [
  { id: "genshin", title: "Genshin Impact", contentId: "genshin", sourceKind: "epic", artSource: "hoyoplay", hues: [38, 205] },
  { id: "hsr", title: "Honkai: Star Rail", contentId: "hsr", sourceKind: "exe", artSource: "hoyoplay", hues: [268, 218] },
  { id: "zzz", title: "Zenless Zone Zero", contentId: "zzz", sourceKind: "exe", artSource: "hoyoplay", ownPicture: true, hues: [338, 28] },
  { id: "wuthering", title: "Wuthering Waves", contentId: "wuthering", sourceKind: "steam", artSource: "steam", hues: [188, 140] },
  // Игра без данных хаба и без картинок: на ней видны запасные фон и иконка-буква.
  { id: "endfield", title: "Arknights: Endfield", contentId: null, sourceKind: "exe", artSource: "fill", hues: null },
];

function toView(p: Preset, index: number): GameView {
  return {
    id: p.id,
    title: p.title,
    contentId: p.contentId,
    sourceKind: p.sourceKind,
    iconPath: p.hues ? iconArt(p.title, p.hues[0], p.hues[1]) : null,
    artPath: p.hues ? backgroundArt(p.hues[0], p.hues[1], 100 + index) : null,
    artSource: p.ownPicture ? "picture" : p.artSource,
    videoPath: null,
    videoMissing: false,
    args: "",
    missing: false,
  };
}

/** Какой фон у игры без своей картинки и своего видео: тот, что был бы у неё из лаунчера или магазина. */
export function baseArt(game: Pick<GameView, "id">): Pick<GameView, "artSource" | "artPath"> {
  const index = PRESETS.findIndex((p) => p.id === game.id);
  if (index < 0) return { artSource: "fill", artPath: null };
  const { artSource, artPath } = toView({ ...PRESETS[index], ownPicture: false }, index);
  return { artSource, artPath };
}

/** Своя картинка вместо выбора файла: оттенки выводятся из названия, как у запасных заливок. */
export function ownArt(title: string): string {
  const hue = hueOf(title);
  return backgroundArt(hue, (hue + 70) % 360, 200 + (hue % 50));
}

/** Своя иконка вместо выбора файла. */
export function ownIcon(title: string): string {
  const hue = hueOf(title);
  return iconArt(title, hue, (hue + 70) % 360);
}

function hueOf(text: string): number {
  let hue = 0;
  for (const ch of text) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return hue;
}

/** Список игр, как его отдаёт `get_games`. */
export function makeGames(): GameView[] {
  return PRESETS.map(toView);
}

/** Игра по названию из экрана поиска: известная — с заглушками, чужая — без них. */
export function gameFromScan(title: string, taken: number): GameView {
  const index = PRESETS.findIndex((p) => p.title === title);
  if (index >= 0) return toView(PRESETS[index], index);
  return {
    id: `custom-${taken + 1}`,
    title,
    contentId: null,
    sourceKind: "exe",
    iconPath: null,
    artPath: null,
    artSource: "fill",
    videoPath: null,
    videoMissing: false,
    args: "",
    missing: false,
  };
}

/** Что «нашёл» поиск установленных игр. Признак `alreadyAdded` ставит бэкенд по списку игр. */
export function makeScan(): Omit<FoundGame, "alreadyAdded">[] {
  return [
    { title: "Genshin Impact", contentId: "genshin", sourceKind: "epic" },
    { title: "Honkai: Star Rail", contentId: "hsr", sourceKind: "hoyoplay" },
    { title: "Zenless Zone Zero", contentId: "zzz", sourceKind: "hoyoplay" },
    { title: "Wuthering Waves", contentId: "wuthering", sourceKind: "kuro" },
    { title: "Arknights: Endfield", contentId: null, sourceKind: "gryphlink" },
    { title: "Lantern Keeper Demo", contentId: null, sourceKind: "steam" },
  ];
}

const REDEEM = "https://redeem.preview.test/gift?code={code}";

const HUB_GAMES: HubGame[] = [
  { id: "genshin", title: "Genshin Impact", redeemUrl: REDEEM },
  { id: "hsr", title: "Honkai: Star Rail", redeemUrl: REDEEM },
  { id: "zzz", title: "Zenless Zone Zero", redeemUrl: REDEEM },
  // Без веб-погашения: у карточки кода только кнопка копирования.
  { id: "wuthering", title: "Wuthering Waves", redeemUrl: null },
  { id: "endfield", title: "Arknights: Endfield", redeemUrl: null },
];

function codes(now: number): Code[] {
  const c = (gameId: string, code: string, rewards: string, expiresAt: number | null, region = "all"): Code => ({
    gameId,
    code,
    rewards,
    expiresAt,
    region,
    source: null,
  });
  return [
    // Сгорает сегодня: у карточки отдельный вид и таймер.
    c("genshin", "EMBERGLOW26", "Gems ×60, Coins ×20000, Tickets ×2", now + 3 * H + 52 * 60),
    c("genshin", "LANTERNFEST", "Gems ×40, Coins ×30000", now + 2 * D + 5 * H),
    c("genshin", "FOXFIRE100", "Coins ×50000, Ore ×5", null),
    c("genshin", "HOLLOWSEA", "Gems ×30, Tickets ×1", now + 9 * D, "NA"),
    c("hsr", "QUIETORCHARD", "Gems ×50, Coins ×40000", now + 6 * H + 10 * 60),
    c("hsr", "RAILSFROST", "Gems ×60, Coins ×30000, Fuel ×2", now + 4 * D),
    c("hsr", "STARDUSTFOX", "Coins ×60000", null),
    c("zzz", "NEONSTATIC", "Tickets ×40, Coins ×30000", now + 20 * H),
    c("zzz", "MIDNIGHTARCADE", "Tickets ×50, Coins ×20000, Chips ×3", now + 12 * D),
    c("wuthering", "TIDEWAKE", "Gems ×50, Coins ×20000", now + 2 * D + 20 * H),
    c("wuthering", "ECHOLANTERN", "Gems ×40, Coins ×30000", null),
  ];
}

function banners(now: number): Banner[] {
  const b = (
    gameId: string,
    title: string,
    featured: string[],
    rarity: number | null,
    image: string | null,
    startsAt: number,
    endsAt: number,
  ): Banner => ({ gameId, title, featured, rarity, image, startsAt, endsAt, url: null });
  return [
    b("genshin", "Tides of Ember", ["Aelwyn"], 5, imageUrl("banner", 38, 205, 11), now - 12 * D, now + 6 * D),
    b("genshin", "Lantern Hours", ["Mirabel", "Toren", "Sela"], 4, imageUrl("banner", 205, 120, 12), now - 4 * D, now + 17 * D),
    b("genshin", "Frost Orchard", ["Kasumi"], 5, imageUrl("banner", 268, 218, 13), now + 6 * D, now + 27 * D),
    // У этой игры вики не хранит арт баннеров: рисуется запасной градиент с названием.
    b("hsr", "Rails Beyond the Frost", ["Kasumi Vale"], 5, null, now - 9 * D, now + 11 * D),
    b("hsr", "Quiet Orchard Rerun", ["Orren", "Vey"], 4, null, now - 9 * D, now + 11 * D),
    b("zzz", "Neon Static", ["Rook"], 5, imageUrl("banner", 338, 28, 21), now - 6 * D, now + 8 * D),
    b("zzz", "Midnight Arcade", ["Pim"], 5, imageUrl("banner", 300, 330, 22), now + 8 * D, now + 29 * D),
    // Без героев и редкости: подписи поверх арта нет.
    b("wuthering", "Hollow Sea Tide", [], null, imageUrl("banner", 188, 140, 31), now - 3 * D, now + 18 * D),
  ];
}

function videos(now: number): Video[] {
  const v = (
    gameId: string,
    n: number,
    title: string,
    publishedAt: number,
    duration: number | null,
    hues: [number, number],
    extra: Partial<Video> = {},
  ): Video => ({
    gameId,
    lang: "en",
    title,
    url: `https://video.preview.test/watch/${gameId}-${n}`,
    thumb: imageUrl("thumb", hues[0], hues[1], 40 + n),
    publishedAt,
    duration,
    premiere: false,
    ...extra,
  });
  const g: [number, number] = [38, 205];
  const h: [number, number] = [268, 218];
  const z: [number, number] = [338, 28];
  const w: [number, number] = [188, 140];
  return [
    v("genshin", 1, "Version 5.0 Trailer — Tides of Ember", now - 2 * D, 187, g),
    v("genshin", 2, "Character Demo: Aelwyn — Ember Oath", now - 5 * D, 94, g),
    v("genshin", 3, "Developer Notes #12 — Lantern Festival", now - 9 * D, null, g),
    // Премьера: время публикации впереди, у значка надпись вместо длительности.
    v("genshin", 4, "Lantern Festival Opening", now + 6 * H, null, g, { premiere: true }),
    v("genshin", 5, "Version 5.0 PV — Moeru Chikai", now - 2 * D, 187, g, { lang: "ja" }),
    v("genshin", 6, "Kyarakuta Demo: Aeruin", now - 5 * D, 94, g, { lang: "ja" }),
    v("hsr", 1, "Version 3.2 Trailer — Quiet Orchard", now - 1 * D, 214, h),
    v("hsr", 2, "Character Demo: Kasumi Vale", now - 4 * D, 101, h),
    v("hsr", 3, "Story Teaser — Rails Beyond the Frost", now - 8 * D, 62, h),
    v("hsr", 4, "Dev Diary #7", now - 15 * D, 735, h),
    v("zzz", 1, "Version 2.1 Trailer — Neon Static", now - 3 * D, 168, z),
    v("zzz", 2, "Character Demo: Rook", now - 6 * D, 88, z),
    v("zzz", 3, "Soundtrack Preview — Midnight Arcade", now - 13 * D, 241, z),
    v("wuthering", 1, "Version 2.4 Trailer — Hollow Sea", now - 2 * D, 196, w),
    v("wuthering", 2, "Resonator Demo: Ilveth", now - 7 * D, 79, w),
    v("wuthering", 3, "Dev Diary #3", now - 16 * D, 508, w),
  ];
}

/** Откуда хаб: сеть, кеш или файл из комплекта (`_source` в данных). */
export type HubSource = "remote" | "cache" | "bundled";

/**
 * Данные хаба, как их отдаёт `get_hub`. По умолчанию свежие, «только что с
 * сервера». Возраст сдвигает только `updatedAt`: сроки кодов, баннеров и роликов
 * считаются от «сейчас», чтобы таймеры на стенде не зависели от сценария.
 */
export function makeHub(now: number, source: HubSource = "remote", ageSec = 25 * 60): HubData {
  return {
    version: 2,
    updatedAt: now - ageSec,
    games: HUB_GAMES.map((g) => ({ ...g })),
    codes: codes(now),
    banners: banners(now),
    videos: videos(now),
    _source: source,
  };
}
