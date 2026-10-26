import { hubFreshness } from "./time";
import { dictionary, type Dictionary, type Lang, type VideoLang } from "../i18n";
import type { Banner, Code, HubData, Video } from "../types";

/** Коды, которые ещё не сгорели, ближайшие к сгоранию первыми. */
export function activeCodes(codes: Code[], nowSec: number): Code[] {
  return codes
    .filter((c) => c.expiresAt === null || c.expiresAt > nowSec)
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
}

/** Баннеры, которые идут прямо сейчас. */
export function runningBanners(banners: Banner[], nowSec: number): Banner[] {
  return banners.filter((b) => b.startsAt <= nowSec && b.endsAt > nowSec);
}

/**
 * Есть ли у кода часики срока (спека полировки, §8.3): только у кода со
 * сроком, который ещё идёт. У бессрочного и сгоревшего их нет. Нет их и пока
 * строка срока говорит, что код не скопировался (`failed`): срока в ней тогда
 * нет. Последние сутки часики не прячут — они становятся горячими. Истина
 * заодно сужает тип: срок у кода — число.
 */
export function codeHasClock<T extends Pick<Code, "expiresAt">>(
  code: T,
  nowSec: number,
  failed: boolean,
): code is T & { expiresAt: number } {
  return !failed && code.expiresAt !== null && code.expiresAt > nowSec;
}

/**
 * Есть ли у баннера часики срока: только у идущего — уже начавшегося и ещё не
 * кончившегося. У будущего («Скоро · через …») и у кончившегося их нет.
 * Последние сутки часики не прячут — они становятся горячими.
 */
export function bannerHasClock(banner: Pick<Banner, "startsAt" | "endsAt">, nowSec: number): boolean {
  return banner.startsAt <= nowSec && banner.endsAt > nowSec;
}

/**
 * Сколько баннеров одной игры идёт в карусель. Каждый слайд держит свою
 * картинку, а значит и своё скачивание: без потолка щедрый файл хаба открывал
 * бы десятки загрузок разом. Хвост списка отбрасывается после обычного порядка.
 */
export const MAX_SHOWN_BANNERS = 12;

/**
 * Баннеры для карусели (спека этапа 7 §3.1): сначала идущие — ближайшие к
 * окончанию первыми, затем будущие — ближайшие к началу первыми. Кончившиеся
 * не показываются. Больше `MAX_SHOWN_BANNERS` не бывает: лишние — те, что
 * стоят в этом порядке последними.
 */
export function shownBanners(banners: Banner[], nowSec: number): Banner[] {
  const running = runningBanners(banners, nowSec).sort((a, b) => a.endsAt - b.endsAt);
  const upcoming = banners.filter((b) => b.startsAt > nowSec).sort((a, b) => a.startsAt - b.startsAt);
  return [...running, ...upcoming].slice(0, MAX_SHOWN_BANNERS);
}

/**
 * Ключи для карусели баннеров (правка финальной ревизии этапа 7): игры и
 * момента начала одних не хватает — у владельца в данных есть пары баннеров
 * одной игры с общим стартом, и `${gameId}:${startsAt}` у них совпадает.
 * Добавляем заголовок, а точные повторы (тот же заголовок тоже) разводит
 * счётчик встречи. Считается один раз за отрисовку и используется и для
 * слайдов, и для точек, и для `shownKey`, чтобы все три места не разошлись.
 */
