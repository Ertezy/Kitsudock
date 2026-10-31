// Подмена системной части для стенда предпросмотра. Страница ходит в Rust только
// через `src/lib/api.ts` (команды `invoke` и плагины диалога, буфера и ссылок), а
// ещё слушает события и спрашивает окно, видно ли его. Здесь на каждый такой
// вызов отвечает таблица с тестовыми данными; встроенный `@tauri-apps/api/mocks`
// ставит саму перехватку. Ничего из этого файла в собранное приложение не
// попадает: его тянет только `src/preview/main.tsx`, а сборка берёт `index.html`.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { About, AppConfig, AppRelease, Behaviour, FoundGame, GameView, HubData, LaunchWay } from "../types";
import type { Lang, VideoLang } from "../i18n/native";
import { artFromUrl } from "./art";
import { baseArt, gameFromScan, makeGames, makeHub, makeScan, ownArt, ownIcon } from "./data";

// ---------------------------------------------------------------- адрес стенда

/**
 * Состояние данных.
 * - `normal` — всё загружено, хаб свежий;
 * - `loading` — игры есть, а хаб ещё не ответил (ответит через минуту): главный
 *   экран при `hub === null`;
 * - `offline` — сети нет, хаб отдан из кеша, которому 30 часов (`_source: "cache"`);
 * - `stale` — сети нет и кеша нет: хаб из комплекта старше недели
 *   (`_source: "bundled"`), панель прячет коды и баннеры;
 * - `firstRun` — приложение запущено впервые, игр ещё нет.
 */
export type Scenario = "normal" | "loading" | "offline" | "stale" | "firstRun";

export const SCENARIOS: readonly Scenario[] = ["normal", "loading", "offline", "stale", "firstRun"];

/**
 * Активно ли окно стенда:
 * - `auto` — как в приложении: окно неактивно, пока у вкладки нет фокуса или
 *   она не видна;
 * - `on` — окно всегда активно, что бы ни делал браузер: для записи ролика,
 *   когда фокус у программы записи, а движение должно идти;
 * - `off` — окно всегда неактивно, фоновое движение на паузе.
 * Не то же, что `motion=off`: тот убирает движение совсем.
 */
export type WindowState = "auto" | "on" | "off";

export const WINDOW_STATES: readonly WindowState[] = ["auto", "on", "off"];

/** Всё состояние стенда — это адрес: `?scenario=normal&lang=ru&motion=on`. */
export interface PreviewParams {
  scenario: Scenario;
  lang: Lang;
  motion: boolean;
  /** Активно ли окно (`WindowState`); в адресе — `active=on` или `active=off`. */
  active: WindowState;
  /** Знает ли хаб версию новее работающей — строка «Вышла версия» внизу
   *  панели; в адресе — `update=on`. По умолчанию её нет: снимки для README
   *  её не показывают. */
  update: boolean;
  /** Показывать ли плашку с переключателями; `controls=off` убирает её для снимков. */
  controls: boolean;
}

export const DEFAULT_PARAMS: PreviewParams = {
  scenario: "normal",
  lang: "ru",
  motion: true,
  active: "auto",
  update: false,
  controls: true,
};

/** Разбор строки адреса; неизвестное значение заменяется значением по умолчанию. */
export function readParams(search: string): PreviewParams {
  const q = new URLSearchParams(search);
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = q.get(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  };
  return {
    scenario: pick("scenario", SCENARIOS, DEFAULT_PARAMS.scenario),
    lang: pick<Lang>("lang", ["ru", "en"], DEFAULT_PARAMS.lang),
    motion: pick("motion", ["on", "off"], "on") === "on",
    active: pick("active", WINDOW_STATES, DEFAULT_PARAMS.active),
    update: q.get("update") === "on",
    controls: q.get("controls") !== "off",
  };
}

