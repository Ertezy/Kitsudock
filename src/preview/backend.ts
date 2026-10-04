// Подмена системной части для стенда предпросмотра. Страница ходит в Rust только
// через `src/lib/api.ts` (команды `invoke` и плагины диалога, буфера и ссылок), а
// ещё слушает события и спрашивает окно, видно ли его. Здесь на каждый такой
// вызов отвечает таблица с тестовыми данными; встроенный `@tauri-apps/api/mocks`
// ставит саму перехватку. Ничего из этого файла в собранное приложение не
// попадает: его тянет только `src/preview/main.tsx`, а сборка берёт `index.html`.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { About, AppConfig, Behaviour, FoundGame, GameView } from "../types";
import type { Lang, VideoLang } from "../i18n/native";
import { artFromUrl } from "./art";
import { gameFromScan, makeGames, makeHub, makeScan } from "./data";

// ---------------------------------------------------------------- адрес стенда

/**
 * Состояние данных. `normal` — всё загружено; `loading` — хаб и список игр
 * отвечают через минуту, то есть пока не ответили; `offline` — сети нет, хаб
 * отказывает; `firstRun` — приложение запущено впервые, игр ещё нет.
 */
export type Scenario = "normal" | "loading" | "offline" | "firstRun";

export const SCENARIOS: readonly Scenario[] = ["normal", "loading", "offline", "firstRun"];

/** Варианты палитры. Следующие задачи дописывают сюда значения, больше ничего. */
export const PALETTES: readonly string[] = ["current"];

/** Всё состояние стенда — это адрес: `?scenario=normal&lang=ru&motion=on&palette=current`. */
export interface PreviewParams {
  scenario: Scenario;
  lang: Lang;
  motion: boolean;
  palette: string;
  /** Показывать ли плашку с переключателями; `controls=off` убирает её для снимков. */
  controls: boolean;
}

export const DEFAULT_PARAMS: PreviewParams = {
  scenario: "normal",
  lang: "ru",
  motion: true,
  palette: "current",
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
    palette: pick("palette", PALETTES, DEFAULT_PARAMS.palette),
    controls: q.get("controls") !== "off",
  };
}

/** Обратное к `readParams`: строка адреса с вопросительным знаком. */
export function toSearch(p: PreviewParams): string {
  const q = new URLSearchParams({
    scenario: p.scenario,
    lang: p.lang,
    motion: p.motion ? "on" : "off",
    palette: p.palette,
  });
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

/** Сколько «грузятся» данные в сценарии `loading`: за это время их не дождаться. */
const LOADING_MS = 60_000;
/** Сколько на стенде «запускается» игра: достаточно, чтобы разглядеть это состояние. */
const LAUNCH_MS = 1500;
/** Так отказывает `get_hub` в Rust: он возвращает `Result<_, String>`, то есть строку. */
const NO_NETWORK = "request to the hub failed: network is unreachable (os error 10051)";

/** Копия значения: мост отдаёт странице свежие данные, а не ссылку на состояние стенда. */
const clone = <T>(value: T): T => structuredClone(value);

const after = <T>(ms: number, make: () => T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(make()), ms));

/** Ответы на настройки, с которыми стенд открыт. */
export interface StandSettings {
  lang?: Lang;
  motion?: boolean;
}

function createHandlers(scenario: Scenario, settings: StandSettings): Record<AppCommand, Handler> {
  const firstRun = scenario === "firstRun";
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
  };

  const find = (gameId: unknown): GameView | undefined => state.games.find((g) => g.id === gameId);

  return {
    get_games: () => (scenario === "loading" ? after(LOADING_MS, () => clone(state.games)) : clone(state.games)),
    get_config: (): AppConfig => ({
      version: 1,
      hubUrl: state.hubUrl,
      lastPlayed: state.lastPlayed,
      seeded: state.seeded,
      behaviour: clone(state.behaviour),
      storeArt: state.storeArt,
      games: [],
    }),
    get_hub: () => {
      if (scenario === "offline") return Promise.reject(NO_NETWORK);
      const make = () => makeHub(Math.floor(Date.now() / 1000));
      return scenario === "loading" ? after(LOADING_MS, make) : make();
    },
    get_last_played: () => state.lastPlayed,
    launch_game: ({ gameId }) => {
      if (!find(gameId)) return Promise.reject({ code: "gameNotFound" });
      return after(LAUNCH_MS, () => {
        state.lastPlayed = String(gameId);
        return "";
      });
    },
    // Адреса картинок хаба стенд узнаёт сам и отвечает нарисованной картинкой;
    // без сети (`offline`) и для чужого адреса картинки нет, как у настоящего отказа.
    cache_image: ({ url }) => {
      if (scenario === "offline") return Promise.reject(NO_NETWORK);
      const art = artFromUrl(String(url));
      return art ?? Promise.reject(`no picture for ${String(url)} on the stand`);
    },

    add_game: ({ title }) => {
      const game = gameFromScan(String(title), state.games.length);
      state.games.push(game);
      return game.id;
    },
    update_game: (u) => {
      const game = find(u.gameId);
      if (!game) return Promise.reject({ code: "gameNotFound" });
      if (typeof u.title === "string") game.title = u.title;
      if (typeof u.contentId === "string") game.contentId = u.contentId === "" ? null : u.contentId;
      if (typeof u.args === "string") game.args = u.args;
      if (u.icon === "") game.iconPath = null;
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
    set_hub_url: ({ url }) => {
      state.hubUrl = typeof url === "string" && url !== "" ? url : null;
      return null;
    },
    image_cache_size: () => state.cacheBytes,
    clear_image_cache: () => {
      const freed = state.cacheBytes;
      state.cacheBytes = 0;
      return freed;
    },
    get_about: (): About => ({
      version: "0.1.0",
      logPath: "C:\\Users\\you\\AppData\\Roaming\\Kitsudock\\logs",
    }),
    open_log_folder: () => null,
    report_ui_error: () => null,
  };
}

/** Плагины отвечают заглушками без действия: диалог «отменён», буфер и ссылки ничего не делают. */
const PLUGIN_HANDLERS: Record<string, Handler> = {
  "plugin:dialog|open": () => null,
  // Вопрос с кнопками («Убрать игру?») — ответ «Отмена», чтобы стенд ничего не стирал.
  "plugin:dialog|message": () => "Cancel",
  "plugin:clipboard-manager|write_text": () => null,
  "plugin:opener|open_url": () => null,
  // Окно на стенде всегда видно.
  "plugin:window|is_visible": () => true,
};

/**
 * Ставит перехватку моста на этой странице. Вызывать до загрузки `src/main.tsx`:
 * тот сразу спрашивает язык.
 */
export function installPreviewBackend(scenario: Scenario, settings: StandSettings = {}): void {
  const app = createHandlers(scenario, settings) as Record<string, Handler | undefined>;
  mockIPC(
    (cmd, payload) => {
      const handler = app[cmd] ?? PLUGIN_HANDLERS[cmd];
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
}
