// Стопка слоёв фона главного экрана (`GameArt`). Отдельно от компонента, чтобы
// порядок появления и ухода слоёв проверялся тестами без окна.
//
// Правило одно: прежний фон уходит только тогда, когда новый уже закрыл его
// целиком. Новый слой ложится сверху невидимым и ждёт, пока загрузится его
// картинка или первый кадр ролика; потом проявляется, и лишь после этого всё
// под ним убирается. Так между фонами никогда не проглядывает заливка окна — ни
// при медленной загрузке, ни при быстром переключении игр подряд.

export interface ArtEntry<L> {
  /** Ключ для React: один и тот же фон может лежать в стопке дважды. */
  id: number;
  /** Какой это фон: по ключу видно, что фон сменился. */
  key: string;
  layer: L;
  /** Загрузился и проявляется (или уже проявился). Неготовый слой невидим. */
  ready: boolean;
}

/**
 * Новый фон кладётся наверх. Слой, который так и не загрузился, уходит сразу:
 * его ни разу не было видно, и закрывать он ничего не закрывает. Если после
 * этого сверху уже нужный фон — класть его второй раз незачем.
 *
 * `instant` — анимация выключена: готовый сразу слой (заливка) тут же убирает
 * всё под собой, перетекания нет.
 */
export function pushLayer<L>(stack: ArtEntry<L>[], entry: ArtEntry<L>, instant: boolean): ArtEntry<L>[] {
  const top = stack[stack.length - 1];
  if (top?.key === entry.key) return stack;
  const shown = stack.filter((e) => e.ready);
  if (shown[shown.length - 1]?.key === entry.key) return shown;
  const next = [...shown, entry];
  return entry.ready && instant ? next.slice(-1) : next;
}

/** Слой загрузился. При выключенной анимации он сразу же убирает всё под собой. */
export function markReady<L>(stack: ArtEntry<L>[], id: number, instant: boolean): ArtEntry<L>[] {
  const at = stack.findIndex((e) => e.id === id);
  if (at < 0) return stack;
  const next = stack[at].ready ? stack : stack.map((e, i) => (i === at ? { ...e, ready: true } : e));
  return instant ? settleLayer(next, id) : next;
}

/** Слой проявился целиком: всё, что под ним, больше не видно и уходит. */
export function settleLayer<L>(stack: ArtEntry<L>[], id: number): ArtEntry<L>[] {
  const at = stack.findIndex((e) => e.id === id);
  if (at <= 0 || !stack[at].ready) return stack;
  return stack.slice(at);
}

/**
 * Начал ли проявляться фон с этим ключом. Пока нет — подпись и кнопка PLAY
 * ждут: они поднимаются вслед за фоном, а не раньше него, даже если большая
 * картинка грузится долго. Сразу после выбора игры слой под неё ещё не лёг
 * (это делает эффект), поэтому ключ сверяется, а не только готовность.
 */
export function isShown<L>(stack: ArtEntry<L>[], key: string): boolean {
  const top = stack[stack.length - 1];
  return top !== undefined && top.key === key && top.ready;
}

/** Анимация проявления слоя (`@keyframes` в `styles.css`). */
export const ENTER = "art-enter";

/**
 * Событие анимации — конец (или обрыв) проявления самого слоя. Дрейф
 * картинки внутри слоя тоже анимация, и его события всплывают сюда же.
 */
export function isOwnEnter(e: { target: unknown; currentTarget: unknown; animationName: string }): boolean {
  return e.target === e.currentTarget && e.animationName === ENTER;
}

/**
 * Анимацию выключили посреди перетекания: перетекание обрывается, и остаётся
 * верхний показанный слой (и ещё не загрузившийся над ним, если такой есть).
 */
export function settleAll<L>(stack: ArtEntry<L>[]): ArtEntry<L>[] {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].ready) return i === 0 ? stack : stack.slice(i);
  }
  return stack;
}
