import { useSyncExternalStore } from "react";
import { api } from "./api";

/** Крупные цвета, которые человек меняет сам. Остальные токены палитры
 *  выводятся из них: приглушённый текст — тот же текст с прозрачностью,
 *  стекло — цвет панелей с прозрачностью и так далее. */
export const COLOR_KEYS = ["bg", "panel", "text", "accent", "content", "icons", "lines"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type Colors = Record<ColorKey, string>;

export type Mode = "dark" | "light" | "system";
export type Shade = "dark" | "light";

export const PRESETS: Record<Shade, Colors> = {
  dark: {
    bg: "#0f0a12",
    panel: "#473a4d",
    text: "#f7f1f9",
    accent: "#fba355",
    content: "#e4a6c9",
    icons: "#f7f1f9",
    lines: "#cab5d4",
  },
  light: {
    bg: "#f4eef6",
    panel: "#ffffff",
    text: "#241a29",
    // На светлом стекле оранжевый и сакура темнее: и как текст, и под белой
    // надписью на кнопке PLAY держат 4.5:1 (`src/paletteContrast.test.ts`).
    accent: "#a84a0a",
    content: "#8f3568",
    icons: "#3a2c40",
    lines: "#5a4363",
  },
};

/** Готовые цвета в выборе: по одному ряду на всё, что обычно ищут. */
export const SWATCHES = [
  "#0f0a12", "#1b1f2a", "#f4eef6", "#ffffff",
  "#fba355", "#f56b76", "#e4a6c9", "#b98cf0",
  "#6aa8ff", "#4fd1c5", "#7bd389", "#ffd166",
];

export interface Theme {
  mode: Mode;
  /** Свои цвета поверх готовой темы; ключа нет — цвет из темы. */
  colors: Partial<Colors>;
}

export const DEFAULT_THEME: Theme = { mode: "dark", colors: {} };

/** Ответ моста как есть: незнакомое — тёмная тема, код не цвета — цвет темы. */
export function asTheme(raw: unknown): Theme {
  if (typeof raw !== "object" || raw === null) return DEFAULT_THEME;
  const r = raw as { mode?: unknown; colors?: Record<string, unknown> };
  const mode: Mode = r.mode === "light" || r.mode === "system" ? r.mode : "dark";
  const colors: Partial<Colors> = {};
  for (const k of COLOR_KEYS) {
    const v = r.colors?.[k];
    if (typeof v === "string" && isHex(v)) colors[k] = v.toLowerCase();
  }
  return { mode, colors };
}

let theme: Theme = DEFAULT_THEME;
const listeners = new Set<() => void>();

export function isHex(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v);
}

function systemShade(): Shade {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function shadeOf(mode: Mode): Shade {
  return mode === "system" ? systemShade() : mode;
}

export function colorsOf(t: Theme): Colors {
  return { ...PRESETS[shadeOf(t.mode)], ...t.colors };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function mix(a: string, b: string, share: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v * (1 - share) + y[i] * share));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Все токены палитры из крупных цветов. Светлый фон или тёмный — решает
 *  яркость фона, а не выбранная тема: свой тёмный фон в светлой теме даёт
 *  тёмные подложки. */
export function tokensFor(c: Colors): Record<string, string> {
  const light = luminance(c.bg) > 0.4;
  const onAccent = luminance(c.accent) > 0.35 ? mix(c.accent, "#000000", 0.82) : "#ffffff";
  return {
    "--bg": c.bg,
    "--glass": alpha(c.panel, light ? 0.72 : 0.55),
    "--card": alpha(c.panel, light ? 0.6 : 0.4),
    "--line": alpha(c.lines, light ? 0.2 : 0.16),
    "--line-strong": alpha(c.lines, light ? 0.36 : 0.3),
    "--ink": c.text,
    "--ink-dim": alpha(c.text, light ? 0.72 : 0.64),
    "--ink-faint": alpha(c.text, light ? 0.66 : 0.58),
    "--accent": c.accent,
    "--accent-ink": onAccent,
    "--content": c.content,
    "--content-soft": mix(c.content, c.bg, 0.15),
    // Подпись раздела приглушена прозрачностью; на светлом она ближе к тексту.
    "--label": mix(c.content, c.text, light ? 0.8 : 0.5),
    "--icon": c.icons,
    "--danger": light ? "#b42334" : "#f56b76",
    "--track": alpha(c.text, 0.14),
    "--dot": alpha(c.text, 0.25),
    "--dot-dim": alpha(c.text, 0.12),
    "--scrollbar": alpha(c.text, 0.22),
    "--fallback-ink": alpha(c.text, 0.55),
    "--skeleton": alpha(c.text, 0.08),
    "--hover": alpha(c.text, 0.06),
    "--plate": alpha(c.bg, 0.66),
    "--plate-soft": alpha(c.bg, 0.45),
    "--plate-strong": alpha(c.bg, 0.7),
    "--plate-badge": alpha(c.bg, 0.75),
    "--glass-edge": `inset 0 1px 0 ${alpha(light ? "#ffffff" : c.text, light ? 0.5 : 0.07)}`,
    "--shadow-text": `0 2px 8px ${alpha(c.bg, 0.6)}`,
  };
}

const PAINTED = Object.keys(tokensFor(PRESETS.dark));

function paint() {
  const root = document.documentElement;
  const colors = colorsOf(theme);
  const shade = luminance(colors.bg) > 0.4 ? "light" : "dark";
  root.dataset.shade = shade;
  root.style.colorScheme = shade;
  // Тёмная тема без своих цветов — палитра из стилей как есть.
  if (theme.mode === "dark" && Object.keys(theme.colors).length === 0) {
    for (const k of PAINTED) root.style.removeProperty(k);
    return;
  }
  for (const [k, v] of Object.entries(tokensFor(colors))) root.style.setProperty(k, v);
}

// Пока тянешь цвет, он меняется десятки раз в секунду; в конфиг уходит
// последний, когда рука остановилась. Все, кто ждал записи, узнают её исход.
const SAVE_DELAY_MS = 250;
let saveTimer: number | undefined;
let waiting: { done: () => void; fail: (e: unknown) => void }[] = [];

function save(): Promise<void> {
  window.clearTimeout(saveTimer);
  return new Promise((done, fail) => {
    waiting.push({ done, fail });
    saveTimer = window.setTimeout(() => {
      const those = waiting;
      waiting = [];
      api.setTheme(theme).then(
        () => those.forEach((w) => w.done()),
        (e: unknown) => those.forEach((w) => w.fail(e)),
      );
    }, SAVE_DELAY_MS);
  });
}

function show(next: Theme) {
  theme = next;
  paint();
  for (const l of listeners) l();
}

function commit(next: Theme): Promise<void> {
  show(next);
  return save();
}

/** Тема из конфига — до первой отрисовки, без записи обратно. */
export function setThemeAll(next: Theme) {
  show(next);
}

export function startTheme() {
  paint();
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (theme.mode === "system") {
        paint();
        for (const l of listeners) l();
      }
    });
  }
}

export function setMode(mode: Mode): Promise<void> {
  return commit({ ...theme, mode });
}

export function setColor(key: ColorKey, value: string): Promise<void> {
  return commit({ ...theme, colors: { ...theme.colors, [key]: value.toLowerCase() } });
}

export function resetColors(): Promise<void> {
  return commit({ ...theme, colors: {} });
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => theme,
  );
}
