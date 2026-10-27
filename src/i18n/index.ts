// Текущий язык интерфейса — одно значение на всё приложение, тот же приём,
// что у «Анимации» в lib/motion.ts. Читается из конфига до первой отрисовки
// (main.tsx), меняется на вкладке «Вид» и на экране первого запуска; смена
// перерисовывает страницу сразу, без перезапуска.

import { useEffect, useState } from "react";
import { en, type Dictionary } from "./en";
import { ru } from "./ru";
import type { Lang } from "./native";

export type { Dictionary } from "./en";
export type { Lang, VideoLang } from "./native";

const DICTIONARIES: Record<Lang, Dictionary> = { en, ru };

let current: Lang = "en";
const listeners = new Set<(lang: Lang) => void>();

export function dictionary(lang: Lang): Dictionary {
  return DICTIONARIES[lang];
}

export function currentLang(): Lang {
  return current;
}

/** Словарь текущего языка — для кода вне React, которому язык не передать. */
export function currentT(): Dictionary {
  return DICTIONARIES[current];
}

/** Незнакомое значение (старый или испорченный конфиг) — английский. */
export function asLang(value: unknown): Lang {
  return value === "ru" ? "ru" : "en";
}

/** Запоминает язык, ставит его в `<html lang>` и сообщает подписчикам.
 *  `document` может не быть — тестовое окружение без DOM. */
export function setLanguage(next: Lang): void {
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener(next);
}

/** Подписка на смену языка. Возвращает функцию отписки. */
export function subscribeLanguage(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Текущий язык, живой на всё время жизни компонента. */
export function useLang(): Lang {
  const [value, setValue] = useState(current);
  useEffect(() => {
    // Язык мог смениться между первой отрисовкой и подпиской.
    setValue(current);
    return subscribeLanguage(setValue);
  }, []);
  return value;
}

/** Словарь текущего языка для компонента. */
export function useT(): Dictionary {
  return DICTIONARIES[useLang()];
}
