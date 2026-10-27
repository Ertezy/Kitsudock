// Единственное место, которое знает, включена ли анимация в приложении.
// Тумблер «Анимация» на вкладке «Вид» заменяет собой системную настройку
// Windows «уменьшить движение» — она на приложение больше не влияет.

import { useEffect, useState } from "react";

let on = true;
const listeners = new Set<(on: boolean) => void>();

/** Включена ли анимация в приложении (тумблер «Анимация» на вкладке «Вид»).
 *  Настройка Windows «уменьшить движение» на приложение не влияет: эффекты
 *  анимации в Windows бывают выключены и у тех, кто хочет движения в
 *  приложении. */
export function motionOn(): boolean {
  return on;
}

/** Запоминает новое значение, отражает его в разметке для стилей и сообщает
 *  подписчикам. `document` может не быть — тестовое окружение без DOM. */
export function setMotion(next: boolean): void {
  on = next;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.motion = next ? "on" : "off";
  }
  for (const listener of listeners) listener(next);
}

/** Подписка на смену значения. Возвращает функцию отписки. */
export function subscribeMotion(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Хук над `subscribeMotion` — текущее значение, живое на всё время жизни компонента. */
export function useMotionOn(): boolean {
  const [value, setValue] = useState(on);
  useEffect(() => subscribeMotion(setValue), []);
  return value;
}
