// Язык видео в панели — одно значение на всё приложение, тот же приём, что у
// «Анимации» в motion.ts. Читается из конфига до первой отрисовки (main.tsx),
// меняется на вкладке «Вид».

import { useEffect, useState } from "react";
import type { VideoLang } from "../i18n";

let current: VideoLang = "en";
const listeners = new Set<(lang: VideoLang) => void>();

export function videoLanguage(): VideoLang {
  return current;
}

/** Незнакомое значение — английский. */
export function asVideoLang(value: unknown): VideoLang {
  return value === "ja" ? "ja" : "en";
}

export function setVideoLanguage(next: VideoLang): void {
  current = next;
  for (const listener of listeners) listener(next);
}

export function subscribeVideoLanguage(listener: (lang: VideoLang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVideoLanguage(): VideoLang {
  const [value, setValue] = useState(current);
  useEffect(() => {
    setValue(current);
    return subscribeVideoLanguage(setValue);
  }, []);
  return value;
}
