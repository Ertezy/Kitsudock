import { describe, expect, it } from "vitest";
import rawCss from "./styles.css?raw";

// Контраст проверяется по значениям настоящей палитры, с учётом прозрачности
// стекла и текста. Наличие токенов само по себе не гарантирует читаемость.
type Colour = [number, number, number, number];

function colour(value: string): Colour {
  const hex = /^#([\da-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (rgba) {
    const channels = rgba[1].split(",").map(Number);
    if ((channels.length === 3 || channels.length === 4) && channels.every(Number.isFinite)) {
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    }
  }
  throw new Error("Unsupported palette colour: " + value);
}

// Фон непрозрачен: смешение происходит в sRGB до расчёта яркости.
function over(foreground: Colour, background: Colour): Colour {
  const a = foreground[3];
  return [
    foreground[0] * a + background[0] * (1 - a),
    foreground[1] * a + background[1] * (1 - a),
    foreground[2] * a + background[2] * (1 - a),
    1,
  ];
}

function luminance(c: Colour): number {
  const linear = c.slice(0, 3).map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground: Colour, background: Colour): number {
  const a = luminance(over(foreground, background));
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function tokens(selector: string): Map<string, string> {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) => match[1].trim() === selector);
  if (!block) throw new Error("Missing palette block: " + selector);
  return new Map([...block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

describe("расчёт контраста", () => {
  it("чёрный и белый дают 21:1, одинаковые цвета — 1:1", () => {
    expect(contrast(colour("#ffffff"), colour("#000000"))).toBeCloseTo(21, 8);
    expect(contrast(colour("#ffffff"), colour("#ffffff"))).toBeCloseTo(1, 8);
  });

  it("прозрачность текста учитывается до расчёта яркости", () => {
    expect(over(colour("rgba(255, 255, 255, 0.5)"), colour("#000000"))).toEqual([127.5, 127.5, 127.5, 1]);
    expect(contrast(colour("rgba(255, 255, 255, 0.5)"), colour("#000000"))).toBeCloseTo(5.2808, 3);
  });
});

describe("читаемость палитр", () => {
  for (const palette of ["current", "a", "b", "c"]) {
    const values = tokens(":root");
    if (palette !== "current") {
      for (const [name, value] of tokens(':root[data-palette="' + palette + '"]')) values.set(name, value);
    }
    const get = (name: string) => {
      const value = values.get(name);
      if (!value) throw new Error(palette + ": missing " + name);
      return colour(value);
    };
    const bg = get("--bg");
    const glass = over(get("--glass"), bg);
    const card = over(get("--card"), glass);

    const pairs: [string, Colour, Colour][] = [
      ["основной текст на фоне", get("--ink"), bg],
      ["основной текст на стекле", get("--ink"), glass],
      ["приглушённый текст на стекле", get("--ink-dim"), glass],
      ["приглушённый текст на карточке поверх стекла", get("--ink-dim"), card],
      ["текст действия на акценте", get("--accent-ink"), get("--accent")],
    ];
    for (const [name, foreground, background] of pairs) {
      it(palette + ": " + name + " не ниже 4.5:1", () => {
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
