import type { HubData } from "../types";

/** Пока приложение открыто или лежит в трее, данные панели проверяются раз в 3 часа. */
export const REFRESH_EVERY_MS = 3 * 60 * 60 * 1000;

/** При возвращении окна данные проверяются, если с прошлой проверки прошёл час. */
export const REFRESH_ON_SHOW_AFTER_MS = 60 * 60 * 1000;

export function shouldRefreshOnShow(lastCheckMs: number, nowMs: number): boolean {
  return nowMs - lastCheckMs >= REFRESH_ON_SHOW_AFTER_MS;
}

/** Сеть появилась — данные проверяются, если с прошлой проверки прошло больше
 *  минуты: автозапуск мог стартовать раньше, чем подключился Wi-Fi. */
export const ONLINE_REFRESH_AFTER_MS = 60 * 1000;

export function shouldRefreshOnOnline(lastCheckMs: number, nowMs: number): boolean {
  return nowMs - lastCheckMs > ONLINE_REFRESH_AFTER_MS;
}

/** Те же ли данные. Сервер ответил «не изменилось» — панель перерисовывать незачем. */
export function sameHub(a: HubData | null, b: HubData | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Отпечаток официальных фонов игр: сменился — список игр надо перечитать,
 *  чтобы Rust взял новые фоны. Коды, баннеры и видео в отпечаток не
 *  входят. */
export function backgroundsKey(hub: HubData | null): string {
  return JSON.stringify((hub?.games ?? []).map((g) => [g.id, g.background ?? null]));
}
