import { describe, expect, it } from "vitest";
import rawCss from "./styles.css?raw";

// Файл читается средствами Vite (`?raw`), как в остальных сторожах: типов Node в
// проекте нет, а новая зависимость не нужна. Чтобы Vitest не подменял CSS пустой
// строкой, `vite.config.ts` разрешает ему обрабатывать именно этот файл.

interface Decl {
  selector: string;
  prop: string;
  value: string;
}

/**
 * Все объявления таблицы вместе с селектором своего блока. Разбор посимвольный:
 * кавычки и скобки учитываются, поэтому `;` внутри `url("data:…;…")` не рвёт
 * объявление. Комментарии не в счёт.
 */
function parse(text: string): Decl[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = "";
  let quote = "";
  let depth = 0;
  const flush = () => {
    const s = buf.trim();
    buf = "";
    const i = s.indexOf(":");
    if (!s || i < 0 || !stack.length) return;
    out.push({ selector: stack[stack.length - 1], prop: s.slice(0, i).trim(), value: s.slice(i + 1).trim() });
  };
  for (const ch of src) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === "(") {
      depth++;
      buf += ch;
    } else if (ch === ")") {
      depth--;
      buf += ch;
    } else if (depth === 0 && ch === "{") {
      stack.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
    } else if (depth === 0 && ch === "}") {
      flush();
      stack.pop();
    } else if (depth === 0 && ch === ";") {
      flush();
    } else {
      buf += ch;
    }
  }
  return out;
}

/** Блок токенов: `:root`, `:root[…]` или их список — без потомков. */
const isRoot = (selector: string) => selector.split(",").every((s) => /^:root(\[[^\]]*\])*$/.test(s.trim()));