/** Обратное к `readParams`: строка адреса с вопросительным знаком. */
export function toSearch(p: PreviewParams): string {
  const q = new URLSearchParams({
    scenario: p.scenario,
    lang: p.lang,
    motion: p.motion ? "on" : "off",
  });
  if (p.active !== "auto") q.set("active", p.active);
  if (p.update) q.set("update", "on");
  if (!p.controls) q.set("controls", "off");
  return `?${q.toString()}`;
}

// ------------------------------------------------------------------- команды

/** Каждая команда, которую зовёт `src/lib/api.ts`. Тест сверяет этот список с файлом. */
const APP_COMMANDS = [
  "get_games",
  "get_config",
  "get_hub",
  "get_last_played",
  "launch_game",
  "cache_image",
  "add_game",
  "update_game",
  "set_launch_way",
  "remove_game",
  "reorder_games",
  "relocate_game",
  "scan_installed",
  "add_game_from_scan",
  "needs_first_run",
  "mark_seeded",
  "get_behaviour",
  "set_behaviour",
  "get_store_art",
  "set_store_art",
  "get_animation",
  "set_animation",
  "get_language",
  "set_language",
  "get_video_language",
  "set_video_language",
  "get_autostart",
  "set_autostart",
  "check_video",
  "set_hub_url",
  "image_cache_size",
  "clear_image_cache",
  "get_about",
  "open_log_folder",
  "report_ui_error",
  "install_update",
] as const;

type AppCommand = (typeof APP_COMMANDS)[number];

/**
 * Команды плагинов и окна, которые зовёт страница. События (`listen`,
 * `unlisten`, `emit`) отвечает сам `mockIPC` с `shouldMockEvents`; они здесь
 * только для полноты списка.
 */
const PLUGIN_COMMANDS = [
  "plugin:dialog|open",
  "plugin:dialog|message",
  "plugin:clipboard-manager|write_text",
  "plugin:opener|open_url",
  "plugin:window|is_visible",
  "plugin:event|listen",
  "plugin:event|unlisten",
  "plugin:event|emit",
] as const;

/** Имена всех команд, на которые отвечает стенд. */
export const PREVIEW_COMMANDS: readonly string[] = [...APP_COMMANDS, ...PLUGIN_COMMANDS];

type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown;

const HOUR = 3600;
const DAY = 86400;

/** Сколько хаб «грузится» в сценарии `loading`: за это время его не дождаться. */
const LOADING_MS = 60_000;
/** Сколько на стенде «запускается» игра: достаточно, чтобы разглядеть это состояние. */
const LAUNCH_MS = 1500;
/** Возраст кеша хаба в сценарии `offline`. */
const CACHE_AGE_SEC = 30 * HOUR;
/** Возраст хаба из комплекта в сценарии `stale`: старше недели, когда панель прячет коды и баннеры. */
const BUNDLED_AGE_SEC = 8 * DAY;
/** Версия приложения на стенде (`get_about`). */
const STAND_VERSION = "0.1.2";
/** Вышедшая версия при `update=on`: новее работающей, ссылка — на страницу релиза. */
const NEXT_RELEASE: AppRelease = {
  version: "0.2.0",
  url: "https://github.com/Ertezy/Kitsudock/releases/tag/v0.2.0",
};
/** Сколько на стенде «качается» обновление: достаточно, чтобы разглядеть загрузку. */
const UPDATE_MS = 3000;
/** Ставить на стенде нечего: после загрузки — отказ, и видно строку отказа. */
const NO_INSTALL = "the stand cannot install updates";
/** Без сети картинку не скачать: настоящая `cache_image` тоже отказывает строкой. */
const NO_PICTURE = "image download failed: the stand has no network";

/** Как `hub::is_safe_https` в Rust: схема https без учёта регистра и хотя бы один знак хоста. */
const isSafeHttps = (url: string): boolean => /^https:\/\/[^/]/i.test(url);

/** Копия значения: мост отдаёт странице свежие данные, а не ссылку на состояние стенда. */
const clone = <T>(value: T): T => structuredClone(value);

const after = <T>(ms: number, make: () => T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(make()), ms));

