import type { HubData } from "../types";

/** Пока приложение открыто или лежит в трее, данные панели проверяются раз в 3 часа. */
export const REFRESH_EVERY_MS = 3 * 60 * 60 * 1000;

/** При возвращении окна данные проверяются, если с прошлой проверки прошёл час. */
export const REFRESH_ON_SHOW_AFTER_MS = 60 * 60 * 1000;

export function shouldRefreshOnShow(lastCheckMs: number, nowMs: number): boolean {
  return nowMs - lastCheckMs >= REFRESH_ON_SHOW_AFTER_MS;
}

/** Сеть появилась — данные проверяются, если с прошлой удачной проверки прошло
 *  больше минуты: автозапуск мог стартовать раньше, чем подключился Wi-Fi. */
export const ONLINE_REFRESH_AFTER_MS = 60 * 1000;

/** Последняя проверка данных панели: когда началась и дошла ли до сервера. */
export interface HubCheck {
  at: number;
  reachedServer: boolean;
}

/** Проверка, которая не дошла до сервера, минуту не ждёт: приложение могло
 *  стартовать без сети, и сеть вернулась через несколько секунд. Минута
 *  сдерживает только повтор после удачной проверки. */
export function shouldRefreshOnOnline(last: HubCheck, nowMs: number): boolean {
  return !last.reachedServer || nowMs - last.at > ONLINE_REFRESH_AFTER_MS;
}

/** Дошёл ли запрос до сервера. Без сети `get_hub` не падает, а отдаёт кеш или
 *  файл из комплекта — с другим `_source`. */
export function reachedServer(hub: HubData): boolean {
  return hub._source === "remote";
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
