import { useLayoutEffect, useState, type RefObject } from "react";
import { sameSlots, type Slot } from "../../lib/pill";

/**
 * Замеры вариантов ряда — элементов `selector` внутри `ref`: где каждый
 * начинается вдоль оси и какой длины. По ним встаёт скользящая таблетка
 * (`lib/pill.ts`). Начало считается от внутреннего края рамки ряда — оттуда же
 * отсчитывается и положение таблетки внутри него.
 *
 * Меряется с долями точки: целые `offsetWidth` и `offsetLeft` на вариантах
 * дробной ширины оставляли таблетку на полточки уже варианта. Место на экране
 * (`getBoundingClientRect`) переводится обратно в точки раскладки делением на
 * растяжение ряда, поэтому подъём экрана при появлении и вдавленная строка
 * замер не искажают. Перемеряется до отрисовки — первый кадр уже с таблеткой
 * на месте — и потом при любой смене размеров ряда или вариантов (окно,
 * догрузившийся шрифт, другой язык подписей), а также при смене `key` — состава
 * и подписей вариантов.
 */
export function useSlots(ref: RefObject<HTMLElement>, selector: string, axis: "x" | "y", key: string): Slot[] | null {
  const [slots, setSlots] = useState<Slot[] | null>(null);

  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const items = () => [...row.querySelectorAll<HTMLElement>(selector)];
    const measure = () => {
      const box = row.getBoundingClientRect();
      const along = axis === "x" ? box.width : box.height;
      const layout = axis === "x" ? row.offsetWidth : row.offsetHeight;
      // Ряд не разложен (скрыт) — все длины нулевые, и таблетки не будет.
      // Расхождение меньше точки — округление целого `offsetWidth`, а не
      // растяжение: делить на него значило бы внести ту же ошибку обратно.
      const k = !(along > 0) ? 0 : Math.abs(layout - along) > 1 ? layout / along : 1;
      const edge = axis === "x" ? box.left : box.top;
      const border = axis === "x" ? row.clientLeft : row.clientTop;
      const next = items().map((el) => {
        const r = el.getBoundingClientRect();
        const start = axis === "x" ? r.left : r.top;
        const size = axis === "x" ? r.width : r.height;
        return { start: round((start - edge) * k - border), size: round(size * k) };
      });
      setSlots((prev) => (sameSlots(prev, next) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const el of items()) observer.observe(el);
    return () => observer.disconnect();
  }, [ref, selector, axis, key]);

  return slots;
}

/** До сотой доли точки: шум деления не должен считаться новым замером. */
const round = (n: number) => Math.round(n * 100) / 100;