/** Ответы на настройки, с которыми стенд открыт. */
export interface StandSettings {
  lang?: Lang;
  motion?: boolean;
  /** Активно ли окно (`WindowState`); по умолчанию `auto` — как у браузера. */
  active?: WindowState;
  /** Знает ли хаб версию новее работающей (`PreviewParams.update`). */
  update?: boolean;
}

/** Ответы стенда на команды моста. Отдельной функцией ради теста: ей не нужно окно. */
export function createHandlers(scenario: Scenario, settings: StandSettings = {}): Record<AppCommand, Handler> {
  const firstRun = scenario === "firstRun";
  // Без сети не только хаб старый, но и картинок не скачать.
  const noNetwork = scenario === "offline" || scenario === "stale";
  const state = {
    games: firstRun ? [] : makeGames(),
    seeded: !firstRun,
    lastPlayed: (firstRun ? null : "genshin") as string | null,
    language: settings.lang ?? DEFAULT_PARAMS.lang,
    videoLanguage: "en" as VideoLang,
    animation: settings.motion ?? DEFAULT_PARAMS.motion,
    storeArt: true,
    behaviour: { closeToTray: true, trayOnLaunch: false } as Behaviour,
    autostart: false,
    hubUrl: null as string | null,
    cacheBytes: 48_234_496,
    cacheFiles: 37,
  };

  const find = (gameId: unknown): GameView | undefined => state.games.find((g) => g.id === gameId);

  return {
    // Список игр локальный и отвечает сразу в любом сценарии, как в приложении.
    get_games: () => clone(state.games),
    get_config: (): AppConfig => ({
      version: 1,
      hubUrl: state.hubUrl,
      lastPlayed: state.lastPlayed,
      seeded: state.seeded,
      behaviour: clone(state.behaviour),
      storeArt: state.storeArt,
      games: [],
    }),
    // Как в Rust (`hub::load`): без сети хаб не отказывает, а отдаётся из кеша,
    // а если кеша нет — из комплекта; откуда именно, видно по `_source`.
    get_hub: () => {
      const withRelease = (hub: HubData): HubData => (settings.update ? { ...hub, app: { ...NEXT_RELEASE } } : hub);
      const make = () => {
        const now = Math.floor(Date.now() / 1000);
        if (scenario === "offline") return withRelease(makeHub(now, "cache", CACHE_AGE_SEC));
        if (scenario === "stale") return withRelease(makeHub(now, "bundled", BUNDLED_AGE_SEC));
        return withRelease(makeHub(now));
      };
      return scenario === "loading" ? after(LOADING_MS, make) : make();
    },
    get_last_played: () => state.lastPlayed,
    // Как в Rust: запуск отвечает идентификатором игры.
    launch_game: ({ gameId }) => {
      if (!find(gameId)) return Promise.reject({ code: "gameNotFound" });
      return after(LAUNCH_MS, () => {
        state.lastPlayed = String(gameId);
        return String(gameId);
      });
    },
    // Адреса картинок хаба стенд узнаёт сам и отвечает нарисованной картинкой;
    // без сети и для чужого адреса картинки нет.
    cache_image: ({ url }) => {
      if (noNetwork) return Promise.reject(NO_PICTURE);
      const art = artFromUrl(String(url));
      return art ?? Promise.reject(`no picture for ${String(url)} on the stand`);
    },

    add_game: ({ title }) => {
      const game = gameFromScan(String(title), state.games.length);
      state.games.push(game);
      return game.id;
    },
    // Поля, как их понимает Rust: отсутствует — не трогать; пустая строка у
    // фона, иконки, видео и привязки — стереть своё; иначе — задать. Файлов на
    // стенде нет, поэтому «заданное» — нарисованная картинка.
    update_game: (u) => {
      const game = find(u.gameId);
      if (!game) return Promise.reject({ code: "gameNotFound" });
      // Путь к игре: Rust отказывает, если по пути нет файла. Стенд считает файлом
      // любой непустой путь, и находка снимает «файл пропал».
      if (typeof u.exe === "string") {
        if (u.exe === "") return Promise.reject({ code: "fileMissing", detail: "" });
        game.missing = false;
      }
      if (typeof u.title === "string") {
        if (u.title.trim() === "") return Promise.reject({ code: "emptyTitle" });
        game.title = u.title;
      }
      if (typeof u.background === "string") {
        if (u.background === "") {
          if (game.artSource === "picture") Object.assign(game, baseArt(game));
        } else {
          game.artPath = ownArt(game.title);
          if (game.artSource !== "video") game.artSource = "picture";
        }
      }
      // У `<video>` из рисунка кадра не будет: на стенде от своего видео виден
      // только неподвижный кадр-постер.
      if (typeof u.video === "string") {
        if (u.video === "") {
          game.videoPath = null;
          game.videoMissing = false;
          if (game.artSource === "video") Object.assign(game, baseArt(game));
        } else {
          game.videoPath = ownArt(game.title);
          game.videoMissing = false;
          game.artSource = "video";
        }
      }
      if (typeof u.icon === "string") game.iconPath = u.icon === "" ? null : ownIcon(game.title);
      if (typeof u.contentId === "string") game.contentId = u.contentId === "" ? null : u.contentId;
      if (typeof u.args === "string") game.args = u.args;
      return null;
    },
    // Как в Rust: выбор запоминается, а действует, только если способ игре доступен.
    set_launch_way: ({ gameId, way }) => {
      const game = find(gameId);
      if (!game) return Promise.reject({ code: "gameNotFound" });
      if (game.ways.includes(way as LaunchWay)) game.way = way as LaunchWay;
      return null;
    },
    remove_game: ({ gameId }) => {
      state.games = state.games.filter((g) => g.id !== gameId);
      return null;
    },
    reorder_games: ({ ids }) => {
      const order = ids as string[];
      state.games = order.map((id) => find(id)).filter((g): g is GameView => g !== undefined);
      return null;
    },
    relocate_game: ({ gameId }) => {
      const game = find(gameId);
      if (game) game.missing = false;
      return null;
    },
    scan_installed: (): FoundGame[] =>
      makeScan().map((f) => ({ ...f, alreadyAdded: state.games.some((g) => g.title === f.title) })),
    add_game_from_scan: ({ title }) => {
      const existing = state.games.find((g) => g.title === title);
      if (existing) return existing.id;
      const game = gameFromScan(String(title), state.games.length);
      state.games.push(game);
      return game.id;
    },

    needs_first_run: () => !state.seeded,
    mark_seeded: () => {
      state.seeded = true;
      return null;
    },

    get_behaviour: () => clone(state.behaviour),
    set_behaviour: ({ closeToTray, trayOnLaunch }) => {
      state.behaviour = { closeToTray: Boolean(closeToTray), trayOnLaunch: Boolean(trayOnLaunch) };
      return null;
    },
    get_store_art: () => state.storeArt,
    set_store_art: ({ enabled }) => {
      state.storeArt = Boolean(enabled);
      return null;
    },
    get_animation: () => state.animation,
    set_animation: ({ enabled }) => {
      state.animation = Boolean(enabled);
      return null;
    },
    get_language: () => state.language,
    set_language: ({ language }) => {
      state.language = language as Lang;
      return null;
    },
    get_video_language: () => state.videoLanguage,
    set_video_language: ({ language }) => {
      state.videoLanguage = language as VideoLang;
      return null;
    },
    get_autostart: () => state.autostart,
    set_autostart: ({ enabled }) => {
      state.autostart = Boolean(enabled);
      return null;
    },

    check_video: () => null,
    // Как в Rust: пустая строка — «нет адреса», не https — отказ с кодом без подробности.
    set_hub_url: ({ url }) => {
      const value = typeof url === "string" && url.trim() !== "" ? url : null;
      if (value !== null && !isSafeHttps(value)) return Promise.reject({ code: "hubUrlNotHttps" });
      state.hubUrl = value;
      return null;
    },
    image_cache_size: () => state.cacheBytes,
    // Как в Rust: отвечает числом удалённых файлов, а не байтов.
    clear_image_cache: () => {
      const removed = state.cacheFiles;
      state.cacheFiles = 0;
      state.cacheBytes = 0;
      return removed;
    },
    get_about: (): About => ({
      version: STAND_VERSION,
      logPath: "C:\\Users\\you\\AppData\\Roaming\\Kitsudock\\logs",
    }),
    open_log_folder: () => null,
    report_ui_error: () => null,
    // Как в Rust, отказ — кодом с подробностью. Удачи на стенде нет: настоящая
    // удачная установка закрыла бы приложение.
    install_update: () =>
      new Promise((_, reject) => setTimeout(() => reject({ code: "updateFailed", detail: NO_INSTALL }), UPDATE_MS)),
  };
}

