// Что свёрнуто на главном экране: разделы боковой панели и столбик соцсетей.
// Одно значение на всё приложение и на все игры, тот же приём, что у
// «Анимации» в motion.ts. Читается из конфига до первой отрисовки (main.tsx):
// свёрнутое после перезапуска сразу свёрнуто, без анимации.

import { useEffect, useState } from "react";

/** Что сворачивается; имена — как в Rust (`config::Fold`). */
export type CollapsePart = "codes" | "banners" | "videos" | "socials";

export type Collapsed = Record<CollapsePart, boolean>;

export const NOTHING_COLLAPSED: Collapsed = { codes: false, banners: false, videos: false, socials: false };

let current: Collapsed = NOTHING_COLLAPSED;
const listeners = new Set<(all: Collapsed) => void>();

/** Ответ моста. Недостающее или чужое поле — развёрнуто: страница не должна
 *  падать из-за конфига, записанного другой версией. */
export function asCollapsed(value: unknown): Collapsed {
  const raw = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const part = (key: CollapsePart) => raw[key] === true;
  return { codes: part("codes"), banners: part("banners"), videos: part("videos"), socials: part("socials") };
}

export function isCollapsed(part: CollapsePart): boolean {
  return current[part];
}

/** Всё сразу — при запуске, из конфига. */
export function setCollapsedAll(next: Collapsed): void {
  current = next;
  for (const listener of listeners) listener(next);
}

/**
 * Свернуть или развернуть одно и сохранить именно его (`save` — мост). Не
 * сохранилось — на экране остаётся выбранное: это лишь вид, и раздел, который
 * сам распахнулся обратно, путал бы сильнее, чем забытое после перезапуска.
 */
export function collapse(part: CollapsePart, value: boolean, save: (part: CollapsePart, value: boolean) => Promise<void>): void {
  if (current[part] === value) return;
  setCollapsedAll({ ...current, [part]: value });
  save(part, value).catch(() => undefined);
}

export function subscribeCollapsed(listener: (all: Collapsed) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Хук над `subscribeCollapsed` — свёрнуто ли `part`, живое значение. */
export function useCollapsed(part: CollapsePart): boolean {
  const [value, setValue] = useState(current[part]);
  useEffect(() => {
    setValue(current[part]);
    return subscribeCollapsed((all) => setValue(all[part]));
  }, [part]);
  return value;
}
