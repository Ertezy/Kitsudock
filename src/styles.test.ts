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
/**
 * Своя кривая — у двух фоновых движений, которые не появление и не нажатие, и
 * только в их собственной анимации. Дрейф арта плавно разворачивается у краёв
 * (`ease-in-out`). Стрелка часиков сроков бежит ровно (`linear`): с любой
 * кривой из шкалы она на каждом обороте то разгонялась бы, то замирала —
 * читалось бы как тиканье рывками, а не спокойный бег (спека полировки, §8.3).
 * Больше ни у кого, и в шкалу `--ease-…` эти кривые не входят.
 */
const OWN_CURVE: Record<string, string> = { "art-drift": "ease-in-out", "clock-hand": "linear" };

/**
 * Значение без имён переменных, но с их запасными значениями: `var(--move, 0.2s)`
 * превращается в `0.2s)`. Запасное значение — такое же число мимо шкалы, как
 * записанное прямо, и прятаться за `var()` ему нельзя.
 */
const withoutVarNames = (value: string) => value.replace(/var\(\s*--[\w-]+\s*,?/g, "");

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
    const literal = TIME.test(withoutVarNames(d.value));
    const missing = !/timing-function/.test(d.prop) && segments(d.value).some((s) => !/var\(\s*--move/.test(s));
    if (foreign.length || literal || missing) bad.push(`${d.selector} { ${d.prop}: ${d.value} }`);
  }
  return bad;
}