/** Плагины отвечают заглушками без действия: диалог «отменён», буфер и ссылки ничего не делают. */
export function pluginHandlers(settings: StandSettings): Record<string, Handler> {
  return {
    "plugin:dialog|open": () => null,
    // Вопрос с кнопками («Убрать игру?») — ответ «Отмена», чтобы стенд ничего не стирал.
    "plugin:dialog|message": () => "Cancel",
    "plugin:clipboard-manager|write_text": () => null,
    "plugin:opener|open_url": () => null,
    // Окно на стенде видно. Неактивное окно (`active=off`) стенд изображает
    // спрятанным: это один из трёх признаков неактивности (`lib/windowActive.ts`),
    // и только его стенд держит сам — фокус и свёрнутость страница берёт у
    // браузера, и любой щелчок по стенду вернул бы окну фокус.
    "plugin:window|is_visible": () => settings.active !== "off",
  };
}

/**
 * `active=on`: окно стенда держится активным, что бы ни делал браузер, —
 * например, пока ролик пишется и фокус у программы записи (стенд — и для
 * снимков README, и для промо-ролика). Без этого движение, часики и карусель
 * вставали бы всякий раз, когда вкладка стенда теряет фокус.
 *
 * Код приложения не меняется: стенд подменяет то, что `lib/windowActive.ts`
 * читает у браузера, — как подменяет мост. Перехватчики ставятся раньше
 * приложения и гасят события `blur` окна и `visibilitychange` страницы, а
 * чтения фокуса и видимости всегда отвечают «есть». Видимость окна от моста
 * стенд и так отвечает «видно».
 */
