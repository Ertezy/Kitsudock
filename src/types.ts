// Зеркала Rust-схем. На проводе camelCase (serde rename_all = "camelCase").

/** Вид запуска кодом — слово на языке интерфейса подставляет страница. */
export type SourceKind = "steam" | "epic" | "exe";
/** Откуда найдена игра на экране сканирования: к способам запуска добавляются
 *  собственные лаунчеры — после добавления такая игра запускается как `exe`. */
export type FoundSourceKind = SourceKind | "hoyoplay" | "kuro" | "gryphlink";

export interface GameView {
  id: string;
  title: string;
  contentId: string | null;
  sourceKind: SourceKind;
  /** Путь к файлу иконки. `null` — рисуется заглушка с буквой. */
  iconPath: string | null;
  /** Путь к фоновой картинке. `null` — рисуется сгенерированная заливка. */
  artPath: string | null;
  /** Откуда взят фон, показанный первым. */
  artSource: "video" | "picture" | "hoyoplay" | "steam" | "epic" | "fill";
  /** Видео фона: своё или официальное из HoYoPlay (смотри `artSource`).
   *  `null` — видео нет или файл пропал. */
  videoPath: string | null;
  /** Своё видео задано, но файла на месте нет. */
  videoMissing: boolean;
  /** Аргументы запуска. Действуют только при прямом запуске — Steam и Epic
   *  открывают ссылку магазина и передать их игре не могут. */
  args: string;
  /** Файл или папка игры пропали с диска. */
  missing: boolean;
}

export interface HubGame {
  id: string;
  title: string;
  /** Шаблон с подстановкой {code}. Отсутствует у игр без веб-погашения. */
  redeemUrl: string | null;
  /** Текущий фон официального лаунчера: картинка и, если есть, видео. */
  background?: { image: string; video?: string };
  /** Официальные соцсети игры по языкам интерфейса, в порядке показа. Нет
   *  списка для языка — нет ключа; нет ни одного — нет поля. Адреса уже
   *  проверены в Rust (`lenient_socials`). */
  socials?: { ru?: Social[]; en?: Social[] };
}

/** Официальная соцсеть или сайт игры. */
export type SocialKind =
  | "hoyolab"
  | "site"
  | "youtube"
  | "x"
  | "discord"
  | "reddit"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "telegram"
  | "vk";

export interface Social {
  kind: SocialKind;
  url: string;
}

export interface Code {
  gameId: string;
  code: string;
  rewards: string;
  /** unix-секунды; null — бессрочный. */
  expiresAt: number | null;
  region: string;
  source: string | null;
}

export interface Banner {
  gameId: string;
  title: string;
  featured: string[];
  rarity: number | null;
  /** Уже уменьшенный адрес; null у ХСР — вики не хранит арт. */
  image: string | null;
  startsAt: number;
  endsAt: number;
  url: string | null;
}

export interface Video {
  gameId: string;
  /** "en" или "ja"; у старых файлов поля нет — такое видео английское. */
  lang?: string;
  title: string;
  url: string;
  thumb: string | null;
  publishedAt: number;
  duration: number | null;
  premiere: boolean;
}

/** Последняя опубликованная версия приложения. */
export interface AppRelease {
  version: string;
  url: string;
}

export interface HubData {
  version: number;
  updatedAt: number;
  games: HubGame[];
  codes: Code[];
  banners: Banner[];
  videos: Video[];
  app?: AppRelease;
  _source?: string;
}

export interface LaunchResult {
  ok: boolean;
  msg: string;
}

export interface Behaviour {
  closeToTray: boolean;
  trayOnLaunch: boolean;
}

export interface FoundGame {
  /** Ключ установки: по нему строка отмечается и добавляется. Название у
   *  установок из Steam и Epic бывает одно и то же. */
  key: string;
  title: string;
  contentId: string | null;
  sourceKind: FoundSourceKind;
  alreadyAdded: boolean;
}

export interface About {
  version: string;
  logPath: string;
}

/**
 * Полный конфиг пользователя, как его отдаёт `get_config`. Список игр здесь —
 * сырые записи конфига, а не `GameView`; экрану «Данные» из всего этого нужен
 * только `hubUrl`, поэтому остальная форма намеренно не расписана подробнее.
 */
export interface AppConfig {
  version: number;
  hubUrl: string | null;
  lastPlayed: string | null;
  seeded: boolean;
  behaviour: Behaviour;
  storeArt: boolean;
  games: unknown[];
}
