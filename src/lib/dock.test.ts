import { describe, expect, it } from "vitest";
import { glassScale, nearness, shifts } from "./dock";

describe("nearness", () => {
  it("иконка под курсором — 1, дальше спадает к нулю на краю досягаемости", () => {
    const near = nearness([100, 154, 208, 262], 100, 110);
    expect(near[0]).toBe(1);
    expect(near[1]).toBeCloseTo(1 - 54 / 110, 10);
    expect(near[2]).toBeCloseTo(1 - 108 / 110, 10);
    expect(near[3]).toBe(0);
  });

  it("с обеих сторон от курсора одинаково", () => {
    const near = nearness([0, 50, 100], 50, 110);
    expect(near[0]).toBeCloseTo(near[2], 10);
  });
});

describe("shifts", () => {
  it("в покое никто не сдвигается", () => {
    expect(shifts([])).toEqual([]);
    expect(shifts([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("одна иконка растёт на месте", () => {
    expect(shifts([1])).toEqual([0]);
  });

  it("ряд растёт в обе стороны поровну, как ряд по центру", () => {
    expect(shifts([0.5, 1, 0.5])).toEqual([-0.75, 0, 0.75]);
    const s = shifts([0.2, 0.9, 0.4, 0]);
    const total = 0.2 + 0.9 + 0.4;
    // Левый край первой иконки уходит влево ровно на половину общего прироста,
    // правый край последней — вправо на столько же.
    expect(s[0] - 0.2 / 2).toBeCloseTo(-total / 2, 10);
    expect(s[3] + 0 / 2).toBeCloseTo(total / 2, 10);
  });

  it("соседи расходятся ровно на половины своих приростов: зазор между ними не меняется", () => {
    const near = [0.1, 0.6, 1, 0.6, 0.1, 0];
    const s = shifts(near);
    for (let i = 0; i + 1 < near.length; i++) {
      expect(s[i + 1] - s[i]).toBeCloseTo((near[i] + near[i + 1]) / 2, 10);
    }
  });
});

describe("glassScale", () => {
  it("подложка растягивается ровно на общий прирост иконок", () => {
    // Пять иконок по 44, прирост одной — 28, подложка 286: две иконки по
    // половине и одна целиком дают ещё 56 точек ширины.
    expect(glassScale([0, 0.5, 1, 0.5, 0], 28, 286)).toBeCloseTo((286 + 56) / 286, 10);
  });

  it("в покое и без размеров — без растяжения", () => {
    expect(glassScale([0, 0, 0], 28, 286)).toBe(1);
    expect(glassScale([], 28, 286)).toBe(1);
    expect(glassScale([1], 28, 0)).toBe(1);
    expect(glassScale([1], 28, Number.NaN)).toBe(1);
  });
});
