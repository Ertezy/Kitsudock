import { describe, it, expect } from "vitest";
import rawCss from "../styles.css?raw";
import { ENTRY_ANIMATIONS, entryEnded, hubChanged, isEntryAnimation, panelMounted, skeletonShown } from "./panelEntry";

describe("вход панели", () => {
  it("появившаяся панель начинает вход сама — с данными и без них", () => {
    expect(panelMounted(true)).toEqual({ loaded: true, run: 1, kind: "mount" });
    expect(panelMounted(false)).toEqual({ loaded: false, run: 1, kind: "mount" });
  });

  it("данные пришли впервые после конца входа — новый вход, разделы встают сразу", () => {
    const quiet = entryEnded(panelMounted(false), 1);
    expect(hubChanged(quiet, true)).toEqual({ loaded: true, run: 2, kind: "data" });
  });

  it("данные пришли, пока панель ещё выезжает, — вход перезапускается, и разделы тоже встают сразу", () => {
    expect(hubChanged(panelMounted(false), true)).toEqual({ loaded: true, run: 2, kind: "data" });
  });

  it("обновление уже пришедших данных вход не повторяет: тот же объект", () => {
    const quiet = entryEnded(panelMounted(true), 1);
    expect(hubChanged(quiet, true)).toBe(quiet);
    const entering = panelMounted(true);
    expect(hubChanged(entering, true)).toBe(entering);
  });

  it("данные ещё не пришли — ничего не меняется", () => {
    const waiting = panelMounted(false);
    expect(hubChanged(waiting, false)).toBe(waiting);
  });

  it("пропавшие данные входа не начинают, а запоминаются: следующий приход снова вход", () => {
    const quiet = entryEnded(panelMounted(true), 1);
    const lost = hubChanged(quiet, false);
    expect(lost).toEqual({ loaded: false, run: 1, kind: null });
    expect(hubChanged(lost, true)).toEqual({ loaded: true, run: 2, kind: "data" });
  });

  it("конец входа снимает его", () => {
    expect(entryEnded(panelMounted(true), 1)).toEqual({ loaded: true, run: 1, kind: null });
  });

  it("конец прежнего входа новый не обрывает", () => {
    const restarted = hubChanged(panelMounted(false), true);
    expect(entryEnded(restarted, 1)).toBe(restarted);
    expect(entryEnded(restarted, 2).kind).toBeNull();
  });

  it("конец без идущего входа — тот же объект", () => {
    const quiet = entryEnded(panelMounted(true), 1);
    expect(entryEnded(quiet, 1)).toBe(quiet);
  });
});

describe("заглушки панели", () => {
  it("видны, пока данных нет и у выбранной игры они вообще бывают", () => {
    expect(skeletonShown(false, "genshin")).toBe(true);
  });

  it("пришли данные — заглушек нет", () => {
    expect(skeletonShown(true, "genshin")).toBe(false);
  });

  it("у игры без привязки к данным ждать нечего — заглушек нет", () => {
    expect(skeletonShown(false, null)).toBe(false);
  });
});

describe("анимации входа", () => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

  it("узнаются по имени кадров, чужие — нет", () => {
    for (const name of ENTRY_ANIMATIONS) expect(isEntryAnimation(name), name).toBe(true);
    expect(isEntryAnimation("panel-in")).toBe(false);
    expect(isEntryAnimation("skeleton-pulse")).toBe(false);
    expect(isEntryAnimation("")).toBe(false);
  });

  it("каждое имя есть в стилях кадрами и стоит у разделов входа", () => {
    for (const name of ENTRY_ANIMATIONS) expect(css, name).toContain(`@keyframes ${name} {`);
    expect(css).toMatch(/\.panel\[data-entry\] \.panel-scroll > \*\s*\{[^}]*animation:\s*panel-rise\s/);
  });

  it("сама панель выезжает на медленной скорости с пружиной", () => {
    expect(css).toMatch(/\.panel\s*\{[^}]*animation:\s*panel-in var\(--move-slow\) var\(--ease-spring\)/);
  });
});
