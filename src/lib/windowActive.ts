// Активно ли окно: видно, не свёрнуто и в фокусе.
// Пока оно неактивно — например, человек в игре, — стоят видео фона,
// автопрокрутка баннеров и всё бесконечное фоновое движение в стилях, а когда
// человек возвращается, всё продолжается. Это не тумблер «Анимация»
// (`motion.ts`): тот убирает движение совсем, а неактивное окно лишь ставит
// его на паузу.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Три признака активного окна. */
export interface Signals {
  /** Окно не спрятано в трей. Уход в трей и возврат сообщает Rust
   *  (`tray::hide_main_window`, событие `window-visibility`). */
  shown: boolean;
  /** Окно не свёрнуто: свёрнутое страница видит сама (`visibilitychange`). */
  pageVisible: boolean;
  /** У окна фокус: события `focus` и `blur` на `window`. */
  focused: boolean;
}

/** Окно активно, только когда все три признака на месте. */
export function isActive(s: Signals): boolean {
  return s.shown && s.pageVisible && s.focused;
}

let signals: Signals = { shown: true, pageVisible: true, focused: true };
let active = true;
const listeners = new Set<(active: boolean) => void>();

/** Активно ли окно сейчас. */
export function windowActive(): boolean {
  return active;
}

/**
 * Обновляет признаки. Единственное место, которое пишет `data-active` на корень
 * для стилей: под `:root[data-active="off"]` бесконечные анимации стоят на
 * паузе там, где их застало. Подписчики слышат только смену активности, а не
 * каждое обновление признаков. `document` может не быть — тесты без DOM.
 */
export function setSignals(patch: Partial<Signals>): void {
  signals = { ...signals, ...patch };
  const next = isActive(signals);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.active = next ? "on" : "off";
  }
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener(next);
}

/** Подписка на смену активности. Возвращает функцию отписки. */
export function subscribeWindowActive(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Хук над `subscribeWindowActive`: активно ли окно, живое на всё время жизни компонента. */
export function useWindowActive(): boolean {
  const [value, setValue] = useState(active);
  useEffect(() => {
    // Активность могла смениться между отрисовкой и подпиской.
    setValue(active);
    return subscribeWindowActive(setValue);
  }, []);
  return value;
}

/**
 * Событие моста плюс начальное чтение — без гонки. Подписка ставится первой:
 * событие может прийти раньше, чем разрешится чтение, и тогда прочитанное уже
 * устарело — поверх события его применять нельзя. Отказ моста — не ошибка
 * страницы: признак остаётся прежним.
 */
export function follow(
  subscribe: (on: (value: boolean) => void) => Promise<() => void>,
  read: () => Promise<boolean>,
  apply: (value: boolean) => void,
): () => void {
  let alive = true;
  let arrived = false;
  // Через `new Promise`: и синхронный отказ (моста нет вовсе) становится
  // отказом обещания, а порядок «сначала подписка» сохраняется.
  const unsubscribe = new Promise<() => void>((resolve) =>
    resolve(
      subscribe((value) => {
        arrived = true;
        if (alive) apply(value);
      }),
    ),
  );
  unsubscribe.catch(() => {});
  new Promise<boolean>((resolve) => resolve(read())).then(
    (value) => {
      if (alive && !arrived) apply(value);
    },
    () => {},
  );
  return () => {
    alive = false;
    unsubscribe.then(
      (stop) => stop(),
      () => {},
    );
  };
}

/**
 * Ставит слежение за тремя признаками; возвращает снятие. Зовётся один раз из
 * `App`: слежение одно на всё приложение, а не своё у каждого компонента.
 */
export function watchWindowActivity(): () => void {
  const stopShown = follow(
    (on) => listen<boolean>("window-visibility", (e) => on(e.payload)),
    // Автозапуск создаёт окно сразу спрятанным, а событие о видимости при этом
    // не приходит — без начального чтения карусель и видео фона крутились бы
    // вхолостую в невидимом окне, пока его не открыли вручную ни разу.
    () => getCurrentWindow().isVisible(),
    (shown) => setSignals({ shown }),
  );

  // Фокус — событиями страницы и `document.hasFocus()`, а не `onFocusChanged`
  // и `isFocused()` из Tauri. В WebView2 у них один источник: Tauri сам делает
  // свои события фокуса из GotFocus и LostFocus контроллера WebView2
  // (`tauri-runtime-wry`, `add_focus_change_listeners`), а по ним же фокус
  // получает и теряет страница. Но начальное `isFocused()` у окна с одной
  // страницей в Windows смотрит на фокус самого окна верхнего уровня (`tao`),
  // а его wry тут же передаёт внутрь WebView2 (`WM_SETFOCUS` → `MoveFocus`):
  // окну перед глазами человека такое чтение может ответить «не в фокусе», и
  // всё стояло бы с самого запуска до первого переключения окон. Страница же
  // отвечает сразу и без моста, поэтому гонки между подпиской и чтением здесь
  // нет: подписка и чтение — в одном синхронном куске.
  const onFocus = () => setSignals({ focused: true });
  const onBlur = () => setSignals({ focused: false });
  const onVisibility = () => setSignals({ pageVisible: document.visibilityState === "visible" });
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  setSignals({ pageVisible: document.visibilityState === "visible", focused: document.hasFocus() });

  return () => {
    stopShown();
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