/** Кривые только из шкалы; `ease-in-out` — только у дрейфа арта, `linear` — только у стрелки часиков. */
function curveProblems(decls: Decl[]): string[] {
  const bad: string[] = [];
  for (const d of decls) {
    if (isRoot(d.selector) || !TIMING_PROPS.includes(d.prop)) continue;
    for (const s of segments(d.value)) {
      const curves = [...withoutVarNames(s).matchAll(new RegExp(CURVE, "g"))].map((m) => m[0]);
      const own = OWN_CURVE[/^([\w-]+)\s/.exec(s)?.[1] ?? ""];
      const allowed = d.prop === "animation" && own !== undefined && curves.length === 1 && curves[0] === own;
      if (curves.length && !allowed) bad.push(`${d.selector} { ${d.prop}: ${s} }`);
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
 * Ссылки на элемент по имени — `url(#fade)`, `href="#cafe"` — не цвет, хотя имя
 * из букв a–f и читается как `#fade`. Убираются до проверки; цвет числом в
 * `fill='#fade'` остаётся цветом.
 */
const withoutRefs = (value: string) =>
  value.replace(/url\(\s*(['"]?)#[\w-]+\1\s*\)|(?<![\w-])(?:xlink:)?href\s*=\s*(['"])#[\w-]+\2/gi, "");

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
    .filter((d) => !isRoot(d.selector) && COLOUR_LITERAL.test(withoutRefs(unescaped(d.value))))
    .map((d) => `${d.selector} { ${d.prop}: ${d.value} }`);
}

/**
 * Рамка фокуса одна на всё приложение: толщина, цвет и отступ — из токенов
 * `--focus-ring` и `--focus-offset` (в тесной группе — `--focus-offset-tight`).
 * Своя рамка по месту — снова разнобой, от которого ушли (оранжевая у дока,
 * светлая у PLAY, приглушённая в настройках).
 */
function focusProblems(decls: Decl[]): string[] {
  return decls
    .filter((d) => !isRoot(d.selector))
    .filter((d) => {
      if (d.prop === "outline") return d.value !== "none" && d.value !== "0" && d.value !== "var(--focus-ring)";
      if (d.prop === "outline-offset") return d.value !== "var(--focus-offset)" && d.value !== "var(--focus-offset-tight)";
      return d.prop.startsWith("outline-");
    })
    .map((d) => `${d.selector} { ${d.prop}: ${d.value} }`);
}

/** Псевдокласс сразу за частью селектора — с возможными `:not(…)` и другими между ними. */
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const followedBy = (part: string, pseudo: string) => {
  const between = String.raw`(?::[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*`;
  return new RegExp(`(?:^|[\\s,>+~(])${escapeRe(part)}${between}:${pseudo}(?![\\w-])`);
};
/** Простой селектор как отдельное звено: `.dot` в `.row:hover .dot`, но не в `.dots`. */
const hasCompound = (selector: string, compound: string) => new RegExp(`(?:^|[\\s>+~])${escapeRe(compound)}(?![\\w-])`).test(selector);

/** Список селекторов по запятым верхнего уровня: запятые внутри `:is(…)`, `:not(…)`, `[…]` и кавычек не делят. */
function splitList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of selector) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim().replace(/\s+/g, " "));
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim().replace(/\s+/g, " "));
  return out.filter(Boolean);
}

/**
 * Селектор с раскрытыми `:is(…)` и `:where(…)`: `:root :is(.a, .b):hover` —
 * это `:root .a:hover` и `:root .b:hover`. Так каждый элемент списка виден
 * сам по себе, а не спрятан в скобках вместе с соседями.
 */
function expandIs(selector: string): string[] {
  const m = /:(?:is|where)\(/.exec(selector);
  if (!m) return [selector];
  const open = m.index + m[0].length;
  let depth = 1;
  let i = open;
  for (; i < selector.length && depth > 0; i++) {
    if (selector[i] === "(") depth++;
    if (selector[i] === ")") depth--;
  }
  const inner = selector.slice(open, i - 1);
  return splitList(inner).flatMap((alt) => expandIs(selector.slice(0, m.index) + alt + selector.slice(i)));
}

/** Все элементы списков селекторов, с раскрытыми `:is`/`:where`. */
const members = (selector: string) => splitList(selector).flatMap(expandIs);

/** Правило для выключенного тумблера «Анимация»: оно отменяет движение, а не даёт отклик. */
const isMotionOff = (selector: string) => /^:root\[data-motion=["']?off["']?\]/.test(selector);

/**
 * У всего, что нажимается (`cursor: pointer`), есть наведение и нажатие (спека
 * полировки, §5 «Везде»). Нажатие или наведение может откликаться на родителе —
 * тогда это записано здесь же, с причиной. Правило выключенного тумблера
 * «Анимация» откликом не считается: без своего наведения у элемента его нет.
 */
const PRESSED_BY: Record<string, string> = {
  // Вдавливается вся свёрнутая строка игры, а не одна её шапка.
  ".game-row-head": ".game-row",
};
const HOVERED_BY: Record<string, string> = {};

function pointerProblems(decls: Decl[], maps: { hoveredBy?: Record<string, string>; pressedBy?: Record<string, string> } = {}): string[] {
  const hoveredBy = maps.hoveredBy ?? HOVERED_BY;
  const pressedBy = maps.pressedBy ?? PRESSED_BY;
  const selectors = decls
    .filter((d) => !isRoot(d.selector))
    .flatMap((d) => members(d.selector))
    .filter((s) => !isMotionOff(s));
  const parts = new Set(decls.filter((d) => d.prop === "cursor" && d.value === "pointer" && !isRoot(d.selector)).flatMap((d) => members(d.selector)));
  const own = (part: string, pseudo: string) => selectors.some((s) => followedBy(part, pseudo).test(s));
  const bad: string[] = [];
  for (const part of parts) {
    // Наведение от родителя меняет сам элемент: в селекторе после `родитель:hover`
    // стоит он же (`.row:hover .child`).
    const parent = hoveredBy[part];
    const child = part.split(" ").pop() ?? part;
    const hoverFromParent = parent !== undefined && selectors.some((s) => followedBy(parent, "hover").test(s) && hasCompound(s, child));
    if (!own(part, "hover") && !hoverFromParent) bad.push(`${part}: нет :hover`);
    // Нажатие на родителе вдавливает родителя целиком — его селектора достаточно.
    if (!own(pressedBy[part] ?? part, "active")) bad.push(`${part}: нет :active`);
  }
  return bad;
}

/** Правило неактивного окна: спрятано в трей, свёрнуто или без фокуса (`lib/windowActive.ts`). */
const INACTIVE = /^:root\[data-active=["']?off["']?\]\s+/;
const INFINITE = /(?<![\w-])infinite(?![\w-])/;

/**
 * Бесконечное движение стоит на паузе, пока окно неактивно (спека полировки,
 * §8.2): каждый элемент, чья анимация бесконечна, есть в правиле
 * `:root[data-active="off"] … { animation-play-state: paused }` — сам, а не
 * его родитель или сосед. Правило выключенного тумблера «Анимация» паузой не
 * считается: тумблер и неактивное окно — разные условия.
 */
function pauseProblems(decls: Decl[]): string[] {
  const outside = decls.filter((d) => !isRoot(d.selector));
  const infinite = outside
    .filter(
      (d) =>
        (d.prop === "animation" && segments(d.value).some((s) => INFINITE.test(s))) ||
        (d.prop === "animation-iteration-count" && INFINITE.test(d.value)),
    )
    .flatMap((d) => members(d.selector))
    .filter((s) => !isMotionOff(s) && !INACTIVE.test(s));
  const paused = new Set(
    outside
      .filter((d) => d.prop === "animation-play-state" && d.value === "paused")
      .flatMap((d) => members(d.selector))
      .filter((s) => INACTIVE.test(s))
      .map((s) => s.replace(INACTIVE, "")),
  );
  return [...new Set(infinite)].filter((s) => !paused.has(s)).map((s) => `${s}: не на паузе в неактивном окне`);
}

/** Сколько элементов с бесконечной анимацией в стилях: сторож паузы видит их. */
const infiniteCount = (decls: Decl[]) =>
  new Set(
    decls
      .filter((d) => !isRoot(d.selector) && d.prop === "animation" && INFINITE.test(d.value))
      .flatMap((d) => members(d.selector))
      .filter((s) => !isMotionOff(s)),
  ).size;

/**
 * Всё, что прокручивается, — с тонкой полосой в цветах палитры (или вовсе без
 * полосы, как док). Стандартная широкая серая полоса чужая на тёмном стекле.
 * Сверяется по элементу: полоса может быть задана в другом правиле того же
 * элемента или в общем списке, а не только рядом с `overflow`.
 */
function scrollbarProblems(decls: Decl[]): string[] {
  const outside = decls.filter((d) => !isRoot(d.selector));
  const scrolling = new Set(
    outside.filter((d) => /^overflow(-[xy])?$/.test(d.prop) && /\b(auto|scroll)\b/.test(d.value)).flatMap((d) => members(d.selector)),
  );
  const bad: string[] = [];
  for (const member of scrolling) {
    const own = outside.filter((d) => members(d.selector).includes(member));
    // Позднее правило перекрывает раннее, как в каскаде.
    const last = (prop: string) => own.filter((d) => d.prop === prop).pop()?.value;
    const width = last("scrollbar-width");
    const colour = last("scrollbar-color");
    if (width === "none") continue;
    if (width !== "thin") bad.push(`${member}: scrollbar-width ${width ?? "не задана"}`);
    else if (!colour || !/^var\(--[\w-]+\) (transparent|var\(--[\w-]+\))$/.test(colour)) bad.push(`${member}: scrollbar-color ${colour ?? "не задан"}`);
  }
  return bad;
}

/**
 * Зерно (спека полировки, §4.4): ровно один слой на уровне `--z-grain`,
 * неподвижный, сквозной для мыши, поверх всего окна, 3–4 % непрозрачности.
 */
function grainProblems(decls: Decl[]): string[] {
  const layers = [...new Set(decls.filter((d) => d.prop === "z-index" && d.value === "var(--z-grain)").map((d) => d.selector))];
  if (layers.length !== 1) return [`слоёв зерна: ${layers.length}`];
  const own = new Map(decls.filter((d) => d.selector === layers[0]).map((d) => [d.prop, d.value]));
  const bad: string[] = [];
  if (own.get("position") !== "fixed") bad.push("не position: fixed");
  if (own.get("inset") !== "0") bad.push("не на всё окно (inset: 0)");
  if (own.get("pointer-events") !== "none") bad.push("перехватывает мышь");
  const opacity = Number(own.get("opacity"));
  if (!(opacity >= 0.03 && opacity <= 0.04)) bad.push(`непрозрачность ${own.get("opacity")}`);
  if (!/^url\("data:image\/svg\+xml,/.test(own.get("mask-image") ?? "")) bad.push("шум не из data:-картинки SVG");
  for (const p of ["animation", "transition", "will-change"]) if (own.has(p)) bad.push(`есть ${p}`);
  return bad;
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

  it("кривые — только из шкалы (свои — у дрейфа арта и у стрелки часиков: они не появление)", () => {
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

  it("рамка фокуса одна: из токенов --focus-ring и --focus-offset", () => {
    expect(focusProblems(decls)).toEqual([]);
    expect(decls.filter((d) => d.prop === "outline" && d.value === "var(--focus-ring)").length).toBeGreaterThan(3);
  });

  it("у всего нажимаемого есть наведение и нажатие", () => {
    expect(pointerProblems(decls)).toEqual([]);
  });

  it("всё, что прокручивается, — с тонкой полосой в цветах палитры", () => {
    expect(scrollbarProblems(decls)).toEqual([]);
  });

  it("зерно — один неподвижный слой поверх окна, сквозной для мыши", () => {
    expect(grainProblems(decls)).toEqual([]);
  });

  it("всё бесконечное движение стоит на паузе, пока окно неактивно", () => {
    // Дрейф арта, блик «запускается…», мерцание двух видов заглушек, стрелки
    // часиков сроков.
    expect(infiniteCount(decls)).toBeGreaterThanOrEqual(5);
    expect(pauseProblems(decls)).toEqual([]);
  });
});

describe("токены фокуса", () => {
  const root = new Map(decls.filter((d) => d.selector === ":root").map((d) => [d.prop, d.value]));

  it("рамка — 2px, цветом из токена, с отступом около 3px", () => {
    expect(root.get("--focus-ring")).toMatch(/^var\(--focus-width\) solid var\(--[\w-]+\)$/);
    expect(root.get("--focus-width")).toBe("2px");
    expect(root.get("--focus-offset")).toBe("3px");
    // В тесной группе рамка вплотную, но не внутрь элемента: снаружи у неё
    // остаётся то, на чём стоит группа, а не цвет самого варианта.
    expect(root.get("--focus-offset-tight")).toBe("0px");
  });
});

describe("часики сроков", () => {
  const root = new Map(decls.filter((d) => d.selector === ":root").map((d) => [d.prop, d.value]));
  /** Длительность токена в секундах: `calc(var(--move) * N)` при нынешней --move. */
  const seconds = (token: string) => {
    const m = /^calc\(var\(--move\) \* (\d+(?:\.\d+)?)\)$/.exec(root.get(token) ?? "");
    if (!m) throw new Error(`${token} должен быть вида calc(var(--move) * N), а он «${root.get(token)}»`);
    return Number(m[1]) * Number.parseFloat(root.get("--move") ?? "");
  };
  const value = (selector: string, prop: string) =>
    decls.filter((d) => members(d.selector).includes(selector) && d.prop === prop).map((d) => d.value);

  it("оборот стрелки — около 8 с, в последние сутки — около 2 с, от переменной движения", () => {
    expect(seconds("--move-clock")).toBeGreaterThanOrEqual(7);
    expect(seconds("--move-clock")).toBeLessThanOrEqual(9);
    expect(seconds("--move-clock-hot")).toBeGreaterThanOrEqual(1.5);
    expect(seconds("--move-clock-hot")).toBeLessThanOrEqual(2.5);
  });

  it("стрелка бежит ровно и бесконечно, в последние сутки — быстрее", () => {
    expect(value(".clock-hand", "animation")).toEqual(["clock-hand var(--move-clock) linear infinite"]);
    expect(value(".clock.is-hot .clock-hand", "animation-duration")).toEqual(["var(--move-clock-hot)"]);
  });

  it("стрелка только поворачивается", () => {
    const frames = /@keyframes clock-hand\s*\{([\s\S]*?\})\s*\}/.exec(rawCss.replace(/\/\*[\s\S]*?\*\//g, ""));
    expect(frames, "нет @keyframes clock-hand").not.toBeNull();
    const props = parse(`x { ${frames![1]} }`).map((d) => `${d.prop}: ${d.value}`);
    expect(props).toEqual(["transform: rotate(1turn)"]);
  });

  it("тумблер «Анимация» выключен — стрелка стоит на двенадцати, кольцо остаётся", () => {
    expect(value(':root[data-motion="off"] .clock-hand', "animation")).toEqual(["none"]);
    expect(decls.filter((d) => isMotionOff(d.selector) && /clock-(arc|track|face)|\.clock(?![\w-])/.test(d.selector))).toEqual([]);
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

  it("число в запасном значении var() — тоже число мимо шкалы", () => {
    expect(durationProblems(css(".x { transition: opacity var(--move, 0.2s) var(--ease-out); }"))).toHaveLength(1);
    expect(durationProblems(css(".x { animation-delay: var(--move-fast, 120ms); }"))).toHaveLength(1);
    expect(curveProblems(css(".x { transition: opacity var(--move) var(--ease-out, ease-in); }"))).toHaveLength(1);
    expect(colourProblems(css(".x { color: var(--ink, #fff); }"))).toHaveLength(1);
    expect(colourProblems(css(".x { border-color: var(--line, rgba(0, 0, 0, 0.2)); }"))).toHaveLength(1);
    expect(colourProblems(css(".x { background: var(--card, white); }"))).toHaveLength(1);
    // Запасное значение из шкалы — можно.
    expect(durationProblems(css(".x { transition: opacity var(--move-fast, var(--move)) var(--ease-out); }"))).toEqual([]);
    expect(colourProblems(css(".x { color: var(--s-ink, var(--ink)); }"))).toEqual([]);
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

  it("linear разрешён только стрелке часиков: она бежит ровно, а не толчками", () => {
    expect(curveProblems(css(".x { animation: clock-hand var(--move-clock) linear infinite; }"))).toEqual([]);
    expect(curveProblems(css(".x { animation: clock-hand var(--move-clock) ease-in-out infinite; }"))).toHaveLength(1);
    // Своя кривая — только в своей анимации, а не у соседней в том же списке.
    expect(curveProblems(css(".x { animation: clock-hand var(--move-clock) linear infinite, spin var(--move) linear infinite; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation: spin var(--move) linear infinite; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation: clock-hands var(--move-clock) linear infinite; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { transition: transform var(--move) linear; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation-timing-function: linear; }"))).toHaveLength(1);
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

  it("ссылка на элемент по имени из букв a–f — не цвет, а цвет с тем же именем — цвет", () => {
    const svg = (inner: string) => `.x { mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E${inner}%3C/svg%3E"); }`;
    expect(colourProblems(css(svg("%3ClinearGradient id='fade'/%3E%3Crect fill='url(%23fade)'/%3E")))).toEqual([]);
    expect(colourProblems(css(svg("%3Crect filter=%27url(%22%23bead%22)%27/%3E")))).toEqual([]);
    expect(colourProblems(css(svg("%3Cuse href='%23cafe'/%3E%3Cuse xlink:href=%22%23decaf%22/%3E")))).toEqual([]);
    expect(colourProblems(css(".x { filter: url(#fade); }"))).toEqual([]);
    expect(colourProblems(css(svg("%3Crect fill='%23fade'/%3E")))).toHaveLength(1);
    expect(colourProblems(css(svg("%3Crect fill='url(%23fade)' stroke='%23cafe'/%3E")))).toHaveLength(1);
  });

  it("своя рамка фокуса по месту не проходит", () => {
    expect(focusProblems(css(".x:focus-visible { outline: 2px solid var(--accent); }"))).toHaveLength(1);
    expect(focusProblems(css(".x:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }"))).toHaveLength(1);
    expect(focusProblems(css(".x:focus-visible { outline-color: var(--ink); }"))).toHaveLength(1);
    expect(focusProblems(css(".x:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); } .y:focus-visible { outline: none; }"))).toEqual([]);
    expect(focusProblems(css(".x:focus-visible { outline-offset: var(--focus-offset-tight); }"))).toEqual([]);
    expect(focusProblems(css(".x:focus-visible { outline-offset: 0; }"))).toHaveLength(1);
  });

  it("списки в :is(…) и :where(…) раскрываются, запятая в скобках список не делит", () => {
    expect(splitList(':is(.a, .b) .c, [data-x="1,2"] .d')).toEqual([":is(.a, .b) .c", '[data-x="1,2"] .d']);
    expect(members(":root :is(.a, :where(.b, .c)):hover::before, .d")).toEqual([":root .a:hover::before", ":root .b:hover::before", ":root .c:hover::before", ".d"]);
    expect(members(".x:not(.y, .z):hover")).toEqual([".x:not(.y, .z):hover"]);
  });

  it("нажимаемое в :is(…) видно по элементам, а правило выключенной анимации наведением не считается", () => {
    expect(pointerProblems(css(":is(.a, .b) { cursor: pointer; } :is(.a, .b):hover { opacity: 1; } .a:active, .b:active { opacity: 1; }"))).toEqual([]);
    expect(pointerProblems(css(".a, .b { cursor: pointer; } :is(.a, .b):active { opacity: 1; } .a:hover { opacity: 1; }"))).toEqual([".b: нет :hover"]);
    expect(pointerProblems(css('.x { cursor: pointer; } .x:active { opacity: 1; } :root[data-motion="off"] .x:hover { transform: none; }'))).toEqual([".x: нет :hover"]);
    expect(pointerProblems(css('.x { cursor: pointer; } .x:active { opacity: 1; } :root[data-motion="off"] :is(.x, .y):hover { transform: none; }'))).toEqual([".x: нет :hover"]);
  });

  it("наведение от родителя засчитывается, только если оно записано с причиной", () => {
    const rows = ".row .child { cursor: pointer; } .row:hover .child { opacity: 1; } .row .child:active { opacity: 1; }";
    expect(pointerProblems(css(rows), { hoveredBy: {} })).toEqual([".row .child: нет :hover"]);
    expect(pointerProblems(css(rows), { hoveredBy: { ".row .child": ".row" } })).toEqual([]);
    // Наведение родителя, под которым нет самого элемента, не в счёт — и похожее имя тоже.
    expect(pointerProblems(css(".row .child { cursor: pointer; } .row:hover .other { opacity: 1; } .row .child:active { opacity: 1; }"), { hoveredBy: { ".row .child": ".row" } })).toEqual([".row .child: нет :hover"]);
    expect(pointerProblems(css(".row .child { cursor: pointer; } .row:hover .children { opacity: 1; } .row .child:active { opacity: 1; }"), { hoveredBy: { ".row .child": ".row" } })).toEqual([".row .child: нет :hover"]);
  });

  it("нажимаемое без наведения или без нажатия не проходит", () => {
    expect(pointerProblems(css(".x { cursor: pointer; } .x:hover { color: var(--ink); }"))).toEqual([".x: нет :active"]);
    expect(pointerProblems(css(".x { cursor: pointer; } .x:active { transform: scale(0.97); }"))).toEqual([".x: нет :hover"]);
    expect(pointerProblems(css(".a .b { cursor: pointer; } .a .b:not(:has(i:disabled)):hover::before { opacity: 1; } .a .b:active:not(:disabled) { opacity: 1; }"))).toEqual([]);
    // `.x-y:hover` — не наведение у `.x`.
    expect(pointerProblems(css(".x { cursor: pointer; } .x-y:hover, .x-y:active { opacity: 1; }"))).toHaveLength(2);
    expect(pointerProblems(css(".game-row-head { cursor: pointer; } .game-row-head:hover { opacity: 1; } .game-row:not(.is-open):active { opacity: 1; }"))).toEqual([]);
  });

  it("прокрутка без тонкой полосы или с полосой числом не проходит", () => {
    expect(scrollbarProblems(css(".x { overflow-y: auto; }"))).toHaveLength(1);
    expect(scrollbarProblems(css(".x { overflow: auto; scrollbar-width: thin; }"))).toHaveLength(1);
    expect(scrollbarProblems(css(".x { overflow: auto; scrollbar-width: thin; scrollbar-color: #888 transparent; }"))).toHaveLength(1);
    expect(scrollbarProblems(css(".x { overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent; } .d { overflow-x: auto; scrollbar-width: none; } .h { overflow: hidden; }"))).toEqual([]);
  });

  it("полоса прокрутки сверяется по элементу: в своём правиле, в общем списке или в :is(…)", () => {
    const thin = "scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent;";
    expect(scrollbarProblems(css(`.a, .b { overflow-y: auto; } .a { ${thin} } .b { scrollbar-width: none; }`))).toEqual([]);
    expect(scrollbarProblems(css(`.a, .b { overflow: auto; ${thin} }`))).toEqual([]);
    expect(scrollbarProblems(css(`.a { overflow: auto; } :is(.a, .c) { ${thin} }`))).toEqual([]);
    expect(scrollbarProblems(css(`.a, .b { overflow: auto; } .a { ${thin} }`))).toEqual([".b: scrollbar-width не задана"]);
    // Позднее правило перекрывает раннее.
    expect(scrollbarProblems(css(`.a { overflow: auto; ${thin} } .a { scrollbar-width: auto; }`))).toEqual([".a: scrollbar-width auto"]);
  });

  it("зерно с анимацией, ловящее мышь или слишком плотное — не проходит", () => {
    const noise = 'url("data:image/svg+xml,%3Csvg/%3E")';
    const layer = (extra: string) => css(`.g { position: fixed; inset: 0; z-index: var(--z-grain); pointer-events: none; opacity: 0.035; mask-image: ${noise}; ${extra} }`);
    expect(grainProblems(layer(""))).toEqual([]);
    expect(grainProblems(layer("animation: g var(--move) var(--ease-out);"))).toHaveLength(1);
    expect(grainProblems(css(`.g { position: fixed; inset: 0; z-index: var(--z-grain); opacity: 0.035; mask-image: ${noise}; }`))).toHaveLength(1);
    expect(grainProblems(css(`.g { position: fixed; inset: 0; z-index: var(--z-grain); pointer-events: none; opacity: 0.1; mask-image: ${noise}; }`))).toHaveLength(1);
    expect(grainProblems(css(".a { z-index: var(--z-grain); } .b { z-index: var(--z-grain); }"))).toEqual(["слоёв зерна: 2"]);
  });

  it("бесконечная анимация без паузы в неактивном окне не проходит", () => {
    const spin = "animation: spin var(--move) var(--ease-out) infinite;";
    const pause = (sel: string) => `:root[data-active="off"] ${sel} { animation-play-state: paused; }`;
    expect(pauseProblems(css(`.x { ${spin} }`))).toEqual([".x: не на паузе в неактивном окне"]);
    expect(pauseProblems(css(`.x { ${spin} } ${pause(".x")}`))).toEqual([]);
    // Счётчик повторов отдельным свойством — тоже бесконечная анимация.
    expect(pauseProblems(css(".x { animation-name: spin; animation-iteration-count: infinite; }"))).toHaveLength(1);
    // Пауза по списку и у псевдоэлемента через :is(…) засчитывается каждому.
    expect(pauseProblems(css(`.a { ${spin} } .b::before { ${spin} } :root[data-active="off"] .a, :root[data-active="off"] :is(.b)::before { animation-play-state: paused; }`))).toEqual([]);
  });

  it("пауза засчитывается только самому элементу, только паузой и только в неактивном окне", () => {
    const spin = "animation: spin var(--move) var(--ease-out) infinite;";
    // Пауза соседа с похожим именем или родителя — не пауза элемента.
    expect(pauseProblems(css(`.x { ${spin} } :root[data-active="off"] .x-y { animation-play-state: paused; }`))).toHaveLength(1);
    expect(pauseProblems(css(`.p .x { ${spin} } :root[data-active="off"] .p { animation-play-state: paused; }`))).toHaveLength(1);
    // Тумблер «Анимация» — другое условие, и пауза без условия — не та пауза.
    expect(pauseProblems(css(`.x { ${spin} } :root[data-motion="off"] .x { animation-play-state: paused; }`))).toHaveLength(1);
    expect(pauseProblems(css(`.x { ${spin} } .x { animation-play-state: paused; }`))).toHaveLength(1);
    expect(pauseProblems(css(`.x { ${spin} } :root[data-active="off"] .x { animation-play-state: running; }`))).toHaveLength(1);
    // Имя кадров со словом infinite внутри — не бесконечная анимация.
    expect(pauseProblems(css(".x { animation: infinite-scroll var(--move) var(--ease-out); }"))).toEqual([]);
    // Отмена движения при выключенном тумблере сама паузы не требует.
    expect(pauseProblems(css(':root[data-motion="off"] .x { animation: none; }'))).toEqual([]);
  });

  it("точка с запятой и скобки внутри значения не ломают разбор", () => {
    const d = css('.x { background: url("data:image/svg+xml;utf8,<svg/>") ; color: var(--ink); }');
    expect(d.map((x) => x.prop)).toEqual(["background", "color"]);
  });
});
