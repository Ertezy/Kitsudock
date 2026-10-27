import type { FoundGame } from "../types";

/**
 * Что отмечено на экране поиска сразу: игры, по которым есть данные, и только
 * те, которых ещё нет в списке. Из нескольких установок с одним названием
 * (Steam и Epic) отмечается первая — в доке игра нужна один раз, вторую
 * человек отметит сам.
 */
export function defaultChecked(list: FoundGame[]): Set<string> {
  const titles = new Set<string>();
  const keys = new Set<string>();
  for (const g of list) {
    if (g.contentId === null || g.alreadyAdded || titles.has(g.title)) continue;
    titles.add(g.title);
    keys.add(g.key);
  }
  return keys;
}

/**
 * Добавляет отмеченные установки по одной. После каждой удачной зовёт
 * `onAdded`, чтобы экран пометил её добавленной: если следующая сорвётся,
 * повторное нажатие не станет добавлять уже добавленные. Повтор Rust и сам
 * не задвоит (`library::add_found`), но лишних запросов и подписей не нужно.
 * Ошибка прерывает цикл и уходит вызывающему.
 */
export async function addChecked(
  list: FoundGame[],
  checked: ReadonlySet<string>,
  add: (game: FoundGame) => Promise<unknown>,
  onAdded: (key: string) => void,
): Promise<void> {
  for (const g of list) {
    if (!checked.has(g.key) || g.alreadyAdded) continue;
    await add(g);
    onAdded(g.key);
  }
}
