import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { About, AppConfig, Behaviour, FoundGame, GameView, HubData } from "../types";
import { currentT, type Lang, type VideoLang } from "../i18n";

/**
 * Типизированные обёртки над мостом Tauri.
 * Вся системная работа — запуск, конфиг, данные хаба — происходит в Rust.
 */
export const api = {
  getGames: () => invoke<GameView[]>("get_games"),
  /** Весь конфиг целиком. Использовать только ради конкретного поля —
   *  показывать его содержимое на экране нельзя. */
  getConfig: () => invoke<AppConfig>("get_config"),
  getHub: () => invoke<HubData>("get_hub"),
  getLastPlayed: () => invoke<string | null>("get_last_played"),
  launchGame: (gameId: string) => invoke<string>("launch_game", { gameId }),

  /** Путь к картинке в локальном кеше; Rust качает её, если надо. */
  cacheImage: (url: string) => invoke<string>("cache_image", { url }),

  /** Положить текст в буфер обмена. */
  copyText: (text: string) => writeText(text),

  /**
   * Открыть внешнюю ссылку в браузере пользователя.
   * Только https: данные хаба приходят из сети и не должны иметь возможности
   * дёрнуть file:// или произвольный обработчик протокола.
   */
  openSafeUrl: async (url: string) => {
    if (!url.startsWith("https://")) {
      throw new Error(currentT().main.refuseNonHttps(url));
    }
    await openUrl(url);
  },

  addGame: (title: string, exe: string) => invoke<string>("add_game", { title, exe }),
  updateGame: (args: {
    gameId: string;
    title?: string;
    exe?: string;
    // Пустая строка стирает свой фон; отсутствие поля её не трогает. Та же
    // причина, что и у `contentId` — `null` неотличим от отсутствующего
    // поля при переходе через JSON.
    background?: string;
    // Пустая строка стирает привязку; отсутствие поля её не трогает.
    // `null` здесь не годится — при переходе через JSON он неотличим от
    // отсутствующего поля, и стереть привязку было бы невозможно.
    contentId?: string;
    // Пустая строка стирает свою картинку иконки; отсутствие поля её не
    // трогает. Та же причина, что и у `contentId` — `null` неотличим от
    // отсутствующего поля при переходе через JSON.
    icon?: string;
    // Пустая строка стирает своё видео; отсутствие поля его не трогает.
    video?: string;
    // Заменяет аргументы запуска целиком. Пустая строка здесь не стирание,
    // а обычное значение — «запускать без аргументов».
    args?: string;
  }) => invoke<void>("update_game", args),
  removeGame: (gameId: string) => invoke<void>("remove_game", { gameId }),
  reorderGames: (ids: string[]) => invoke<void>("reorder_games", { ids }),
  relocateGame: (gameId: string) => invoke<void>("relocate_game", { gameId }),
  scanInstalled: () => invoke<FoundGame[]>("scan_installed"),
  addGameFromScan: (title: string) => invoke<string>("add_game_from_scan", { title }),

  /** Первый запуск ещё не состоялся — вместо главного экрана нужен экран с галочками. */
  needsFirstRun: () => invoke<boolean>("needs_first_run"),
  /** Пометить, что первый запуск состоялся — не важно, что человек на нём выбрал. */
  markSeeded: () => invoke<void>("mark_seeded"),

  getBehaviour: () => invoke<Behaviour>("get_behaviour"),
  setBehaviour: (b: Behaviour) =>
    invoke<void>("set_behaviour", { closeToTray: b.closeToTray, trayOnLaunch: b.trayOnLaunch }),

  getStoreArt: () => invoke<boolean>("get_store_art"),
  setStoreArt: (enabled: boolean) => invoke<void>("set_store_art", { enabled }),

  getAnimation: () => invoke<boolean>("get_animation"),
  setAnimation: (enabled: boolean) => invoke<void>("set_animation", { enabled }),

  getLanguage: () => invoke<Lang>("get_language"),
  setLanguage: (language: Lang) => invoke<void>("set_language", { language }),
  getVideoLanguage: () => invoke<VideoLang>("get_video_language"),
  setVideoLanguage: (language: VideoLang) => invoke<void>("set_video_language", { language }),
  getAutostart: () => invoke<boolean>("get_autostart"),
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),

  /** Проверяет выбранный файл видео (формат, вес) и разрешает окну читать его. */
  checkVideo: (path: string) => invoke<void>("check_video", { path }),

  setHubUrl: (url: string | null) => invoke<void>("set_hub_url", { url }),
  imageCacheSize: () => invoke<number>("image_cache_size"),
  clearImageCache: () => invoke<number>("clear_image_cache"),
  getAbout: () => invoke<About>("get_about"),
  openLogFolder: () => invoke<void>("open_log_folder"),
  /** Записать в журнал приложения, из-за чего упал интерфейс (Rust режет и чистит текст). */
  reportUiError: (message: string) => invoke<void>("report_ui_error", { message }),

  /** Выбрать исполняемый файл игры. `null` — человек отменил. */
  pickExe: async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: currentT().main.filters.program, extensions: ["exe"] }],
    });
    return typeof picked === "string" ? picked : null;
  },

  /** Выбрать картинку фона. `null` — человек отменил. */
  pickImage: async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: currentT().main.filters.image, extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    return typeof picked === "string" ? picked : null;
  },

  /** Выбрать видео фона. `null` — человек отменил. */
  pickVideo: async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: currentT().main.filters.video, extensions: ["mp4", "webm"] }],
    });
    return typeof picked === "string" ? picked : null;
  },
};
