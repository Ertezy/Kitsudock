import { describe, expect, it } from "vitest";
import rawCss from "./styles.css?raw";

// Контраст проверяется по значениям настоящей палитры, с учётом прозрачности
// стекла и текста. Наличие токенов само по себе не гарантирует читаемость.
type Colour = [number, number, number, number];

/**
 * Текст без комментариев. Посимвольно и с кавычками: `content: "/*"` — строка,
 * а не начало комментария. Регулярное выражение съело бы всё от неё до
 * ближайшего конца комментария, и блоки между ними пропали бы для проверки.
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

function colour(value: string): Colour {
  const text = value.trim();
  const hex = /^#([\da-f]{6})$/i.exec(text);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]*)\)$/.exec(text);
  if (rgba) {
    const parts = rgba[1].split(",").map((part) => part.trim());
    if ((parts.length === 3 || parts.length === 4) && parts.every((part) => /^\d*\.?\d+$/.test(part))) {
      const [r, g, b, a = 1] = parts.map(Number);
      if (r <= 255 && g <= 255 && b <= 255 && a <= 1) return [r, g, b, a];
    }
  }
  throw new Error(`не удалось разобрать цвет «${value}»: ждём #rrggbb, rgb(r, g, b) или rgba(r, g, b, a) через запятые`);
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

/**
 * Текст, разрезанный по `;` верхнего уровня: точка с запятой в кавычках или
 * скобках — часть значения, как в `url("data:image/svg+xml;utf8,…")`.
 */
