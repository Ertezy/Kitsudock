import type { AppRelease, HubData } from "../types";

/**
 * «1.2.3» → [1, 2, 3]; любой другой вид — null. То же правило — в приложении на
 * Rust (`src-tauri/src/hub/schema.rs`, `lenient_app`) и у сборщика.
 */
function parts(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Новее ли a, чем b, по трём числам. Номер, который не читается, новее не бывает. */
export function isNewer(a: string, b: string): boolean {
  const x = parts(a);
  const y = parts(b);
  if (x === null || y === null) return false;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i]! > y[i]!;
  }
  return false;
}

/** Страницы релизов приложения: только они годятся как ссылка «Скачать». */
const RELEASES_URL_PREFIX = "https://github.com/Ertezy/Kitsudock/releases/";

// Сегмент пути «.» или «..», в том числе в записи %2e любого регистра: разбор
// адреса такие сегменты сворачивает, и ссылка приходит не туда, куда читается
// в строке.
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;
// Обратная косая черта, пробелы всех видов и управляющие знаки.
const FORBIDDEN = /[\s\p{Cc}\\]/u;

/**
 * Ссылка на страницу релиза этого приложения: строка начинается с
 * RELEASES_URL_PREFIX, в пути нет сегментов «.» и «..», а во всей строке —
 * обратной косой черты, пробелов и управляющих знаков. То же правило — в
 * приложении на Rust (`src-tauri/src/hub/schema.rs`, `is_release_url`) и у
 * сборщика (`appUrlOk`).
 */
export function isReleaseUrl(url: string): boolean {
  if (!url.startsWith(RELEASES_URL_PREFIX) || FORBIDDEN.test(url)) return false;
  // Путь кончается на «?» или «#»: «..» в запросе и якоре ничего не сворачивает.
  const path = url.slice(RELEASES_URL_PREFIX.length).split(/[?#]/, 1)[0]!;
  return !path.split("/").some((segment) => DOT_SEGMENT.test(segment));
}

/**
 * Вышедшая версия, о которой стоит сказать: из файла хаба, строго новее
 * работающей и со ссылкой на страницу релизов приложения. Иначе null — строки
 * «Вышла версия» нет.
 */
export function availableUpdate(hub: HubData | null, current: string | null): AppRelease | null {
  const app = hub?.app;
  if (!app || current === null) return null;
  return isNewer(app.version, current) && isReleaseUrl(app.url) ? app : null;
}

/**
 * Нажатие «Обновить»: для какой версии и чем пока кончилось. Удачи здесь нет:
 * удачная установка закрывает приложение, и ответа страница не дожидается.
 */
export interface UpdateAttempt {
  version: string;
  stage: "installing" | "failed";
  /** Причина отказа словами — для всплывающей подсказки. */
  reason?: string;
}

/** Что показывает строка «Вышла версия» внизу боковой панели. */
export type UpdateRow =
  | { stage: "offer"; version: string }
  | { stage: "installing" }
  | { stage: "failed"; url: string; reason?: string };

/**
 * Строка внизу панели. Идущая установка видна всегда, даже если файл данных
 * тем временем сменился: она уже идёт, и предлагать вторую нельзя. Отказ
 * относится только к своей версии: вышла версия новее — снова предлагается
 * обновиться.
 */
export function updateRow(update: AppRelease | null, attempt: UpdateAttempt | null): UpdateRow | null {
  if (attempt?.stage === "installing") return { stage: "installing" };
  if (update === null) return null;
  if (attempt?.stage === "failed" && attempt.version === update.version) {
    return { stage: "failed", url: update.url, reason: attempt.reason };
  }
  return { stage: "offer", version: update.version };
}

/** Нажатие «Обновить»: новая попытка или null, если сейчас нажимать нечего. */
export function startUpdate(update: AppRelease | null, attempt: UpdateAttempt | null): UpdateAttempt | null {
  const row = updateRow(update, attempt);
  return row?.stage === "offer" ? { version: row.version, stage: "installing" } : null;
}

/** Установка отказала. */
export function updateFailed(attempt: UpdateAttempt, reason: string): UpdateAttempt {
  return { version: attempt.version, stage: "failed", reason };
}