export function holdWindowActive(win: EventTarget, doc: EventTarget): void {
  const swallow = (e: Event) => e.stopImmediatePropagation();
  win.addEventListener("blur", swallow, { capture: true });
  doc.addEventListener("visibilitychange", swallow, { capture: true });
  Object.defineProperty(doc, "hasFocus", { configurable: true, value: () => true });
  Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => "visible" });
}

/**
 * Ставит перехватку моста на этой странице. Вызывать до загрузки `src/main.tsx`:
 * тот сразу спрашивает язык.
 */
export function installPreviewBackend(scenario: Scenario, settings: StandSettings = {}): void {
  const app = createHandlers(scenario, settings) as Record<string, Handler | undefined>;
  const plugins = pluginHandlers(settings);
  mockIPC(
    (cmd, payload) => {
      const handler = app[cmd] ?? plugins[cmd];
      if (!handler) {
        console.warn(`[preview] no answer for the command "${cmd}"`);
        return Promise.reject(`preview: no answer for "${cmd}"`);
      }
      return handler((payload ?? {}) as Args);
    },
    { shouldMockEvents: true },
  );
  // Страница спрашивает `getCurrentWindow()`; нужен хотя бы один «живой» ярлык окна.
  mockWindows("main");
  // `mockConvertFileSrc` превращает любой путь в `http://asset.localhost/<кодированный путь>`
  // и испортил бы адреса `data:` со стенда, поэтому путь отдаётся как есть.
  (
    window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string } }
  ).__TAURI_INTERNALS__.convertFileSrc = (path) => path;
  if (settings.active === "on") holdWindowActive(window, document);
}