function splitDeclarations(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = "";
  let depth = 0;
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Объявления блока в токены. Обычные свойства (`color-scheme`) пропускаются, обрывок без двоеточия или пустое значение — ошибка. */
function readDeclarations(body: string, into: Map<string, string>): void {
  for (const piece of splitDeclarations(body)) {
    const text = piece.trim();
    if (!text) continue;
    const m = /^([\w-]+)\s*:\s*([\s\S]*\S)$/.exec(text);
    if (!m) throw new Error(`не удалось разобрать объявление в :root: «${text}»`);
    if (m[1].startsWith("--")) into.set(m[1], m[2]);
  }
}

/**
 * Токены из всех блоков `:root { … }` верхнего уровня, в порядке файла: поздний
 * блок перекрывает ранний, как в каскаде. Блоки с атрибутом (`:root[data-motion]`),
 * вложенные в `@media` и любые другие селекторы не берутся: их значения действуют
 * не всегда. Скобки внутри кавычек блок не закрывают. Правила без блока
 * (`@charset …;`, `@import …;`) кончаются точкой с запятой и к заголовку
 * следующего блока не прилипают.
 */
function rootTokens(css: string): Map<string, string> {
  const src = stripComments(css);
  const tokens = new Map<string, string>();
  let blocks = 0;
  let depth = 0;
  let quote = "";
  let head = "";
  let body = "";
  for (const ch of src) {
    if (!quote && ch === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (!quote && ch === "}") {
      depth--;
      if (depth === 0) {
        if (head.trim() === ":root") {
          blocks++;
          readDeclarations(body, tokens);
        }
        head = "";
        body = "";
        continue;
      }
    } else if (ch === '"' || ch === "'") {
      quote = quote === ch ? "" : quote || ch;
    } else if (!quote && depth === 0 && ch === ";") {
      head = "";
      continue;
    }
    if (depth === 0) head += ch;
    else body += ch;
  }
  if (!blocks) throw new Error("в стилях нет блока :root: токены палитры не найдены");
  return tokens;
}

/**
 * Список селекторов без оформления: пробелы и переносы схлопнуты, порядок не
 * важен. `.banner,\n.play-error` и `.play-error, .banner` — одно правило.
 */
const selectorKey = (selector: string) =>
  selector
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .sort()
    .join(", ");

/** Селекторы (в виде `selectorKey`) всех простых правил, где свойство задано ровно этим значением. */
function rulesWith(css: string, prop: string, value: string): string[] {
  const out: string[] = [];
  for (const block of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declaration = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(block[2]);
    if (declaration && declaration[1].trim() === value) out.push(selectorKey(block[1]));
  }
  return out;
}

/** Значение свойства из простого правила `селектор { … }` без вложенных блоков. */
function ruleValue(css: string, selector: string, prop: string): string {
  const key = selectorKey(selector);
  for (const block of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectorKey(block[1]) !== key) continue;
    const declaration = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(block[2]);
    if (declaration) return declaration[1].trim();
  }
  throw new Error(`в стилях нет правила ${selector} со свойством ${prop}`);
}

/**
 * Доля акцента в подложке горящей карточки с кодом. Читается из самого правила
 * `.code-card.burning`, чтобы проверка не разошлась со стилями.
 */
function burningShare(css: string): number {
  const mix = /^color-mix\(\s*in srgb,\s*var\(--accent\)\s*(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/.exec(
    ruleValue(css, ".code-card.burning", "background"),
  );
  if (!mix) throw new Error("подложка .code-card.burning должна быть вида color-mix(in srgb, var(--accent) N%, transparent)");
  return Number(mix[1]) / 100;
}

/**
 * `color-mix(in srgb, …)` двух цветов, как его считает браузер: с
 * предумноженной прозрачностью, поэтому прозрачный край смеси не темнит.
 */
function mix(a: Colour, b: Colour, share: number): Colour {
  const alpha = a[3] * share + b[3] * (1 - share);
  if (alpha === 0) return [0, 0, 0, 0];
  const channel = (i: number) => (a[i] * a[3] * share + b[i] * b[3] * (1 - share)) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
}

/** Смесь вида `color-mix(in srgb, var(--a) N%, var(--b) | transparent)` из правила стилей. */
function mixOf(value: string, get: (name: string) => Colour): Colour {
  const m = /^color-mix\(\s*in srgb,\s*var\((--[\w-]+)\)\s*(\d+(?:\.\d+)?)%\s*,\s*(transparent|var\((--[\w-]+)\))\s*\)$/.exec(value);
  if (!m) throw new Error(`смесь «${value}» должна быть вида color-mix(in srgb, var(--a) N%, var(--b) или transparent)`);
  return mix(get(m[1]), m[4] ? get(m[4]) : [0, 0, 0, 0], Number(m[2]) / 100);
}

/** Токен цвета внутри значения: последний `var(--x)` — `2px solid var(--ink)` → `--ink`. */
function colourToken(value: string): string {
  const all = [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
  const last = all[all.length - 1];
  if (!last) throw new Error(`в «${value}» нет токена цвета`);
  return last;
}

/**
 * Слой зерна (`body::after`): цвет токеном и непрозрачность из правила. Шум
 * в маске прозрачнее этой непрозрачности почти везде, а проверка берёт его
 * сплошным слоем поверх и текста, и того, на чём текст лежит, — с запасом.
 */
function grainVeil(css: string, get: (name: string) => Colour): Colour {
  const opacity = Number(ruleValue(css, "body::after", "opacity"));
  if (!(opacity > 0 && opacity < 0.1)) throw new Error("у зерна нет прозрачности от 0 до 0.1");
  const [r, g, b] = get(colourToken(ruleValue(css, "body::after", "background")));
  return [r, g, b, opacity];
}

/** Прозрачность подписи раздела: сама подпись светлая, но правило её приглушает. */
function labelOpacity(css: string): number {
  const opacity = Number(ruleValue(css, ".panel-label", "opacity"));
  if (!(opacity > 0 && opacity <= 1)) throw new Error("у .panel-label нет прозрачности от 0 до 1");
  return opacity;
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

describe("чтение стилей", () => {
  it("значения из всех блоков :root собираются вместе, поздний блок перекрывает ранний", () => {
    const css = ":root { --a: #111111; --b: #222222; }\n.x { color: red; }\n:root { --b: #333333; --c: rgba(1, 2, 3, 0.5); }";
    expect([...rootTokens(css)]).toEqual([
      ["--a", "#111111"],
      ["--b", "#333333"],
      ["--c", "rgba(1, 2, 3, 0.5)"],
    ]);
  });

  it("чужие блоки не попадают: с атрибутом, внутри @media, обычные селекторы", () => {
    const css = [
      ":root { --a: #111111; }",
      ':root[data-motion="off"] { --a: #999999; --d: 0s; }',
      "@media (min-width: 1px) { :root { --a: #888888; --e: #777777; } }",
      ".x { --a: #666666; --f: #555555; }",
      "html :root { --g: #444444; }",
    ].join("\n");
    expect([...rootTokens(css)]).toEqual([["--a", "#111111"]]);
  });

  it("комментарии, обычные свойства и скобки в кавычках не мешают", () => {
    const css = '/* :root { --x: #000000; } */ .y::after { content: "}"; } :root { color-scheme: dark; --a: #111111 /* тон */ }';
    expect([...rootTokens(css)]).toEqual([["--a", "#111111"]]);
  });

  it("точка с запятой в кавычках и скобках — часть значения, а не конец объявления", () => {
    const css = ':root { --grain: url("data:image/svg+xml;utf8,<svg/>"); --a: #111111; --b: url(data:x;y); }';
    expect([...rootTokens(css)]).toEqual([
      ["--grain", 'url("data:image/svg+xml;utf8,<svg/>")'],
      ["--a", "#111111"],
      ["--b", "url(data:x;y)"],
    ]);
  });

  it("комментарий в кавычках — не комментарий: блоки и правила за ним не пропадают", () => {
    const css = '.x::after { content: "/*"; } :root { --a: #111111; } /* тон */ :root { --b: #222222; }';
    expect([...rootTokens(css)]).toEqual([
      ["--a", "#111111"],
      ["--b", "#222222"],
    ]);
    expect(ruleValue('.x::after { content: "/*"; } .y { opacity: 0.5; } /* c */', ".y", "opacity")).toBe("0.5");
    expect(rulesWith('.x::after { content: "/*"; } .y { opacity: 0.5; } /* c */', "opacity", "0.5")).toEqual([".y"]);
  });

  it("@charset и @import перед :root не мешают найти блок", () => {
    const css = '@charset "utf-8";\n@import url("x.css");\n:root { --a: #111111; }';
    expect([...rootTokens(css)]).toEqual([["--a", "#111111"]]);
  });

  it("смесь цветов считается с предумноженной прозрачностью", () => {
    const get = (name: string): Colour => (name === "--a" ? [200, 100, 0, 1] : [0, 0, 100, 0.5]);
    expect(mixOf("color-mix(in srgb, var(--a) 25%, transparent)", get)).toEqual([200, 100, 0, 0.25]);
    const m = mixOf("color-mix(in srgb, var(--a) 50%, var(--b))", get);
    expect(m[3]).toBeCloseTo(0.75, 8);
    expect(m[0]).toBeCloseTo(133.333, 2);
    expect(m[2]).toBeCloseTo(33.333, 2);
    expect(() => mixOf("var(--a)", get)).toThrow(/color-mix/);
    expect(colourToken("var(--focus-width) solid var(--ink)")).toBe("--ink");
  });

  it("без блока :root — понятная ошибка, а не пустая палитра", () => {
    expect(() => rootTokens(".x { color: red; }")).toThrow(/нет блока :root/);
    expect(() => rootTokens(':root[data-motion="off"] { --move: 0s; }')).toThrow(/нет блока :root/);
  });

  it("обрывок объявления и пустое значение называются в ошибке", () => {
    expect(() => rootTokens(":root { --a: #111111; oops }")).toThrow(/объявление в :root: «oops»/);
    expect(() => rootTokens(":root { --a: ; }")).toThrow(/объявление в :root: «--a:»/);
  });

  it("значение свойства берётся из своего правила, а долю акцента и прозрачность подписи тест читает сам", () => {
    const css = ".a { opacity: 0.1; } .b, .c { opacity: 0.2; } .c { color: red; opacity: 0.65 }";
    expect(ruleValue(css, ".c", "opacity")).toBe("0.65");
    expect(() => ruleValue(css, ".b", "opacity")).toThrow(/нет правила \.b/);
    expect(() => ruleValue(css, ".a", "color")).toThrow(/нет правила \.a со свойством color/);
    // Оформление списка селекторов не важно: переносы, пробелы, порядок.
    const listed = ".banner,\n.play-error {\n  background: color-mix(in srgb, var(--danger) 20%, var(--plate));\n}";
    expect(ruleValue(listed, ".banner, .play-error", "background")).toBe("color-mix(in srgb, var(--danger) 20%, var(--plate))");
    expect(ruleValue(listed, ".play-error,.banner", "background")).toBe("color-mix(in srgb, var(--danger) 20%, var(--plate))");
    expect(() => ruleValue(listed, ".banner", "background")).toThrow(/нет правила \.banner/);
    expect(burningShare(".code-card.burning { background: color-mix(in srgb, var(--accent) 12%, transparent); }")).toBe(0.12);
    expect(() => burningShare(".code-card.burning { background: var(--card); }")).toThrow(/color-mix/);
    expect(labelOpacity(".panel-label { color: var(--label); opacity: 0.65; }")).toBe(0.65);
    expect(() => labelOpacity(".panel-label { opacity: 2; }")).toThrow(/от 0 до 1/);
  });

  it("цвет, который тест не умеет читать, называется в ошибке", () => {
    for (const bad of ["#fff", "hsl(0 0% 100%)", "rgba(1, 2)", "rgba(1, , 3)", "rgba(300, 0, 0, 1)", "rgba(0, 0, 0, 2)", "rgb(0 0 0 / 50%)", "red", ""]) {
      expect(() => colour(bad), bad).toThrow(/не удалось разобрать цвет/);
    }
    expect(() => colour("rgba(1, 2)")).toThrow(/«rgba\(1, 2\)»/);
  });
});

describe("читаемость палитры", () => {
  const palette = () => {
    const tokens = rootTokens(rawCss);
    const get = (name: string): Colour => {
      const value = tokens.get(name);
      if (value === undefined) throw new Error(`в :root нет токена ${name}`);
      try {
        return colour(value);
      } catch (error) {
        throw new Error(`${name}: ${(error as Error).message}`);
      }
    };
    const bg = get("--bg");
    const glass = over(get("--glass"), bg);
    // Карточка в панели лежит на стекле. На экране настроек карточка лежит прямо
    // на фоне и темнее, поэтому стекло и карточка на стекле — худший случай.
    const card = over(get("--card"), glass);
    // Горящая карточка с кодом красится из акцента вместо обычной карточки.
    const accent = get("--accent");
    const burning = over([accent[0], accent[1], accent[2], burningShare(rawCss)], glass);
    // Подсветка под курсором светлит то, на чём лежит. Строка карточки настроек:
    // карточка на фоне и подсветка поверх. Вариант выбора языка: его поле —
    // карточка на такой карточке, и подсветка поверх.
    const settingsCard = over(get("--card"), bg);
    const hoveredRow = over(get("--hover"), settingsCard);
    const hoveredOption = over(get("--hover"), over(get("--card"), settingsCard));
    // Дорожка выбора варианта (`.segmented`) — карточка: на карточке настроек и
    // прямо на фоне (шапка первого запуска).
    const segmentedTrack = over(get("--card"), settingsCard);
    const segmentedTrackOnBg = over(get("--card"), bg);
    // Карточка кода, которую не удалось скопировать: на миг красится из --danger.
    const copyFailed = over(mixOf(ruleValue(rawCss, ".code-card.copy-failed", "background"), get), glass);
    // Подложки поверх арта: подпись над PLAY и ошибки на главном экране. Арт
    // бывает каким угодно, худший случай — белый.
    const white: Colour = [255, 255, 255, 1];
    const plateOnArt = over(get("--plate"), white);
    const errorOnArt = over(mixOf(ruleValue(rawCss, ".banner, .play-error", "background"), get), white);
    // Строка под картинкой баннера — срок и название — на своей подложке поверх
    // стекла панели.
    const bannerFoot = over(get(colourToken(ruleValue(rawCss, ".banner-foot", "background"))), glass);
    return {
      get,
      grain: grainVeil(rawCss, get),
      labelOpacity: labelOpacity(rawCss),
      surfaces: { bg, glass, card, burning, accent, settingsCard, hoveredRow, hoveredOption, segmentedTrack, segmentedTrackOnBg, copyFailed, plateOnArt, errorOnArt, bannerFoot },
    };
  };

  /** Контраст под зерном: слой зерна лежит поверх всего окна — и текста, и подложки. */
  const underGrain = (fg: Colour, surface: Colour, grain: Colour) => contrast(over(grain, over(fg, surface)), over(grain, surface));

  type Surface = keyof ReturnType<typeof palette>["surfaces"];
  const pairs: [string, string, Surface][] = [
    ["основной текст на фоне", "--ink", "bg"],
    ["основной текст на стекле", "--ink", "glass"],
    ["приглушённый текст на стекле", "--ink-dim", "glass"],
    ["приглушённый текст на карточке поверх стекла", "--ink-dim", "card"],
    ["приглушённый текст на горящей карточке кода", "--ink-dim", "burning"],
    ["самый тихий текст на стекле", "--ink-faint", "glass"],
    ["самый тихий текст на карточке поверх стекла", "--ink-faint", "card"],
    ["самый тихий текст на горящей карточке кода", "--ink-faint", "burning"],
    ["цвет содержимого на стекле", "--content", "glass"],
    ["цвет содержимого на карточке поверх стекла", "--content", "card"],
    ["мягкий цвет содержимого на стекле", "--content-soft", "glass"],
    ["мягкий цвет содержимого на карточке поверх стекла", "--content-soft", "card"],
    ["подпись раздела на стекле", "--label", "glass"],
    ["цвет действия как текст на стекле", "--accent", "glass"],
    ["цвет действия как текст на карточке поверх стекла", "--accent", "card"],
    ["цвет действия как текст на горящей карточке кода", "--accent", "burning"],
    ["цвет опасного на стекле", "--danger", "glass"],
    ["текст действия на акценте", "--accent-ink", "accent"],
    ["приглушённый текст на строке настроек под курсором", "--ink-dim", "hoveredRow"],
    ["самый тихий текст на строке настроек под курсором", "--ink-faint", "hoveredRow"],
    ["приглушённый текст на варианте выбора под курсором", "--ink-dim", "hoveredOption"],
    ["основной текст на карточке кода, которую не удалось скопировать", "--ink", "copyFailed"],
    ["приглушённый текст на карточке кода, которую не удалось скопировать", "--ink-dim", "copyFailed"],
    ["самый тихий текст на карточке кода, которую не удалось скопировать", "--ink-faint", "copyFailed"],
    ["подпись над PLAY на подложке поверх белого арта", "--ink", "plateOnArt"],
    ["текст ошибки на её подложке поверх белого арта", "--ink", "errorOnArt"],
  ];
  for (const [name, token, surface] of pairs) {
    it(name + " не ниже 4.5:1, и под зерном тоже", () => {
      const { get, grain, surfaces } = palette();
      expect(contrast(get(token), surfaces[surface])).toBeGreaterThanOrEqual(4.5);
      expect(underGrain(get(token), surfaces[surface], grain)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("подпись раздела на стекле с прозрачностью, которую задаёт .panel-label, не ниже 4.5:1, и под зерном тоже", () => {
    const { get, grain, labelOpacity, surfaces } = palette();
    const [r, g, b, a] = get("--label");
    expect(contrast([r, g, b, a * labelOpacity], surfaces.glass)).toBeGreaterThanOrEqual(4.5);
    expect(underGrain([r, g, b, a * labelOpacity], surfaces.glass, grain)).toBeGreaterThanOrEqual(4.5);
  });

  it("зерно светлое и еле заметное: 3–4 % цвета текста", () => {
    const { get, grain } = palette();
    expect(grain.slice(0, 3)).toEqual(get("--ink").slice(0, 3));
    expect(grain[3]).toBeGreaterThanOrEqual(0.03);
    expect(grain[3]).toBeLessThanOrEqual(0.04);
  });

  it("самый тихий текст заметно тише приглушённого: контраст ниже минимум на 0.5", () => {
    const { get, surfaces } = palette();
    const faint = contrast(get("--ink-faint"), surfaces.glass);
    const dim = contrast(get("--ink-dim"), surfaces.glass);
    expect(dim - faint).toBeGreaterThanOrEqual(0.5);
  });

  // Рамка фокуса — не текст, ей хватает 3:1 к тому, рядом с чем она лежит
  // (WCAG 1.4.11). Обычно она лежит с отступом, поэтому рядом — то, на чём
  // стоит элемент: фон, стекло, карточки, подсвеченные строки. Поверх арта зазор
  // под рамкой закрывает тёмная подложка (`--focus-halo`): светлая рамка на
  // светлом арте иначе пропала бы. В тесной группе (`--focus-offset-tight`) рамка
  // вплотную: изнутри она касается самого элемента — у выбранного варианта это
  // оранжевая таблетка, к ней рамка светлее всего лишь в 1.8 раза, — а снаружи
  // лежит на дорожке группы. Видимой рядом с таблеткой рамку держит эта внешняя
  // кромка, и проверяется именно она (ниже).
  const ring = () => {
    const tokens = rootTokens(rawCss);
    const { get, surfaces } = palette();
    const ringToken = colourToken(tokens.get("--focus-ring") ?? "");
    const haloToken = colourToken(tokens.get("--focus-halo") ?? "");
    return { ringToken, colour: get(ringToken), haloOnArt: over(get(haloToken), [255, 255, 255, 1]), surfaces };
  };

  it("рамка фокуса — не цвет действия: оранжевая вокруг оранжевой кнопки читалась бы как кнопка потолще", () => {
    expect(ring().ringToken).not.toBe("--accent");
  });

  const ringSurfaces: [string, Surface][] = [
    ["на фоне", "bg"],
    ["на стекле", "glass"],
    ["на карточке поверх стекла", "card"],
    ["на горящей карточке кода", "burning"],
    ["на карточке настроек", "settingsCard"],
    ["на строке настроек под курсором", "hoveredRow"],
    ["на варианте выбора под курсором", "hoveredOption"],
  ];
  for (const [name, surface] of ringSurfaces) {
    it(`рамка фокуса ${name} не ниже 3:1`, () => {
      const { colour, surfaces } = ring();
      expect(contrast(colour, surfaces[surface])).toBeGreaterThanOrEqual(3);
    });
  }

  it("рамка фокуса поверх белого арта, на своей подложке, не ниже 3:1", () => {
    const { colour, haloOnArt } = ring();
    expect(contrast(colour, haloOnArt)).toBeGreaterThanOrEqual(3);
  });

  // Где рамка вплотную и на чём лежит её внешняя кромка. Новая тесная группа в
  // стилях без строки здесь — ошибка: её дорожку тоже надо проверить.
  const TIGHT: Record<string, Surface[]> = {
    // Дорожка выбора — карточка: на карточке настроек (вкладка «Вид») и прямо на
    // фоне (первый запуск).
    ".segmented-option:focus-visible": ["segmentedTrack", "segmentedTrackOnBg"],
    // Пара кнопок на карточке кода — обычной, горящей и той, что не скопировалась.
    ".code-buttons button:focus-visible": ["card", "burning", "copyFailed"],
    // Точки карусели — на стекле панели.
    ".carousel-dots .dot:focus-visible": ["glass"],
  };

  it("в тесной группе рамка вплотную только там, где известна её дорожка", () => {
    expect(rulesWith(rawCss, "outline-offset", "var(--focus-offset-tight)").sort()).toEqual(Object.keys(TIGHT).sort());
  });

  for (const [selector, list] of Object.entries(TIGHT)) {
    for (const surface of list) {
      it(`рамка вплотную (${selector}): внешняя кромка на «${surface}» не ниже 3:1`, () => {
        const { colour, surfaces } = ring();
        expect(contrast(colour, surfaces[surface])).toBeGreaterThanOrEqual(3);
      });
    }
  }

  // Часики сроков (спека полировки, §8.3). Дуга кольца — нетекстовая графика,
  // ей хватает 3:1 к тому, на чём она лежит (WCAG 1.4.11): к карточке кода —
  // обычной и горящей — и к строке под картинкой баннера. И к своей дорожке:
  // где дуга кончается, рядом с ней — дорожка на той же подложке. Цвета берутся
  // из самих правил часиков, а не из названий токенов здесь.
  const clock = () => {
    const { get, surfaces } = palette();
    const stroke = (selector: string) => colourToken(ruleValue(rawCss, selector, "stroke"));
    const track = get(stroke(".clock-track"));
    const on = (surface: Colour) => over(track, surface);
    return {
      arc: { normal: get(stroke(".clock-arc")), hot: get(stroke(".clock.is-hot .clock-arc")) },
      places: {
        card: surfaces.card,
        burning: surfaces.burning,
        bannerFoot: surfaces.bannerFoot,
        trackOnCard: on(surfaces.card),
        trackOnBurning: on(surfaces.burning),
        trackOnBannerFoot: on(surfaces.bannerFoot),
      },
    };
  };

  it("горячее кольцо — того же цвета, что срок на горящей карточке; обычное — цвета содержимого", () => {
    const stroke = (selector: string) => colourToken(ruleValue(rawCss, selector, "stroke"));
    expect(stroke(".clock.is-hot .clock-arc")).toBe(colourToken(ruleValue(rawCss, ".code-timer.soon", "color")));
    expect(stroke(".clock-arc")).toBe("--content");
  });

  const clockPairs: [string, "normal" | "hot", keyof ReturnType<typeof clock>["places"]][] = [
    ["обычное кольцо на карточке кода", "normal", "card"],
    ["горячее кольцо на горящей карточке кода", "hot", "burning"],
    ["обычное кольцо на строке баннера", "normal", "bannerFoot"],
    ["горячее кольцо на строке баннера", "hot", "bannerFoot"],
    ["обычное кольцо на своей дорожке на карточке кода", "normal", "trackOnCard"],
    ["горячее кольцо на своей дорожке на горящей карточке", "hot", "trackOnBurning"],
    ["обычное кольцо на своей дорожке на строке баннера", "normal", "trackOnBannerFoot"],
    ["горячее кольцо на своей дорожке на строке баннера", "hot", "trackOnBannerFoot"],
  ];
  for (const [name, arc, place] of clockPairs) {
    it(`часики сроков: ${name} не ниже 3:1`, () => {
      const c = clock();
      expect(contrast(c.arc[arc], c.places[place])).toBeGreaterThanOrEqual(3);
    });
  }
});