/** Значение через запятую верхнего уровня: запятые внутри скобок не делят. */
function segments(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const TIMING_PROPS = [
  "transition",
  "transition-duration",
  "transition-delay",
  "transition-timing-function",
  "animation",
  "animation-duration",
  "animation-delay",
  "animation-timing-function",
];
const TIME = /(?<![\w-])\d*\.?\d+m?s(?![\w-])/;
const CURVE = /cubic-bezier\(|steps\(|linear\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)(?![\w-])/;
/** Дрейф арта — не появление и не нажатие, поэтому у него своя кривая. Больше ни у кого. */
const ART_DRIFT = /^art-drift\s/;

/** Длительности только через переменные движения: иначе тумблер «Анимация» их не выключит. */
function durationProblems(decls: Decl[]): string[] {
  const bad: string[] = [];
  for (const d of decls) {
    if (isRoot(d.selector)) continue;
    // Своя переменная со временем вне :root — обход шкалы, даже если ею пока не пользуются.
    if (d.prop.startsWith("--") && (TIME.test(d.value) || CURVE.test(d.value))) bad.push(`${d.selector} { ${d.prop}: ${d.value} }`);
    if (!TIMING_PROPS.includes(d.prop) || d.value === "none") continue;
    const vars = [...d.value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
    const foreign = vars.filter((v) => !/^--(move|ease)(-[\w-]+)?$/.test(v));
    const literal = TIME.test(d.value.replace(/var\([^)]*\)/g, ""));
    const missing = !/timing-function/.test(d.prop) && segments(d.value).some((s) => !/var\(\s*--move/.test(s));
    if (foreign.length || literal || missing) bad.push(`${d.selector} { ${d.prop}: ${d.value} }`);
  }
  return bad;
}

/** Кривые только из шкалы; `ease-in-out` — только у дрейфа арта. */
function curveProblems(decls: Decl[]): string[] {
  const bad: string[] = [];
  for (const d of decls) {
    if (isRoot(d.selector) || !TIMING_PROPS.includes(d.prop)) continue;
    for (const s of segments(d.value)) {
      const curves = [...s.replace(/var\([^)]*\)/g, "").matchAll(new RegExp(CURVE, "g"))].map((m) => m[0]);
      const drift = d.prop === "animation" && ART_DRIFT.test(s) && curves.length === 1 && curves[0] === "ease-in-out";
      if (curves.length && !drift) bad.push(`${d.selector} { ${d.prop}: ${s} }`);
    }
  }
  return bad;
}

/** Слои — ровно переменная шкалы, без вычислений по месту. */
function zProblems(decls: Decl[]): string[] {
  return decls
    .filter((d) => !isRoot(d.selector) && d.prop === "z-index" && !/^var\(--z-[\w-]+\)$/.test(d.value))
    .map((d) => `${d.selector} { z-index: ${d.value} }`);
}

const decls = parse(rawCss);

describe("стили берут значения только из шкал", () => {
  const outside = decls.filter((d) => !isRoot(d.selector));
  const of = (prop: string) => outside.filter((d) => d.prop === prop).map((d) => d.value);

  it("сторож видит стили: файл не пуст и объявления находятся", () => {
    expect(rawCss.length).toBeGreaterThan(5000);
    expect(of("font-size").length).toBeGreaterThan(10);
    expect(of("border-radius").length).toBeGreaterThan(10);
    expect(of("transition").length).toBeGreaterThan(3);
    expect(of("color").length).toBeGreaterThan(20);
    expect(decls.filter((d) => d.selector === ":root").length).toBeGreaterThan(30);
  });

  it("длительности — только через переменные движения", () => {
    expect(durationProblems(decls)).toEqual([]);
  });

  it("кривые — только из шкалы (у дрейфа арта своя, ease-in-out: он не появление)", () => {
    expect(curveProblems(decls)).toEqual([]);
  });

  it("размер шрифта — только из шкалы или от размера дока", () => {
    for (const v of of("font-size")) expect(v, v).toMatch(/var\(--(text|s|dock)-/);
  });

  it("сокращение font не прячет размер числом", () => {
    for (const v of of("font")) {
      if (v === "inherit") continue;
      expect(v, v).toMatch(/^\d{3} var\(--text-/);
    }
  });

  it("веса шрифта — только 400, 500 и 600", () => {
    for (const v of of("font-weight")) expect(v, v).toMatch(/^(400|500|600)$/);
  });

  it("скругления — только из шкалы, 50% или от размера дока", () => {
    for (const v of of("border-radius")) {
      if (v === "50%" || v === "0") continue;
      expect(v, v).toMatch(/var\(--(r|s|dock)-/);
    }
  });

  it("слои — только из шкалы, ровно переменной", () => {
    expect(zProblems(decls)).toEqual([]);
  });

});

describe("сторож ловит нарушения", () => {
  const css = (text: string) => parse(text);

  it("своя переменная с длительностью вне :root не проходит", () => {
    expect(durationProblems(css(".x { --d: 200ms; transition: opacity var(--d); }")).length).toBe(2);
    expect(durationProblems(css(".x { transition: opacity 0.2s var(--ease-out); }"))).toHaveLength(1);
    expect(durationProblems(css(".x { transition: opacity var(--move) var(--ease-out), transform; }"))).toHaveLength(1);
    expect(durationProblems(css(".x { animation-duration: var(--speed); }"))).toHaveLength(1);
    expect(durationProblems(css(":root { --d: 200ms; } .x { transition: opacity var(--move-fast) var(--ease-out); }"))).toEqual([]);
  });

  it("ease-in-out разрешён только дрейфу арта", () => {
    expect(curveProblems(css(".x { animation: art-drift var(--move-ambient) ease-in-out infinite alternate; }"))).toEqual([]);
    expect(curveProblems(css(".x { transition: opacity var(--move) ease-in-out; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation: pulse var(--move) ease-in-out infinite; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation: art-drift var(--move-ambient) linear infinite; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { transition: transform var(--move) cubic-bezier(0.2, 1, 0.3, 1); }"))).toHaveLength(1);
    expect(curveProblems(css(".x { transition: opacity var(--move) var(--ease-out); }"))).toEqual([]);
  });

  it("слой с вычислением по месту не проходит", () => {
    expect(zProblems(css(".x { z-index: calc(var(--z-ui) + 1); }"))).toHaveLength(1);
    expect(zProblems(css(".x { z-index: 11; }"))).toHaveLength(1);
    expect(zProblems(css(".x { z-index: var(--z-ui-raised); }"))).toEqual([]);
  });

  it("точка с запятой и скобки внутри значения не ломают разбор", () => {
    const d = css('.x { background: url("data:image/svg+xml;utf8,<svg/>") ; color: var(--ink); }');
    expect(d.map((x) => x.prop)).toEqual(["background", "color"]);
  });
});
