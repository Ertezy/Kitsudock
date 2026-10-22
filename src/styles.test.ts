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
/** Время числом, со знаком: `-3s` — задержка вперёд, а не часть имени; в имени вроде `fade-3s` цифра времени не считается. */
const TIME = /(?<![\w-])[-+]?\d*\.?\d+m?s(?![\w-])/;
const CURVE = /cubic-bezier\(|steps\(|linear\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)(?![\w-])/;
/** Дрейф арта — не появление и не нажатие, поэтому у него своя кривая. Больше ни у кого. */
const ART_DRIFT = /^art-drift\s/;

/**
 * Длительности только через переменные движения: иначе тумблер «Анимация» их не
 * выключит. В :root время числом может быть только у --move: остальные скорости
 * считаются от неё, а не задаются рядом.
 */
function durationProblems(decls: Decl[]): string[] {
  const bad: string[] = [];
  for (const d of decls) {
    if (isRoot(d.selector)) {
      if (d.prop !== "--move" && TIME.test(d.value)) bad.push(`${d.selector} { ${d.prop}: ${d.value} }`);
      continue;
    }
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

/**
 * Слои — ровно переменная шкалы, без вычислений по месту, и она определена в
 * :root: опечатка в имени оставила бы слой без значения, и правило молча
 * отвалилось бы.
 */
function zProblems(decls: Decl[]): string[] {
  const scale = new Set(decls.filter((d) => d.selector === ":root" && d.prop.startsWith("--z-")).map((d) => d.prop));
  return decls
    .filter((d) => {
      if (isRoot(d.selector) || d.prop !== "z-index") return false;
      const token = /^var\((--z-[\w-]+)\)$/.exec(d.value);
      return !token || !scale.has(token[1]);
    })
    .map((d) => `${d.selector} { z-index: ${d.value} }`);
}

// Именованные цвета CSS Color 4: https://www.w3.org/TR/css-color-4/#named-colors
const NAMED =
  "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|" +
  "cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|" +
  "darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|" +
  "green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|" +
  "lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|" +
  "mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|" +
  "palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|" +
  "seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|" +
  "white|whitesmoke|yellow|yellowgreen";
const COLOUR_LITERAL = new RegExp(
  `#[0-9a-f]{3,8}(?![\\w-])|(?<![\\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|(?<![\\w-])(${NAMED})(?![\\w-])`,
  "i",
);

/** Экранирование адреса раскрыто: в `data:`-картинке `%23ff8800` и `%27red%27` — те же цвета, что в самом правиле. */
const unescaped = (value: string) => value.replace(/%[\da-f]{2}/gi, (m) => String.fromCharCode(Number.parseInt(m.slice(1), 16)));

/**
 * Цвет вне :root — только из токенов. Проверяются все свойства, не только
 * `color` и `background`: тень, рамка, градиент, полоса прокрутки и `fill` тоже
 * несут цвет, как и цвет внутри `data:`-картинки, записанный в адресе (`%23…`).
 * Разрешены `transparent`, `currentColor`, `inherit` и смесь токенов через
 * `color-mix` — в них нет числа, которое разойдётся с палитрой. Зерно из
 * `data:`-картинки должно брать цвет из токена или быть без цвета.
 */
function colourProblems(decls: Decl[]): string[] {
  return decls
    .filter((d) => !isRoot(d.selector) && COLOUR_LITERAL.test(unescaped(d.value)))
    .map((d) => `${d.selector} { ${d.prop}: ${d.value} }`);
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

  it("цвета вне :root — только из токенов", () => {
    expect(colourProblems(decls)).toEqual([]);
  });
});

describe("палитра", () => {
  const base = new Map(decls.filter((d) => d.selector === ":root" && d.prop.startsWith("--")).map((d) => [d.prop, d.value]));
  /** Цветовые токены основы: те, в чьих значениях есть цвет числом. */
  const colourTokens = [...base].filter(([, v]) => COLOUR_LITERAL.test(v)).map(([k]) => k);

  it("основа задаёт цвета токенами, и их хватает на весь интерфейс", () => {
    for (const t of ["--bg", "--glass", "--card", "--line", "--ink", "--ink-dim", "--ink-faint", "--accent", "--accent-ink", "--content", "--content-soft", "--label", "--danger", "--shadow-1", "--shadow-2", "--shadow-3", "--glass-edge"]) {
      expect(colourTokens, t).toContain(t);
    }
  });

  it("палитра одна: блоков [data-palette] в стилях нет", () => {
    expect(rawCss.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("data-palette");
    expect(decls.filter((d) => /data-palette/.test(d.selector))).toEqual([]);
  });
});

describe("сторож ловит нарушения", () => {
  const css = (text: string) => parse(text);

  it("своя переменная с длительностью вне :root не проходит", () => {
    expect(durationProblems(css(".x { --d: 200ms; transition: opacity var(--d); }")).length).toBe(2);
    expect(durationProblems(css(".x { transition: opacity 0.2s var(--ease-out); }"))).toHaveLength(1);
    expect(durationProblems(css(".x { transition: opacity var(--move) var(--ease-out), transform; }"))).toHaveLength(1);
    expect(durationProblems(css(".x { animation-duration: var(--speed); }"))).toHaveLength(1);
    expect(durationProblems(css(":root { --move: 200ms; } .x { transition: opacity var(--move-fast) var(--ease-out); }"))).toEqual([]);
  });

  it("отрицательное время внутри сокращения не проходит, а цифра в имени кадров — не время", () => {
    expect(durationProblems(css(".x { animation: art-drift var(--move-ambient) ease-in-out infinite alternate -3s; }"))).toHaveLength(1);
    expect(durationProblems(css(".x { transition: opacity var(--move) var(--ease-out) -0.1s; }"))).toHaveLength(1);
    expect(durationProblems(css(".x { animation: spin var(--move) var(--ease-out) calc(-3s); }"))).toHaveLength(1);
    expect(durationProblems(css(".x { animation: spin var(--move) var(--ease-out) +3s; }"))).toHaveLength(1);
    expect(durationProblems(css(".x { animation: fade-3s var(--move) var(--ease-out); }"))).toEqual([]);
    expect(durationProblems(css(".x { animation: art-drift var(--move-ambient) ease-in-out infinite alternate var(--move-slow); }"))).toEqual([]);
  });

  it("в :root время числом разрешено одной переменной — --move", () => {
    expect(durationProblems(css(":root { --move: 0.18s; --move-fast: calc(var(--move) * 0.67); --move-ambient: calc(var(--move) * 222); }"))).toEqual([]);
    expect(durationProblems(css(':root[data-motion="off"] { --move: 0s; }'))).toEqual([]);
    expect(durationProblems(css(":root { --move: 0.18s; --move-fast: 120ms; }"))).toHaveLength(1);
    expect(durationProblems(css(":root { --move-slow: calc(var(--move) * 2 + 40ms); }"))).toHaveLength(1);
    expect(durationProblems(css(":root { --move-ambient: 40s; }"))).toHaveLength(1);
    expect(durationProblems(css(":root { --pause: -1s; }"))).toHaveLength(1);
    expect(durationProblems(css(':root[data-motion="off"] { --move-fast: 0s; }'))).toHaveLength(1);
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
    expect(zProblems(css(":root { --z-ui-raised: 11; } .x { z-index: var(--z-ui-raised); }"))).toEqual([]);
  });

  it("слой должен называть токен --z-, определённый в :root", () => {
    const scale = ":root { --z-ui: 10; --z-panel: calc(var(--z-ui) + 10); } ";
    expect(zProblems(css(scale + ".x { z-index: var(--z-panel); }"))).toEqual([]);
    expect(zProblems(css(scale + ".x { z-index: var(--z-modal); }"))).toHaveLength(1);
    expect(zProblems(css(scale + ".x { z-index: var(--layer-panel); }"))).toHaveLength(1);
    expect(zProblems(css(".x { z-index: var(--z-ui); }"))).toHaveLength(1);
    expect(zProblems(css(':root[data-motion="off"] { --z-ui: 10; } .x { z-index: var(--z-ui); }'))).toHaveLength(1);
    expect(zProblems(css(".x { --z-ui: 10; z-index: var(--z-ui); }"))).toHaveLength(1);
  });

  it("цвет числом или словом вне :root не проходит", () => {
    const bad = [
      ".x { color: #fff; }",
      ".x { color: rebeccapurple; }",
      ".x { border-color: lightsalmon; }",
      ".x { fill: darkslategrey; }",
      ".x { background: rgba(0, 0, 0, 0.5); }",
      ".x { box-shadow: 0 2px 4px hsl(0 0% 0% / 0.4); }",
      ".x { border: 1px solid white; }",
      ".x { background-image: linear-gradient(#000, transparent); }",
      ".x { outline-color: oklch(0.7 0.1 30); }",
      ".x { fill: red; }",
      ".x { scrollbar-color: rgba(255, 255, 255, 0.2) transparent; }",
      ".x { text-shadow: 0 1px 2px black; }",
      ".x { --tone: #123456; }",
    ];
    for (const b of bad) expect(colourProblems(css(b)), b).toHaveLength(1);
    const good = ":root { --a: #fff; } .x { color: var(--a); background: color-mix(in srgb, var(--a) 10%, transparent); border-color: currentColor; fill: inherit; outline: 0; }";
    expect(colourProblems(css(good))).toEqual([]);
  });

  it("цвет в data:-картинке, закодированный в адрес, не проходит; шум без цвета проходит", () => {
    const svg = (inner: string) => `.x { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E${inner}%3C/svg%3E"); }`;
    expect(colourProblems(css(svg("%3Crect fill='%23ff8800'/%3E")))).toHaveLength(1);
    expect(colourProblems(css(svg("%3Crect fill='%23f80'/%3E")))).toHaveLength(1);
    expect(colourProblems(css(svg("%3Crect fill=%27%23ff880080%27/%3E")))).toHaveLength(1);
    expect(colourProblems(css(svg("%3Crect fill=%27rgb(255,136,0)%27/%3E")))).toHaveLength(1);
    expect(colourProblems(css(svg("%3Crect fill=%27red%27/%3E")))).toHaveLength(1);
    expect(colourProblems(css(svg("%3Crect fill='#ff8800'/%3E")))).toHaveLength(1);
    const grain =
      "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E" +
      "%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E";
    expect(colourProblems(css(svg(grain)))).toEqual([]);
    expect(colourProblems(css(".x { width: calc(100% - 20px); }"))).toEqual([]);
  });

  it("точка с запятой и скобки внутри значения не ломают разбор", () => {
    const d = css('.x { background: url("data:image/svg+xml;utf8,<svg/>") ; color: var(--ink); }');
    expect(d.map((x) => x.prop)).toEqual(["background", "color"]);
  });
});
