import { describe, expect, it } from "vitest";
import rawCss from "./styles.css?raw";
import indexHtml from "../index.html?raw";
import previewHtml from "../preview.html?raw";

// Файл читается средствами Vite (`?raw`), как в остальных сторожах: типов Node в
// проекте нет, а новая зависимость не нужна. Чтобы Vitest не подменял CSS пустой
// строкой, `vite.config.ts` разрешает ему обрабатывать именно этот файл.

interface Decl {
  selector: string;
  prop: string;
  value: string;
}

/**
 * Текст без комментариев. Посимвольно и с кавычками: `content: "/*"` — строка,
 * а не начало комментария. Регулярное выражение съело бы всё от неё до
 * ближайшего конца комментария, и правила между ними пропали бы для сторожей.
 */
function stripComments(text: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) out += text[++i];
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += ch;
  }
  return out;
}

/**
 * Все объявления таблицы вместе с селектором своего блока. Разбор посимвольный:
 * кавычки и скобки учитываются, поэтому `;` внутри `url("data:…;…")` не рвёт
 * объявление. Комментарии не в счёт.
 */
function parse(text: string): Decl[] {
  const src = stripComments(text);
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
/**
 * Время числом, со знаком: `-3s` — задержка вперёд, а не часть имени; в имени
 * вроде `fade-3s` цифра времени не считается. Единицы в CSS пишутся любым
 * регистром — `1S` и `300MS` тоже время.
 */
const TIME = /(?<![\w-])[-+]?\d*\.?\d+m?s(?![\w-])/i;
/** Кривая числом или словом, тоже любым регистром. */
const CURVE = /cubic-bezier\(|steps\(|linear\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)(?![\w-])/i;
/**
 * Своя кривая — у фонового дрейфа арта, который не появление и не нажатие, и
 * только в его собственной анимации: он плавно разворачивается у краёв
 * (`ease-in-out`). Больше ни у кого, и в шкалу `--ease-…` эта кривая не входит.
 * Пружина стрелки часиков сроков — переменная шкалы `--ease-clock`.
 */
const OWN_CURVE: Record<string, string> = { "art-drift": "ease-in-out" };

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

/** Кривые только из шкалы; `ease-in-out` — только у дрейфа арта. */
function curveProblems(decls: Decl[]): string[] {
  const bad: string[] = [];
  for (const d of decls) {
    if (isRoot(d.selector) || !TIMING_PROPS.includes(d.prop)) continue;
    for (const s of segments(d.value)) {
      const curves = [...withoutVarNames(s).matchAll(new RegExp(CURVE.source, "gi"))].map((m) => m[0].toLowerCase());
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
// Системные цвета — цвета темы Windows, а не палитры: на чужой теме `Canvas`
// бывает белым. CSS Color 4: https://www.w3.org/TR/css-color-4/#css-system-colors
// и устаревшие там же (#deprecated-system-colors).
const SYSTEM =
  "accentcolor|accentcolortext|activetext|buttonborder|buttonface|buttontext|canvas|canvastext|field|fieldtext|graytext|highlight|highlighttext|" +
  "linktext|mark|marktext|selecteditem|selecteditemtext|visitedtext|" +
  "activeborder|activecaption|appworkspace|background|buttonhighlight|buttonshadow|captiontext|inactiveborder|inactivecaption|inactivecaptiontext|" +
  "infobackground|infotext|menu|menutext|scrollbar|threeddarkshadow|threedface|threedhighlight|threedlightshadow|threedshadow|window|windowframe|windowtext";
const COLOUR_LITERAL = new RegExp(
  `#[0-9a-f]{3,8}(?![\\w-])|(?<![\\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|(?<![\\w-])(${NAMED}|${SYSTEM})(?![\\w-])`,
  "i",
);

/** Экранирование адреса раскрыто: в `data:`-картинке `%23ff8800` и `%27red%27` — те же цвета, что в самом правиле. */
const unescaped = (value: string) => value.replace(/%[\da-f]{2}/gi, (m) => String.fromCharCode(Number.parseInt(m.slice(1), 16)));

/**
 * `data:`-картинка в base64 раскрыта: цвет в её разметке — такой же цвет, как
 * записанный в адресе прямо. Нераскрываемое остаётся как было.
 */
const decodedData = (value: string) =>
  value.replace(/(data:[^,"')]*;base64,)([A-Za-z0-9+/=\s]+)/gi, (whole, head: string, payload: string) => {
    try {
      return head + atob(payload.replace(/\s+/g, ""));
    } catch {
      return whole;
    }
  });

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
 * несут цвет, как и цвет внутри `data:`-картинки, записанный в адресе (`%23…`)
 * или в base64. Системный цвет (`Canvas`, `CanvasText`…) — тоже мимо палитры.
 * Разрешены `transparent`, `currentColor`, `inherit` и смесь токенов через
 * `color-mix` — в них нет числа, которое разойдётся с палитрой. Зерно из
 * `data:`-картинки должно брать цвет из токена или быть без цвета.
 */
function colourProblems(decls: Decl[]): string[] {
  return decls
    .filter((d) => !isRoot(d.selector) && COLOUR_LITERAL.test(withoutRefs(decodedData(unescaped(d.value)))))
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
 * У всего, что нажимается (`cursor: pointer`), есть наведение и нажатие.
 * Нажатие или наведение может откликаться на родителе — тогда это записано
 * здесь же, с причиной. Правило выключенного тумблера
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
const INFINITE = /(?<![\w-])infinite(?![\w-])/i;

/**
 * Больше стольких повторов — уже фоновое движение, а не короткий отклик
 * (вздрогнуть пару раз): сторожа паузы и тумблера считают такую анимацию
 * бесконечной. `animation: x … 100000` иначе прошла бы мимо обоих.
 */
const MAX_REPEATS = 3;

/** Значение без вызовов функций: `calc(var(--move) * 40)` и `cubic-bezier(…)` — не слова значения. */
function withoutCalls(value: string): string {
  let out = value;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/[\w-]*\([^()]*\)/g, " ");
  }
  return out;
}

/** Число без единиц отдельным словом — в анимации это счётчик повторов. */
const COUNT = /(?<![\w.%-])\d*\.?\d+(?:e[+-]?\d+)?(?![\w.%-])/gi;

/** Анимация с этим значением бесконечна: `infinite` или повторов больше MAX_REPEATS. */
const endless = (value: string) =>
  INFINITE.test(value) || [...withoutCalls(value).matchAll(COUNT)].some((m) => Number(m[0]) > MAX_REPEATS);

/**
 * Элементы с бесконечной анимацией — в сокращении `animation` или в
 * `animation-iteration-count`. Правила тумблера и неактивного окна — не
 * элементы: они только отменяют или ставят на паузу.
 */
function infiniteMembers(decls: Decl[]): string[] {
  const found = decls
    .filter((d) => !isRoot(d.selector))
    .filter((d) => (d.prop === "animation" && segments(d.value).some(endless)) || (d.prop === "animation-iteration-count" && segments(d.value).some(endless)))
    .flatMap((d) => members(d.selector))
    .filter((s) => !isMotionOff(s) && !INACTIVE.test(s));
  return [...new Set(found)];
}

/**
 * Бесконечное движение стоит на паузе, пока окно неактивно: каждый элемент,
 * чья анимация бесконечна, есть в правиле
 * `:root[data-active="off"] … { animation-play-state: paused }` — сам, а не
 * его родитель или сосед. Правило выключенного тумблера «Анимация» паузой не
 * считается: тумблер и неактивное окно — разные условия.
 */
function pauseProblems(decls: Decl[]): string[] {
  const outside = decls.filter((d) => !isRoot(d.selector));
  const infinite = infiniteMembers(decls);
  const paused = new Set(
    outside
      .filter((d) => d.prop === "animation-play-state" && d.value === "paused")
      .flatMap((d) => members(d.selector))
      .filter((s) => INACTIVE.test(s))
      .map((s) => s.replace(INACTIVE, "")),
  );
  return infinite.filter((s) => !paused.has(s)).map((s) => `${s}: не на паузе в неактивном окне`);
}

/** Сколько элементов с бесконечной анимацией в стилях: сторожа паузы и тумблера видят их. */
const infiniteCount = (decls: Decl[]) => infiniteMembers(decls).length;

/** Блок тумблера «Анимация»: ровно `:root[data-motion="off"]`, без потомков. */
const MOTION_SWITCH = /^:root\[data-motion=["']?off["']?\]$/;
/** Правило тумблера для элемента: `:root[data-motion="off"] <элемент>`. */
const MOTION_OFF = /^:root\[data-motion=["']?off["']?\]\s+/;

/**
 * Тумблер «Анимация» обнуляет --move в одном месте, и с ней — все
 * длительности. Последний блок `:root[data-motion="off"]`, который
 * задаёт --move, задаёт ровно `0s`. Больше --move не задаёт никто — ни другой
 * блок `:root[…]`, ни обычное правило, — кроме одной основы в `:root`, и та без
 * `!important`: важное объявление перебило бы тумблер, хоть он и весомее.
 */
function motionSwitchProblems(decls: Decl[]): string[] {
  const bad: string[] = [];
  const switches: string[] = [];
  let base = 0;
  for (const d of decls.filter((x) => x.prop === "--move")) {
    for (const m of members(d.selector)) {
      if (m === ":root") {
        base++;
        if (/!\s*important/i.test(d.value)) bad.push(`:root { --move: ${d.value} } — важное объявление перебило бы тумблер`);
      } else if (MOTION_SWITCH.test(m)) switches.push(d.value);
      else bad.push(`${m} { --move: ${d.value} } — --move задают только основа в :root и тумблер`);
    }
  }
  if (base !== 1) bad.push(`основ --move в :root: ${base}`);
  const last = switches.pop();
  if (last !== "0s") bad.push(`тумблер «Анимация» задаёт --move: ${last ?? "нигде"} вместо 0s`);
  return bad;
}

/**
 * Отмена бесконечного движения через предка, а не у самого элемента, — с
 * причиной. Блик «запускается…» убран целиком: остановленная полоса света
 * посреди кнопки выглядела бы пятном, а состояние запуска видно по надписи.
 */
const KILLED_BY: Record<string, { selector: string; prop: string; value: string }> = {
  ".play-sheen::before": { selector: ".play-sheen", prop: "display", value: "none" },
};

/**
 * Тумблер «Анимация» выключен — бесконечного движения нет: обнулённая --move
 * его не останавливает, а превращает в вырожденный цикл.
 * Поэтому каждый элемент с бесконечной анимацией отменён правилом
 * `:root[data-motion="off"] … { animation: none }` — сам, последним таким
 * правилом, — или способом из KILLED_BY. Пауза — не отмена: её ставит другое
 * условие, неактивное окно.
 */
function motionOffProblems(decls: Decl[], killedBy = KILLED_BY): string[] {
  const offRules = decls.filter((d) => !isRoot(d.selector));
  /** Последнее значение свойства в правилах тумблера для элемента — побеждает в каскаде. */
  const lastOff = (member: string, props: string[]) =>
    offRules
      .filter((d) => props.includes(d.prop) && members(d.selector).some((s) => MOTION_OFF.test(s) && s.replace(MOTION_OFF, "") === member))
      .pop()?.value;
  return infiniteMembers(decls)
    .filter((m) => {
      if (lastOff(m, ["animation", "animation-name"]) === "none") return false;
      const via = killedBy[m];
      return !via || lastOff(via.selector, [via.prop]) !== via.value;
    })
    .map((m) => `${m}: не отменена при выключенном тумблере «Анимация»`);
}

/** Переменная шкалы для размера шрифта или для скругления. */
type Scale = "text" | "r";
const SCALE_PROP: Record<Scale, RegExp> = { text: /^font-size$/, r: /^border(-[\w-]+)?-radius$/ };
/** Размер иконки дока: подпись иконки, буква-заглушка и её скругление считаются от него. */
const DOCK_BASE = "--dock-size";
/** Множители без единиц, которые ставит код по месту: растяжение таблетки выбора (`Segmented.tsx`). */
const SET_BY_CODE = new Set(["--pill-scale"]);

/**
 * Проверка размера по шкале. Значение собирается из переменных шкалы —
 * `--text-…` для шрифта, `--r-…` для скругления, — из размера дока или из
 * своих переменных, которые сами собраны так же (`--s-hint` настроек — это
 * `--text-sm`). Кроме переменных в значении только множители без единиц, `0`,
 * знаки и `calc`: смесь токена с числом (`var(--r-sm) 13px`,
 * `calc(var(--text-xs) + 1.5px)`) — тот же размер мимо шкалы.
 * Скругление ещё бывает кругом (`50%`) и на толщину рамки меньше
 * (`calc(… - 1px)`): слой внутри кнопки ложится в её внутренний край и не
 * скруглён сильнее внешнего.
 */
function sizeChecker(decls: Decl[]) {
  const defs = new Map<string, string[]>();
  for (const d of decls) {
    if (d.prop.startsWith("--")) defs.set(d.prop, [...(defs.get(d.prop) ?? []), d.value.replace(/\s*!\s*important$/i, "")]);
  }
  const scale = (kind: Scale) => new Set(decls.filter((d) => d.selector === ":root" && d.prop.startsWith(`--${kind}-`)).map((d) => d.prop));
  const scales: Record<Scale, Set<string>> = { text: scale("text"), r: scale("r") };
  /** То, что остаётся без переменных, — только числа без единиц, знаки и скобки. */
  const bare = (value: string, kind: Scale) => {
    let rest = value;
    for (let prev = ""; prev !== rest; ) {
      prev = rest;
      rest = rest.replace(/var\([^()]*\)/g, " ");
    }
    if (kind === "r") rest = rest.replace(/\s-\s1px(?=\s*\))/g, " ");
    rest = rest.replace(/(?<![\w-])(calc|min|max|clamp)\(/gi, "(");
    return /^[\s\d.*/+()\-,]*$/.test(rest);
  };
  const fits = (value: string, kind: Scale, seen: string[] = []): boolean => {
    for (const [, name] of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (scales[kind].has(name) || name === DOCK_BASE || SET_BY_CODE.has(name)) continue;
      const own = defs.get(name);
      if (!own || seen.includes(name) || !own.every((v) => fits(v, kind, [...seen, name]))) return false;
    }
    return bare(value, kind);
  };
  /** Значение свойства размера: из шкалы и без чисел мимо неё. */
  return (value: string, kind: Scale) =>
    (kind === "r" && (value === "50%" || value === "0")) || (/var\(/.test(value) && fits(value, kind));
}

/**
 * Размер шрифта и скругления — только из шкал, включая длинные записи
 * скруглений (`border-top-left-radius`). Переменную шкалы нельзя и
 * переопределить по месту: `--r-sm: 13px` в правиле — та же шкала, сдвинутая
 * мимо проверки.
 */
function sizeProblems(decls: Decl[]): string[] {
  const fits = sizeChecker(decls);
  const bad: string[] = [];
  for (const d of decls) {
    if (d.selector !== ":root" && /^--(text|r)-/.test(d.prop)) bad.push(`${d.selector} { ${d.prop}: ${d.value} } — шкала задаётся только в :root`);
    if (isRoot(d.selector)) continue;
    for (const kind of ["text", "r"] as const) {
      if (SCALE_PROP[kind].test(d.prop) && !fits(d.value, kind)) bad.push(`${d.selector} { ${d.prop}: ${d.value} }`);
    }
  }
  return bad;
}

/** Сокращение `font`: вес, размер переменной, высота строки числом, семейство. */
const FONT_SHORTHAND = /^(\d+) (var\(--[\w-]+\))(?:\/[\d.]+)? \S/;

/**
 * Веса — только 400, 500 и 600 — и в `font-weight`, и в сокращении `font`;
 * размер в сокращении — тоже из шкалы.
 */
function fontProblems(decls: Decl[]): string[] {
  const fits = sizeChecker(decls);
  const weight = (w: string) => /^(400|500|600)$/.test(w);
  const bad: string[] = [];
  for (const d of decls.filter((x) => !isRoot(x.selector))) {
    if (d.prop === "font-weight" && !weight(d.value)) bad.push(`${d.selector} { font-weight: ${d.value} }`);
    if (d.prop !== "font" || d.value === "inherit") continue;
    const m = FONT_SHORTHAND.exec(d.value);
    if (!m || !weight(m[1]) || !fits(m[2], "text")) bad.push(`${d.selector} { font: ${d.value} }`);
  }
  return bad;
}

/** Анимируются только они. */
const ANIMATED = new Set(["transform", "opacity"]);

/**
 * Свёрнутый раздел боковой панели уходит в ноль плавно, и место за ним плавно
 * достаётся соседям. Через `transform` этого не сделать: сжатие картинкой
 * оставляет место за разделом прежним, и соседи прыгают в конце. Поэтому у
 * обёртки раздела — и только у неё — переход строки сетки `0fr ↔ 1fr`: это
 * высота содержимого без замеров и без `max-height` наугад. Длительность —
 * та же шкала `--move`, и тумблер «Анимация» сворачивает раздел мгновенно.
 */
const FOLD_ROWS: Record<string, string[]> = { ".panel-fold": ["grid-template-rows"] };

/**
 * Свойства сверх `transform` и `opacity` в переходах — у конкретных элементов,
 * с причиной. Подпись PLAY: спрятанная надпись ещё и `visibility: hidden`,
 * чтобы её не слышал экранный диктор. Переход `visibility` кадров не рисует —
 * значение меняется скачком в начале или в конце перехода прозрачности;
 * такое отступление от правила допустимо.
 */
const ALSO_ANIMATED: Record<string, string[]> = { ".play-label > span": ["visibility"], ...FOLD_ROWS };

/** Слова части перехода, которые не свойство: время, кривая, поведение. */
const NOT_PROPERTY = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete)$/i;

/**
 * Переходы — только `transform` и `opacity`: в `transition-property` и в
 * каждой части сокращения `transition`. Часть без свойства — это `all`, и она
 * не проходит, как и `all` словом и свойства раскладки вроде `width`.
 */
function transitionProblems(decls: Decl[], also = ALSO_ANIMATED): string[] {
  const bad: string[] = [];
  for (const d of decls.filter((x) => !isRoot(x.selector) && (x.prop === "transition" || x.prop === "transition-property"))) {
    if (d.value === "none") continue;
    for (const s of segments(d.value)) {
      const words = withoutCalls(s)
        .split(/\s+/)
        .filter((w) => w && !TIME.test(w) && !NOT_PROPERTY.test(w));
      const prop = d.prop === "transition-property" ? s.toLowerCase() : words.length === 1 ? words[0].toLowerCase() : words.length ? words.join(" ") : "all";
      for (const m of members(d.selector)) {
        if (!ANIMATED.has(prop) && !(also[m] ?? []).includes(prop)) bad.push(`${m} { ${d.prop}: … ${prop} … }`);
      }
    }
  }
  return bad;
}

/** Селектор кадра внутри `@keyframes`: `from`, `to`, проценты или их список. */
const KEYFRAME = /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/i;

/** Кадры анимаций тоже двигают только `transform` и `opacity`. */
function keyframeProblems(decls: Decl[]): string[] {
  return decls.filter((d) => KEYFRAME.test(d.selector) && !ANIMATED.has(d.prop)).map((d) => `${d.selector} { ${d.prop}: ${d.value} }`);
}

/** Последнее звено селектора — элемент, к которому правило относится, — без `:focus-visible` и `:focus`. */
function focusedCompound(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  return selector.slice(start).replace(/:focus(-visible)?(?![\w-])/g, "");
}

/**
 * Убранная рамка фокуса (`outline: none` или `0`) — только с заменой: та же
 * общая рамка на другом элементе, пока этот в фокусе (иконка дока — вокруг
 * картинки, превью видео — вокруг кадра, галочка найденной игры — вокруг всей
 * строки). Без замены элемент в фокусе с клавиатуры не виден.
 */
function ringRemovalProblems(decls: Decl[]): string[] {
  const outside = decls.filter((d) => !isRoot(d.selector));
  const rings = outside.filter((d) => d.prop === "outline" && d.value === "var(--focus-ring)").flatMap((d) => members(d.selector));
  const bad: string[] = [];
  for (const d of outside.filter((x) => x.prop === "outline" && (x.value === "none" || x.value === "0"))) {
    for (const m of members(d.selector)) {
      const ring = new RegExp(`(?:^|[\\s>+~(])${escapeRe(focusedCompound(m))}:focus-visible(?![\\w-])`);
      if (!rings.some((r) => ring.test(r))) bad.push(`${m}: рамка фокуса убрана без замены`);
    }
  }
  return bad;
}

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
 * Зерно: ровно один слой на уровне `--z-grain`, неподвижный, сквозной для
 * мыши, поверх всего окна, 3–4 % непрозрачности.
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

  it("размер шрифта и скругления — только из шкал или от размера дока", () => {
    expect(sizeProblems(decls)).toEqual([]);
  });

  it("вес шрифта — только 400, 500 и 600, и сокращение font не прячет ни вес, ни размер числом", () => {
    expect(fontProblems(decls)).toEqual([]);
  });

  it("анимируются только transform и opacity: в переходах и в кадрах", () => {
    expect(transitionProblems(decls)).toEqual([]);
    expect(keyframeProblems(decls)).toEqual([]);
    expect(of("transition").length + of("transition-property").length).toBeGreaterThan(30);
  });

  it("убранная рамка фокуса — только с заменой на другом элементе", () => {
    expect(ringRemovalProblems(decls)).toEqual([]);
    expect(of("outline").filter((v) => v === "none").length).toBeGreaterThanOrEqual(3);
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

describe("тумблер «Анимация» выключает всё движение", () => {
  it("--move обнуляет блок тумблера, и больше её никто не задаёт", () => {
    expect(motionSwitchProblems(decls)).toEqual([]);
  });

  it("всё бесконечное движение отменено при выключенном тумблере", () => {
    expect(infiniteCount(decls)).toBeGreaterThanOrEqual(5);
    expect(motionOffProblems(decls)).toEqual([]);
  });

  // Копия настоящих стилей, в которой убрано одно звено: сторож обязан
  // покраснеть. Образец ищется сначала — правка стилей, после которой он не
  // находится, роняет тест, а не делает его пустым.
  const without = (pattern: RegExp, to = "") => {
    expect(rawCss, String(pattern)).toMatch(pattern);
    return parse(rawCss.replace(pattern, to));
  };

  it("без блока тумблера или с ним, перекрытым позже, сторож краснеет", () => {
    expect(motionSwitchProblems(without(/:root\[data-motion="off"\]\s*\{\s*--move:\s*0s;\s*\}/))).not.toEqual([]);
    expect(motionSwitchProblems(parse(`${rawCss}\n:root[data-motion="off"] { --move: 0.18s; }`))).not.toEqual([]);
    expect(motionSwitchProblems(parse(`${rawCss}\n:root[data-motion="off"][data-x] { --move: 1s; }`))).not.toEqual([]);
  });

  it("без отмены любого бесконечного движения сторож краснеет", () => {
    const kills: [string, RegExp, string][] = [
      [".art-photo", /:root\[data-motion="off"\] \.art-photo\s*\{\s*animation:\s*none;\s*\}/, ""],
      [".play-sheen::before", /:root\[data-motion="off"\] \.play-sheen\s*\{\s*display:\s*none;\s*\}/, ""],
      [".img-tone::before", /,\s*:root\[data-motion="off"\] \.img-tone::before(?=\s*\{)/, ""],
      [".skeleton-block", /:is\(\.skeleton-block, (?=\.img-shown, \.clock-hand\))/, ":is("],
      [".clock-hand", /, \.clock-hand\)(?=,\s*:root\[data-motion="off"\] \.img-tone::before)/, ")"],
    ];
    for (const [member, kill, to] of kills) {
      expect(motionOffProblems(without(kill, to)), member).toEqual([`${member}: не отменена при выключенном тумблере «Анимация»`]);
    }
    // Отмена, перекрытая позже, — не отмена.
    const later = ':root[data-motion="off"] .art-photo { animation: art-drift var(--move-ambient) ease-in-out infinite alternate; }';
    expect(motionOffProblems(parse(`${rawCss}\n${later}`))).toEqual([".art-photo: не отменена при выключенном тумблере «Анимация»"]);
    const shown = ':root[data-motion="off"] .play-sheen { display: block; }';
    expect(motionOffProblems(parse(`${rawCss}\n${shown}`))).toEqual([".play-sheen::before: не отменена при выключенном тумблере «Анимация»"]);
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

  it("оборот — четыре рывка: по 1.2 с, в последние сутки — по 0.7 с, от переменной движения", () => {
    expect(seconds("--move-clock") / 4).toBeCloseTo(1.2, 2);
    expect(seconds("--move-clock-hot") / 4).toBeCloseTo(0.7, 2);
  });

  it("стрелка прыгает бесконечно, в последние сутки — чаще и своими кадрами", () => {
    expect(value(".clock-hand", "animation")).toEqual(["clock-hand var(--move-clock) var(--ease-clock) infinite"]);
    expect(value(".clock.is-hot .clock-hand", "animation-name")).toEqual(["clock-hand-hot"]);
    expect(value(".clock.is-hot .clock-hand", "animation-duration")).toEqual(["var(--move-clock-hot)"]);
  });

  /**
   * Кадры стрелки: стоит на четверти, потом пружиной прыгает на следующую.
   * Возвращает длительность каждого прыжка в секундах.
   */
  const jumps = (name: string, turn: string) => {
    const frames = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?\\})\\s*\\}`).exec(stripComments(rawCss));
    expect(frames, `нет @keyframes ${name}`).not.toBeNull();
    const blocks = [...frames![1].matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
      at: m[1].split(",").map((s) => (s.trim() === "to" ? 100 : s.trim() === "from" ? 0 : Number.parseFloat(s))),
      decls: parse(`x { ${m[2]} }`).map((d) => `${d.prop}: ${d.value}`),
    }));
    const rests = blocks.slice(0, -1);
    expect(rests.map((b) => b.decls)).toEqual([0, 0.25, 0.5, 0.75].map((q) => [`transform: rotate(${q}turn)`]));
    expect(blocks[blocks.length - 1].decls).toEqual(["transform: rotate(1turn)"]);
    // Каждая четверть: стоит с начала своей четверти и прыгает так, чтобы встать к началу следующей.
    rests.forEach((b, i) => expect(b.at[0]).toBe(i * 25));
    return rests.map((b) => ((b.at[0] + 25 - b.at[1]) / 100) * seconds(turn));
  };

  it("прыжок пружиной: обычный ≈0.7 с, в последние сутки ≈0.56 с", () => {
    for (const s of jumps("clock-hand", "--move-clock")) expect(s).toBeCloseTo(0.7, 1);
    for (const s of jumps("clock-hand-hot", "--move-clock-hot")) expect(s).toBeCloseTo(0.56, 1);
  });

  it("пружина стрелки перелетает и пару раз качается, прежде чем встать", () => {
    const m = /^linear\(([^)]*)\)$/.exec(root.get("--ease-clock") ?? "");
    expect(m, "--ease-clock должна быть linear(…)").not.toBeNull();
    const p = m![1].split(",").map(Number);
    expect(p[0]).toBe(0);
    expect(p[p.length - 1]).toBe(1);
    // Перелёт за четверть и обратный недолёт — та самая упругость.
    expect(Math.max(...p)).toBeGreaterThan(1.2);
    const peak = p.indexOf(Math.max(...p));
    expect(Math.min(...p.slice(peak))).toBeLessThan(0.95);
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

  it("первая отрисовка окна — цветом фона палитры: пока стили грузятся, окно не мигает чужим цветом", () => {
    for (const [name, html] of [
      ["index.html", indexHtml],
      ["preview.html", previewHtml],
    ]) {
      const first = /html\s*\{\s*background:\s*(#[0-9a-f]{3,8})\s*;?\s*\}/i.exec(html);
      expect(first?.[1].toLowerCase(), name).toBe(base.get("--bg"));
    }
  });

  it("палитра одна: блоков [data-palette] в стилях нет", () => {
    expect(stripComments(rawCss)).not.toContain("data-palette");
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

  it("linear не разрешён никому, и стрелке часиков тоже: её пружина — переменная шкалы", () => {
    expect(curveProblems(css(".x { animation: clock-hand var(--move-clock) linear infinite; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation: clock-hand var(--move-clock) infinite; }"))).toEqual([]);
    // Своя кривая — только в своей анимации, а не у соседней в том же списке.
    expect(curveProblems(css(".x { animation: art-drift var(--move-ambient) ease-in-out infinite alternate, spin var(--move) ease-in-out infinite; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation: spin var(--move) linear infinite; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation: art-drifts var(--move-ambient) ease-in-out infinite; }"))).toHaveLength(1);
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

  it("комментарий в кавычках — не комментарий: правила за ним не пропадают", () => {
    const d = css('.a::after { content: "/*"; } .b { color: #fff; } /* настоящий */ .c { color: var(--ink); }');
    expect(d.map((x) => `${x.selector} ${x.prop}`)).toEqual([".a::after content", ".b color", ".c color"]);
    expect(colourProblems(d)).toEqual([".b { color: #fff }"]);
    expect(stripComments("a /* x */ b '/* y */' c")).toBe("a  b '/* y */' c");
  });

  it("единицы времени и ключевые слова — без учёта регистра", () => {
    expect(durationProblems(css(":root { --move: 0.18s; --move-fast: 120MS; }"))).toHaveLength(1);
    expect(durationProblems(css(".x { transition: opacity var(--move) var(--ease-out) 1S; }"))).toHaveLength(1);
    expect(durationProblems(css(".x { animation-delay: calc(var(--move) + 300Ms); }"))).toHaveLength(1);
    expect(curveProblems(css(".x { transition: opacity var(--move) EASE-IN; }"))).toHaveLength(1);
    expect(curveProblems(css(".x { animation: art-drift var(--move-ambient) EASE-IN-OUT infinite alternate; }"))).toEqual([]);
    expect(pauseProblems(css(".x { animation: spin var(--move) var(--ease-out) INFINITE; }"))).toHaveLength(1);
  });

  it("без блока тумблера, с перекрытым или чужим --move — не проходит", () => {
    const base = ":root { --move: 0.18s; } ";
    const off = ':root[data-motion="off"] { --move: 0s; } ';
    expect(motionSwitchProblems(css(base + off))).toEqual([]);
    expect(motionSwitchProblems(css(base))).toHaveLength(1);
    expect(motionSwitchProblems(css(base + off + ':root[data-motion="off"] { --move: 0.18s; }'))).toHaveLength(1);
    expect(motionSwitchProblems(css(base + ':root[data-motion="off"] { --move: 0.01s; }'))).toHaveLength(1);
    expect(motionSwitchProblems(css(base + off + ':root[data-motion="off"][data-x] { --move: 1s; }'))).toHaveLength(1);
    expect(motionSwitchProblems(css(base + off + ".x { --move: var(--move-slow); }"))).toHaveLength(1);
    expect(motionSwitchProblems(css(base + off + ':root[data-motion="off"] .x { --move: 1s; }'))).toHaveLength(1);
    // Важное объявление в основе перебило бы тумблер, хоть он и весомее.
    expect(motionSwitchProblems(css(":root { --move: 0.18s !important; } " + off))).toHaveLength(1);
    expect(motionSwitchProblems(css(base + base + off))).toHaveLength(1);
    // Ранний блок тумблера перекрыт последним — считается последний.
    expect(motionSwitchProblems(css(base + ':root[data-motion="off"] { --move: 1s; } ' + off))).toEqual([]);
  });

  it("бесконечное движение без отмены при выключенном тумблере не проходит", () => {
    const spin = "animation: spin var(--move) var(--ease-out) infinite;";
    const off = (sel: string, decl = "animation: none;") => `:root[data-motion="off"] ${sel} { ${decl} }`;
    expect(motionOffProblems(css(`.x { ${spin} }`))).toEqual([".x: не отменена при выключенном тумблере «Анимация»"]);
    expect(motionOffProblems(css(`.x { ${spin} } ${off(".x")}`))).toEqual([]);
    expect(motionOffProblems(css(`.x { animation-name: spin; animation-iteration-count: infinite; } ${off(".x", "animation-name: none;")}`))).toEqual([]);
    // Отмена у родителя или соседа с похожим именем — не отмена самого элемента.
    expect(motionOffProblems(css(`.p .x { ${spin} } ${off(".p")}`))).toHaveLength(1);
    expect(motionOffProblems(css(`.x { ${spin} } ${off(".x-y")}`))).toHaveLength(1);
    // Пауза — не отмена, и отмена без условия тумблера — тоже.
    expect(motionOffProblems(css(`.x { ${spin} } ${off(".x", "animation-play-state: paused;")}`))).toHaveLength(1);
    expect(motionOffProblems(css(`.x { ${spin} } :root[data-active="off"] .x { animation: none; }`))).toHaveLength(1);
    // Перекрытая позже отмена — не отмена.
    expect(motionOffProblems(css(`.x { ${spin} } ${off(".x")} ${off(".x", spin)}`))).toHaveLength(1);
    // Отмена через предка — только записанная с причиной и только если её правило есть.
    const via = { ".x::before": { selector: ".x", prop: "display", value: "none" } };
    expect(motionOffProblems(css(`.x::before { ${spin} } ${off(".x", "display: none;")}`), via)).toEqual([]);
    expect(motionOffProblems(css(`.x::before { ${spin} }`), via)).toHaveLength(1);
    expect(motionOffProblems(css(`.x::before { ${spin} } ${off(".x", "display: none;")} ${off(".x", "display: block;")}`), via)).toHaveLength(1);
    expect(motionOffProblems(css(`.x::before { ${spin} } ${off(".x", "display: none;")}`), {})).toHaveLength(1);
    // Отмена по списку и через :is(…) засчитывается каждому.
    expect(motionOffProblems(css(`.a { ${spin} } .b::before { ${spin} } ${off(".a")} :root[data-motion="off"] :is(.b)::before { animation: none; }`))).toEqual([]);
  });

  it("большое число повторов — тоже бесконечная анимация: на паузу и под тумблер", () => {
    expect(pauseProblems(css(".x { animation: spin var(--move) var(--ease-out) 100000; }"))).toHaveLength(1);
    expect(pauseProblems(css(".x { animation-name: spin; animation-iteration-count: 1e9; }"))).toHaveLength(1);
    expect(pauseProblems(css(".x { animation-name: spin; animation-iteration-count: 1, 50; }"))).toHaveLength(1);
    expect(motionOffProblems(css(".x { animation: spin var(--move) var(--ease-out) 100000; }"))).toHaveLength(1);
    // Пара повторов короткого отклика — не фон; число в скобках и в имени — не счётчик.
    expect(pauseProblems(css(".x { animation: shake var(--move) var(--ease-out) 2; }"))).toEqual([]);
    expect(pauseProblems(css(".x { animation: rise var(--move-slow) var(--ease-out) calc(var(--move-fast) * 40) backwards; }"))).toEqual([]);
    expect(pauseProblems(css(".x { animation: fade-100 var(--move) var(--ease-out); }"))).toEqual([]);
  });

  it("размер шрифта и скругление: длинная запись, смесь токена с числом, своя переменная с числом — не проходят", () => {
    const scale = ":root { --text-xs: 11px; --r-sm: 6px; --r-lg: 16px; } ";
    const bad = [
      ".x { border-top-left-radius: 13px; }",
      ".x { border-start-end-radius: 7px; }",
      ".x { border-radius: var(--r-sm) 13px; }",
      ".x { font-size: calc(var(--text-xs) + 1.5px); }",
      ".x { border-radius: calc(var(--r-sm) - 3px); }",
      ".x { border-radius: calc(var(--r-sm) + 1px); }",
      ".x { --s-probe: 13px; font-size: var(--s-probe); }",
      ".x { --s-probe: calc(var(--text-xs) + 1px); } .y { font-size: var(--s-probe); }",
      ":root { --s-probe: 13px; } .x { font-size: var(--s-probe); }",
      ".x { --r-sm: 13px; border-radius: var(--r-sm); }",
      ".x { font-size: var(--r-sm); }",
      ".x { font-size: larger; }",
      ".x { border-radius: var(--nowhere); }",
    ];
    for (const b of bad) expect(sizeProblems(css(scale + b)), b).toHaveLength(1);
    const good =
      ".s { --s-radius: var(--r-lg); --s-inner: calc(var(--s-radius) - 1px); --s-text: var(--text-xs); --s-hint: var(--text-xs); --k: 1; } " +
      ".a { font-size: var(--s-text); border-radius: var(--s-inner) var(--s-inner) 0 0; } " +
      ".b { border-radius: 50%; border-top-left-radius: 0; } " +
      ".c { border-radius: calc(var(--r-sm) / var(--k)) / var(--r-sm); font-size: var(--s-hint, var(--text-xs)); } " +
      ".d { --dock-size: 44px; font-size: calc(var(--dock-size) * 0.43); border-radius: calc(var(--dock-size) * 0.25); }";
    expect(sizeProblems(css(scale + good))).toEqual([]);
  });

  it("вес в сокращении font — тоже только 400, 500 и 600, размер — переменной шкалы", () => {
    const scale = ":root { --text-sm: 12.5px; } ";
    expect(fontProblems(css(scale + '.x { font: 700 var(--text-sm)/1.2 "Golos Text Variable", sans-serif; }'))).toHaveLength(1);
    expect(fontProblems(css(scale + ".x { font: 600 calc(var(--text-sm) + 1px)/1.2 sans-serif; }"))).toHaveLength(1);
    expect(fontProblems(css(scale + ".x { --s-probe: 13px; font: 600 var(--s-probe)/1 sans-serif; }"))).toHaveLength(1);
    expect(fontProblems(css(scale + ".x { font-weight: 700; } .y { font-weight: bold; }"))).toHaveLength(2);
    expect(fontProblems(css(scale + '.x { font: 600 var(--text-sm)/1 "Golos Text Variable", "Segoe UI", sans-serif; font-weight: 500; } .y { font: inherit; }'))).toEqual([]);
  });

  it("системный цвет — тоже цвет мимо палитры", () => {
    for (const c of ["Canvas", "CanvasText", "LinkText", "ButtonFace", "ButtonBorder", "Field", "Highlight", "GrayText", "AccentColor", "Mark", "Window", "ButtonShadow"]) {
      expect(colourProblems(css(`.x { color: ${c}; }`)), c).toHaveLength(1);
    }
    expect(colourProblems(css(".x { border: 1px solid canvastext; }"))).toHaveLength(1);
    expect(colourProblems(css(".x { color: currentColor; background: transparent; outline-color: inherit; }"))).toEqual([]);
  });

  it("цвет в data:-картинке в base64 не проходит; шум без цвета проходит", () => {
    const b64 = (svg: string) => css(`.x { background-image: url("data:image/svg+xml;base64,${btoa(svg)}"); }`);
    const svg = (inner: string) => `<svg xmlns='http://www.w3.org/2000/svg'>${inner}</svg>`;
    expect(colourProblems(b64(svg("<rect fill='#ff8800'/>")))).toHaveLength(1);
    expect(colourProblems(b64(svg("<rect fill='red'/>")))).toHaveLength(1);
    expect(colourProblems(b64(svg("<rect stroke='Canvas'/>")))).toHaveLength(1);
    expect(colourProblems(b64(svg("<filter id='n'><feTurbulence baseFrequency='.8'/></filter><rect width='100%' height='100%' filter='url(#n)'/>")))).toEqual([]);
  });

  it("переходы — только transform и opacity; visibility — только у подписи PLAY", () => {
    const bad = [
      ".x { transition: width var(--move) var(--ease-out); }",
      ".x { transition: all var(--move) var(--ease-out); }",
      // Без свойства переход — это all.
      ".x { transition: var(--move) var(--ease-out); }",
      ".x { transition: opacity var(--move) var(--ease-out), background-color var(--move) var(--ease-out); }",
      ".x { transition-property: opacity, height; }",
      ".x { transition-property: all; }",
      ".x { transition: visibility var(--move-fast) var(--ease-out); }",
    ];
    for (const b of bad) expect(transitionProblems(css(b)), b).toHaveLength(1);
    expect(transitionProblems(css(".play-label > span { transition: opacity var(--move-fast) var(--ease-out), visibility var(--move-fast) var(--ease-out); }"))).toEqual([]);
    const good =
      ".x { transition: transform var(--move) var(--ease-spring), opacity calc(var(--move) * 2) var(--ease-out) var(--move-fast); transition-property: transform, opacity; } " +
      ':root[data-motion="off"] .x { transition: none; }';
    expect(transitionProblems(css(good))).toEqual([]);
  });

  it("высоту анимирует только обёртка свёрнутого раздела, и только строкой сетки", () => {
    const fold = ".panel-fold { transition: grid-template-rows var(--move) var(--ease-out); }";
    expect(transitionProblems(css(fold))).toEqual([]);
    expect(transitionProblems(css(".panel-fold { transition-property: grid-template-rows, opacity; }"))).toEqual([]);
    const bad = [
      // Другое свойство раскладки у той же обёртки.
      ".panel-fold { transition: height var(--move) var(--ease-out); }",
      ".panel-fold { transition: grid-template-columns var(--move) var(--ease-out); }",
      ".panel-fold { transition: grid-template-rows var(--move) var(--ease-out), max-height var(--move) var(--ease-out); }",
      // То же свойство у другого селектора — и у потомка, и у соседа по списку.
      ".panel-section { transition: grid-template-rows var(--move) var(--ease-out); }",
      ".panel-fold-inner { transition: grid-template-rows var(--move) var(--ease-out); }",
      ".panel .panel-fold { transition: grid-template-rows var(--move) var(--ease-out); }",
      ".panel-fold.is-collapsed { transition: grid-template-rows var(--move) var(--ease-out); }",
      ".x, .panel-fold { transition: grid-template-rows var(--move) var(--ease-out); }",
      ".x { transition: all var(--move) var(--ease-out); }",
    ];
    for (const b of bad) expect(transitionProblems(css(b)), b).toHaveLength(1);
    // Кадры анимаций исключения не получают: там по-прежнему только transform и opacity.
    expect(keyframeProblems(css("@keyframes open { from { grid-template-rows: 0fr; } }"))).toHaveLength(1);
  });

  it("кадры анимаций двигают только transform и opacity", () => {
    expect(keyframeProblems(css("@keyframes grow { from { width: 0; } to { width: 100px; } }"))).toHaveLength(2);
    expect(keyframeProblems(css("@keyframes glow { 50% { box-shadow: 0 0 8px var(--accent); } }"))).toHaveLength(1);
    expect(keyframeProblems(css("@keyframes ok { 70%, to { transform: translateX(225%); opacity: 0; } }"))).toEqual([]);
  });

  it("кривая у кадра не проходит: переменную шкалы браузер там не подставляет и молча берёт ease", () => {
    expect(keyframeProblems(css("@keyframes bad { 0% { transform: rotate(0turn); animation-timing-function: var(--ease-clock); } }"))).toHaveLength(1);
  });

  it("убранная рамка фокуса без замены не проходит", () => {
    expect(ringRemovalProblems(css(".x:focus-visible { outline: none; }"))).toHaveLength(1);
    expect(ringRemovalProblems(css(".x { outline: 0; }"))).toHaveLength(1);
    expect(ringRemovalProblems(css(".x:focus { outline: none; }"))).toHaveLength(1);
    // Замена у соседа с похожим именем — не замена.
    expect(ringRemovalProblems(css(".x:focus-visible { outline: none; } .x-y:focus-visible { outline: var(--focus-ring); }"))).toHaveLength(1);
    expect(ringRemovalProblems(css(".x:focus-visible { outline: none; } .x:focus-visible .icon { outline: var(--focus-ring); }"))).toEqual([]);
    expect(ringRemovalProblems(css(".row input:focus-visible { outline: none; } .row:has(input:focus-visible) { outline: var(--focus-ring); }"))).toEqual([]);
  });
});
