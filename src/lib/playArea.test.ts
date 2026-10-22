import { describe, expect, it } from "vitest";
import rawCss from "../styles.css?raw";
import { ART_WAIT_MS, playAreaWaiting } from "./playArea";

describe("playAreaWaiting", () => {
  it("с анимацией подпись и кнопка ждут, пока фон их игры не начал проявляться", () => {
    expect(playAreaWaiting(true, false, false)).toBe(true);
  });

  it("фон пошёл — ждать нечего", () => {
    expect(playAreaWaiting(true, true, false)).toBe(false);
  });

  it("фон так и не пошёл за отведённое время — кнопка всё равно показывается", () => {
    expect(playAreaWaiting(true, false, true)).toBe(false);
  });

  it("без анимации не ждут никогда: подниматься вслед за фоном нечему", () => {
    expect(playAreaWaiting(false, false, false)).toBe(false);
    expect(playAreaWaiting(false, true, false)).toBe(false);
    expect(playAreaWaiting(false, false, true)).toBe(false);
  });
});

describe("ART_WAIT_MS", () => {
  it("кнопка ждёт фон меньше, чем длится само перетекание фона", () => {
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const move = /--move:\s*([\d.]+)s;/.exec(css);
    const scene = /--move-scene:\s*calc\(var\(--move\)\s*\*\s*([\d.]+)\);/.exec(css);
    expect(move, "--move в :root").not.toBeNull();
    expect(scene, "--move-scene от --move").not.toBeNull();
    const sceneMs = Number(move![1]) * Number(scene![1]) * 1000;
    expect(ART_WAIT_MS).toBeGreaterThan(0);
    expect(ART_WAIT_MS).toBeLessThan(sceneMs);
  });
});

describe("стили ожидания", () => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const gated = [...css.matchAll(/([^{}]*)\{[^{}]*visibility:\s*hidden[^{}]*\}/g)]
    .map((m) => m[1].trim())
    .filter((s) => s.includes("is-waiting"));

  it("ждут только подпись и кнопка", () => {
    expect(gated.length).toBeGreaterThan(0);
    const targets = gated.flatMap((s) => s.split(",").map((part) => part.trim()));
    expect(targets.sort()).toEqual([".play-area.is-waiting > .play", ".play-area.is-waiting > .play-note"]);
  });

  it("ошибка запуска и выходы из неё не ждут: это ответ на действие", () => {
    for (const s of gated) {
      expect(s).not.toMatch(/play-error|play-fix|>\s*\*/);
    }
  });
});
