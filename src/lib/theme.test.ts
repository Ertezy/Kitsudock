import { describe, expect, it } from "vitest";
import { asTheme, colorsOf, DEFAULT_THEME, isHex, PRESETS, tokensFor } from "./theme";

describe("тема из конфига", () => {
  it("незнакомое — тёмная тема без своих цветов", () => {
    for (const raw of [null, 7, "light", {}, { mode: "neon" }]) expect(asTheme(raw)).toEqual(DEFAULT_THEME);
  });

  it("код не цвета выбрасывается, остальное приводится к строчным", () => {
    expect(asTheme({ mode: "light", colors: { accent: "#6AA8FF", bg: "red", text: "#12345", panel: 5 } })).toEqual({
      mode: "light",
      colors: { accent: "#6aa8ff" },
    });
  });

  it("код цвета — только #rrggbb", () => {
    expect(["#a1b2c3", "#FFFFFF"].every(isHex)).toBe(true);
    expect(["a1b2c3", "#fff", "#gggggg", "#a1b2c3 "].some(isHex)).toBe(false);
  });
});

describe("цвета темы", () => {
  it("свой цвет поверх готовой темы, остальные — из неё", () => {
    expect(colorsOf({ mode: "light", colors: { accent: "#6aa8ff" } })).toEqual({ ...PRESETS.light, accent: "#6aa8ff" });
  });

  it("тёмная тема даёт те же основные токены, что палитра в стилях", () => {
    const tokens = tokensFor(PRESETS.dark);
    expect(tokens["--bg"]).toBe("#0f0a12");
    expect(tokens["--ink-dim"]).toBe("rgba(247, 241, 249, 0.64)");
    expect(tokens["--glass"]).toBe("rgba(71, 58, 77, 0.55)");
    expect(tokens["--line"]).toBe("rgba(202, 181, 212, 0.16)");
  });

  it("надпись на кнопке PLAY тёмная на светлом акценте и белая на тёмном", () => {
    expect(tokensFor({ ...PRESETS.dark, accent: "#ffd166" })["--accent-ink"]).not.toBe("#ffffff");
    expect(tokensFor({ ...PRESETS.dark, accent: "#1b1f2a" })["--accent-ink"]).toBe("#ffffff");
  });

  it("подложки светлеют вместе с фоном: свой светлый фон в тёмной теме — светлые подложки", () => {
    expect(tokensFor({ ...PRESETS.dark, bg: "#ffffff" })["--plate"]).toBe("rgba(255, 255, 255, 0.66)");
  });
});
