import { describe, expect, it } from "vitest";
import rawCss from "./styles.css?raw";

// Файл читается средствами Vite (`?raw`), как в остальных сторожах: типов Node в
// проекте нет, а новая зависимость не нужна. Чтобы Vitest не подменял CSS пустой
// строкой, `vite.config.ts` разрешает ему обрабатывать именно этот файл.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, ""); // комментарии не в счёт

// Объявления вне блоков :root — токены задаются только там.
const outsideRoot = css.replace(/(^|\n)\s*:root(\[[^\]]*\])?\s*\{[^}]*\}/g, "");
const decls = (prop: string) =>
  [...outsideRoot.matchAll(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, "g"))].map((m) => m[1].trim());

describe("стили берут значения только из шкал", () => {
  it("сторож видит стили: файл не пуст и объявления находятся", () => {
    expect(css.length).toBeGreaterThan(5000);
    expect(decls("font-size").length).toBeGreaterThan(10);
    expect(decls("border-radius").length).toBeGreaterThan(10);
    expect(decls("transition").length).toBeGreaterThan(3);
  });

  it("длительности — только через переменные движения", () => {
    for (const prop of ["transition", "transition-duration", "animation", "animation-duration", "animation-delay", "transition-delay"]) {
      for (const v of decls(prop)) {
        const literal = v.replace(/var\([^)]*\)/g, "").match(/(?<![\w-])\d*\.?\d+m?s\b/);
        expect(literal, `${prop}: ${v}`).toBeNull();
      }
    }
  });

  it("кривые — только из шкалы (у дрейфа арта своя, ease-in-out: он не появление)", () => {
    for (const prop of ["transition", "transition-timing-function", "animation", "animation-timing-function"]) {
      for (const v of decls(prop)) {
        expect(v, `${prop}: ${v}`).not.toMatch(/cubic-bezier|(?<![\w-])ease(-in|-out)?(?![\w-])/);
      }
    }
  });

  it("размер шрифта — только из шкалы или от размера дока", () => {
    for (const v of decls("font-size")) expect(v, v).toMatch(/var\(--(text|s|dock)-/);
  });

  it("сокращение font не прячет размер числом", () => {
    for (const v of decls("font")) {
      if (v === "inherit") continue;
      expect(v, v).toMatch(/^\d{3} var\(--text-/);
    }
  });

  it("веса шрифта — только 400, 500 и 600", () => {
    for (const v of decls("font-weight")) expect(v, v).toMatch(/^(400|500|600)$/);
  });

  it("скругления — только из шкалы, 50% или от размера дока", () => {
    for (const v of decls("border-radius")) {
      if (v === "50%" || v === "0") continue;
      expect(v, v).toMatch(/var\(--(r|s|dock)-/);
    }
  });

  it("слои — только из шкалы", () => {
    for (const v of decls("z-index")) expect(v, v).toMatch(/var\(--z-/);
  });
});