export function bannerKeys(shown: Banner[]): string[] {
  const seen = new Map<string, number>();
  return shown.map((b) => {
    const base = `${b.gameId}:${b.startsAt}:${b.title}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

/**
 * Панели нечего показать (спека этапа 5, §8). Считается теми же функциями,
 * которыми секции решают, рисоваться ли: отдельная проверка разошлась бы с ними,
 * и панель то молчала бы при пустых секциях, то писала «пусто» под кодами.
 * Будущие баннеры тоже считаются содержимым (этап 7).
 */
export function panelIsEmpty(
  codes: Code[],
  banners: Banner[],
  videos: Video[],
  nowSec: number,
): boolean {
  return (
    activeCodes(codes, nowSec).length === 0 &&
    shownBanners(banners, nowSec).length === 0 &&
    videos.length === 0
  );
}

/**
 * Почему панель пуста — от этого зависит, что ей сказать (спека полировки, §5):
 * - `listFailed` — список игр не загрузился (`listFailed`): игр не видно, но
 *   «игр нет» было бы неправдой;
 * - `noGames` — игр нет вовсе, выбирать нечего;
 * - `unlinked` — игра не связана с данными, но данные под её названием есть
 *   (`linkable`): их можно выбрать в настройках игры;
 * - `uncollected` — игра не связана, и по названию данных для неё не видно:
 *   их может не быть вовсе, а может быть под другим названием (игра добавлена
 *   вручную или переименована). Подсказка верна в обоих случаях: связать, если
 *   данные для неё собираются;
 * - `stale` — данные старше недели, коды и баннеры спрятаны, а видео нет;
 * - `quiet` — данные свежие, просто сейчас ничего не идёт.
 */
export type EmptyReason = "listFailed" | "noGames" | "unlinked" | "uncollected" | "stale" | "quiet";

export function emptyReason(state: {
  hasGame: boolean;
  contentId: string | null;
  linkable: boolean;
  tooOld: boolean;
  /** Последняя загрузка списка игр не удалась; удачная снимает отметку. */
  listFailed?: boolean;
}): EmptyReason {
  if (!state.hasGame) return state.listFailed ? "listFailed" : "noGames";
  if (state.contentId === null) return state.linkable ? "unlinked" : "uncollected";
  return state.tooOld ? "stale" : "quiet";
}

/**
 * Рисунок пустой панели (`EmptyState`). Отказ — без рисунка: список игр не
 * загрузился, и сцена «здесь пока пусто» сказала бы неправду.
 */
export function emptyArt(reason: EmptyReason): "card" | "none" {
  return reason === "listFailed" ? "none" : "card";
}

/**
 * Название, как его сравнивает Rust (`catalog::normalize`): только буквы и
 * цифры, без регистра. «Arknights: Endfield» и «arknights endfield» — одно.
 */
function normalizeTitle(title: string): string {
  return [...title].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).join("").toLowerCase();
}

/**
 * Есть ли в данных игра с тем же названием и хоть что-то собранное по ней —
 * коды, баннеры или видео. Только тогда несвязанной игре имеет смысл
 * предлагать привязку: иначе подсказка звала бы привязать её к чужим данным.
 * Найденные среди установленных такие игры Rust связывает сам
 * (`catalog::enrich_from_stores`); несвязанной с совпадающим названием игра
 * остаётся, например, добавленная вручную или со снятой в настройках связью.
 */
export function linkable(hub: HubData | null, title: string | null): boolean {
  if (!hub || title === null) return false;
  const name = normalizeTitle(title);
  const collected = new Set([...hub.codes, ...hub.banners, ...hub.videos].map((x) => x.gameId));
  return hub.games.some((g) => collected.has(g.id) && normalizeTitle(g.title) === name);
}

/**
 * Видео игры на выбранном языке; если их нет — английские этой игры (спека
 * этапа 6 §3.3); если и английских нет (лента для этого языка ни разу не
 * сработала) — любые видео игры, лишь бы секция не пропадала совсем. Видео
 * без `lang` — английское: так записаны файлы до этапа 6.
 */
export function videosFor(videos: Video[], gameId: string, lang: VideoLang): Video[] {
  const ofGame = videos.filter((v) => v.gameId === gameId);
  const langOf = (v: Video) => v.lang ?? "en";
  const wanted = ofGame.filter((v) => langOf(v) === lang);
  if (wanted.length > 0) return wanted;
  const english = ofGame.filter((v) => langOf(v) === "en");
  return english.length > 0 ? english : ofGame;
}

/**
 * Промокоды выбранной в доке игры; без выбранной игры — пусто. Так же, как
 * баннеры и видео, а не по всем играм сразу: решение владельца на этапе 7
 * (29 сентября), оно отменило решение этапа 2. Правило протухания данных
 * здесь не проверяется — его держит панель.
 */
export function codesFor(codes: Code[], gameId: string | null): Code[] {
  return gameId === null ? [] : codes.filter((c) => c.gameId === gameId);
}

/**
 * Заменяет неразрывные и цифровые пробелы (U+00A0, U+2007, U+202F) обычным.
 * Заголовки из данных коллектора бывают склеены такими пробелами: браузер не
 * переносит строку между словами, весь заголовок становится одним нерезаемым
 * куском и раздвигает панель вбок. Меняется только показываемый текст —
 * ключи, ссылки и обработчики остаются на исходных данных.
 */
export function plainSpaces(text: string): string {
  return text.replace(/[\u00A0\u2007\u202F]/g, " ");
}

/** Откуда пришли данные — словами, одинаковыми на панели и во «Данных». */
export function sourceLabel(source: string | undefined, t: Dictionary): string {
  if (source === undefined) return "";
  const labels = t.panel.sources as unknown as Record<string, string | undefined>;
  return labels[source] ?? t.panel.unknownSource;
}

/**
 * Строка состояния на вкладке «Данные» (спека этапа 5, §7.5): источник и
 * свежесть, как в подвале панели. Данные из комплекта — тоже: подвал говорит о
 * них «данные свежие · из комплекта», и вкладка не должна спорить с ним.
 * «Свежих данных пока нет» — только когда данных нет вовсе или в них нет ни
 * кодов, ни баннеров, ни видео.
 */
export function dataStatus(hub: HubData | null, nowSec: number, lang: Lang): string {
  const t = dictionary(lang);
  if (!hub) return t.panel.noDataYet;
  if (hub.codes.length === 0 && hub.banners.length === 0 && hub.videos.length === 0) {
    return t.panel.noDataYet;
  }
  return t.panel.dataStatus(sourceLabel(hub._source, t), hubFreshness(hub.updatedAt, nowSec, lang));
}
