import { describe, it, expect } from "vitest";
import { PILL_BASE, pillPlacement, sameSlots, type Slot } from "./pill";

describe("место «таблетки» под выбранным вариантом", () => {
  // Как у выбора языка: поле в 2px, варианты разной ширины через зазор в 2px.
  const slots: Slot[] = [
    { start: 2, size: 76 },
    { start: 80, size: 90 },
    { start: 172, size: 64 },
  ];

  it("встаёт ровно под выбранный вариант: сдвиг — его начало", () => {
    expect(pillPlacement(slots, 0)?.offset).toBe(2);
    expect(pillPlacement(slots, 1)?.offset).toBe(80);
    expect(pillPlacement(slots, 2)?.offset).toBe(172);
  });

  it("ширину набирает растяжением от постоянной основы: варианты бывают разной ширины", () => {
    const wide = pillPlacement(slots, 1);
    expect(wide?.size).toBe(90);
    expect(wide?.scale).toBeCloseTo(90 / PILL_BASE, 10);
    expect((wide?.scale ?? 0) * PILL_BASE).toBeCloseTo(90, 10);
    expect(pillPlacement(slots, 2)?.scale).toBeCloseTo(0.64, 10);
  });

  it("в ряду вкладок подложка встаёт на начало вкладки и берёт её высоту — как их ставит экран настроек", () => {
    // Замер ряда вкладок от его начала: вкладки по 37 точек через зазор в 2.
    const tabs: Slot[] = [0, 39, 78, 117, 156].map((start) => ({ start, size: 37 }));
    const pill = pillPlacement(tabs, 3);
    expect(pill?.offset).toBe(117);
    expect(pill?.size).toBe(37);
  });

  it("выбранного варианта нет среди вариантов — таблетки нет", () => {
    expect(pillPlacement(slots, -1)).toBeNull();
    expect(pillPlacement(slots, 3)).toBeNull();
    expect(pillPlacement([], 0)).toBeNull();
  });

  it("варианты ещё не разложены (скрытая вкладка, нулевой размер) — таблетки нет, а не таблетка нулевой ширины", () => {
    expect(pillPlacement([{ start: 0, size: 0 }], 0)).toBeNull();
    expect(pillPlacement([{ start: Number.NaN, size: 20 }], 0)).toBeNull();
  });
});

describe("сравнение замеров", () => {
  it("одинаковые замеры — те же: состояние не перезаписывается и отрисовка не повторяется", () => {
    expect(sameSlots([{ start: 2, size: 76 }], [{ start: 2, size: 76 }])).toBe(true);
    expect(sameSlots([], [])).toBe(true);
  });

  it("любое отличие — другой замер", () => {
    expect(sameSlots([{ start: 2, size: 76 }], [{ start: 2, size: 77 }])).toBe(false);
    expect(sameSlots([{ start: 2, size: 76 }], [{ start: 3, size: 76 }])).toBe(false);
    expect(sameSlots([{ start: 2, size: 76 }], [])).toBe(false);
    expect(sameSlots(null, [])).toBe(false);
  });
});
