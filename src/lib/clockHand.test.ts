import { describe, expect, it } from "vitest";
import rawCss from "../styles.css?raw";
import { CLOCK_TURN_HOT_MS, CLOCK_TURN_MS, clockHandDelay } from "./clockHand";

/** Задержка разобрана: переменная оборота и множитель. */
function parse(delay: string): { token: string; factor: number } {
  const m = /^calc\(var\((--move-clock(?:-hot)?)\) \* (-?\d+(?:\.\d+)?)\)$/.exec(delay);
  if (!m) throw new Error(`задержка «${delay}» должна быть вида calc(var(--move-clock…) * -доля)`);
  return { token: m[1], factor: Number(m[2]) };
}

/**
 * Где стрелка в миг `nowMs` — доля оборота от двенадцати, — если её анимация
 * началась в `startMs` с этой задержкой. Пока окно активно и тумблер включён,
 * анимация идёт вместе с часами компьютера.
 */
function phaseAt(startMs: number, nowMs: number, hot: boolean): number {
  const turn = hot ? CLOCK_TURN_HOT_MS : CLOCK_TURN_MS;
  const { factor } = parse(clockHandDelay(startMs, hot));
  const p = ((nowMs - startMs) / turn - factor) % 1;
  return p < 0 ? p + 1 : p;
}

/** Разница двух долей оборота по кругу: 0.99 и 0.01 — рядом. */
const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

describe("стрелки часиков сроков идут в ногу", () => {
  const now = 1_788_091_200_000;

  it("стрелка, появившаяся позже, стоит там же, где давно идущая", () => {
    // Часики пересоздались после «не удалось скопировать», новый код пришёл с
    // обновлением данных — в любой миг.
    for (const later of [1, 250, 3_333, 7_919, 60_000, 86_400_123]) {
      expect(apart(phaseAt(now, now + later + 5_000, false), phaseAt(now + later, now + later + 5_000, false)), String(later)).toBeLessThan(1e-3);
      expect(apart(phaseAt(now, now + later + 5_000, true), phaseAt(now + later, now + later + 5_000, true)), String(later)).toBeLessThan(1e-3);
    }
  });

  it("горячая стрелка — со своим оборотом и своей переменной", () => {
    expect(parse(clockHandDelay(now, false)).token).toBe("--move-clock");
    expect(parse(clockHandDelay(now, true)).token).toBe("--move-clock-hot");
    // Задержка — не дальше одного оборота назад.
    for (const hot of [false, true]) {
      const { factor } = parse(clockHandDelay(now + 1234, hot));
      expect(factor).toBeLessThanOrEqual(0);
      expect(factor).toBeGreaterThan(-1);
    }
  });

  it("задержка — от переменной движения: при выключенном тумблере --move — 0s, и задержка — 0s", () => {
    // Число времени в задержке не пишется: только доля оборота-переменной.
    expect(clockHandDelay(now + 4321, false)).not.toMatch(/\d(m?s)\b/i);
    expect(clockHandDelay(now + 4321, true)).not.toMatch(/\d(m?s)\b/i);
  });
});

describe("оборот стрелки в коде — тот же, что в стилях", () => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const move = Number(/--move:\s*([\d.]+)s;/.exec(css)?.[1]);
  const factor = (token: string) => Number(new RegExp(`${token}:\\s*calc\\(var\\(--move\\)\\s*\\*\\s*([\\d.]+)\\);`).exec(css)?.[1]);

  it("обычный и горячий", () => {
    expect(move).toBeGreaterThan(0);
    expect(CLOCK_TURN_MS).toBeCloseTo(move * factor("--move-clock") * 1000, 6);
    expect(CLOCK_TURN_HOT_MS).toBeCloseTo(move * factor("--move-clock-hot") * 1000, 6);
  });
});
