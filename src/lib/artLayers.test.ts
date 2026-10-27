import { describe, expect, it } from "vitest";
import rawCss from "../styles.css?raw";
import { ENTER, isOwnEnter, isShown, markReady, pushLayer, settleAll, settleLayer, type ArtEntry } from "./artLayers";

const entry = (id: number, key: string, ready = false): ArtEntry<string> => ({ id, key, layer: key, ready });
const ids = (stack: ArtEntry<string>[]) => stack.map((e) => `${e.id}${e.ready ? "+" : "-"}`);

describe("pushLayer", () => {
  it("первый фон ложится в пустую стопку", () => {
    expect(ids(pushLayer([], entry(1, "a"), false))).toEqual(["1-"]);
  });

  it("тот же фон ещё раз не добавляется, стопка та же самая", () => {
    const stack = [entry(1, "a", true)];
    expect(pushLayer(stack, entry(2, "a"), false)).toBe(stack);
  });

  it("новый фон ложится поверх показанного, а показанный остаётся под ним до загрузки нового", () => {
    expect(ids(pushLayer([entry(1, "a", true)], entry(2, "b"), false))).toEqual(["1+", "2-"]);
  });

  it("фон, который так и не загрузился, уходит сразу, как только выбрали следующий", () => {
    const stack = [entry(1, "a", true), entry(2, "b")];
    expect(ids(pushLayer(stack, entry(3, "c"), false))).toEqual(["1+", "3-"]);
  });

  it("возврат к показанному фону из-под незагрузившегося не кладёт его второй раз", () => {
    const stack = [entry(1, "a", true), entry(2, "b")];
    expect(ids(pushLayer(stack, entry(3, "a"), false))).toEqual(["1+"]);
  });

  it("возврат к фону под ещё проявляющимся кладёт его заново поверх: проявляющийся уже виден", () => {
    const stack = [entry(1, "a", true), entry(2, "b", true)];
    expect(ids(pushLayer(stack, entry(3, "a"), false))).toEqual(["1+", "2+", "3-"]);
  });

  it("готовый сразу слой (заливка) при выключенной анимации сразу убирает всё под собой", () => {
    const stack = [entry(1, "a", true)];
    expect(ids(pushLayer(stack, entry(2, "fill", true), true))).toEqual(["2+"]);
    expect(ids(pushLayer(stack, entry(2, "fill", true), false))).toEqual(["1+", "2+"]);
  });

  it("неготовый слой при выключенной анимации старый фон не убирает: его некем заменить", () => {
    expect(ids(pushLayer([entry(1, "a", true)], entry(2, "b"), true))).toEqual(["1+", "2-"]);
  });
});

describe("markReady", () => {
  it("загрузившийся слой становится готовым, прежний под ним остаётся на время перетекания", () => {
    expect(ids(markReady([entry(1, "a", true), entry(2, "b")], 2, false))).toEqual(["1+", "2+"]);
  });

  it("при выключенной анимации готовый слой сразу убирает всё под собой", () => {
    expect(ids(markReady([entry(1, "a", true), entry(2, "b")], 2, true))).toEqual(["2+"]);
  });

  it("неизвестный слой (уже убранный) ничего не меняет", () => {
    const stack = [entry(1, "a", true)];
    expect(markReady(stack, 7, false)).toBe(stack);
  });

  it("повторная готовность того же слоя ничего не меняет", () => {
    const stack = [entry(1, "a", true)];
    expect(markReady(stack, 1, false)).toBe(stack);
  });
});

describe("settleLayer", () => {
  it("проявившийся слой убирает всё, что под ним", () => {
    const stack = [entry(1, "a", true), entry(2, "b", true), entry(3, "c", true)];
    expect(ids(settleLayer(stack, 2))).toEqual(["2+", "3+"]);
  });

  it("неготовый, нижний и неизвестный слой стопку не меняют", () => {
    const stack = [entry(1, "a", true), entry(2, "b")];
    expect(settleLayer(stack, 2)).toBe(stack);
    expect(settleLayer(stack, 1)).toBe(stack);
    expect(settleLayer(stack, 9)).toBe(stack);
  });
});

describe("isShown", () => {
  it("пустая стопка — фона ещё нет", () => {
    expect(isShown([], "a")).toBe(false);
  });

  it("выбрали другую игру, а слой под неё ещё не лёг — её фона на экране нет", () => {
    expect(isShown([entry(1, "a", true)], "b")).toBe(false);
  });

  it("слой лёг, но ещё грузится — фона нет", () => {
    expect(isShown([entry(1, "a", true), entry(2, "b")], "b")).toBe(false);
  });

  it("слой загрузился и проявляется — фон есть, даже пока прежний лежит под ним", () => {
    expect(isShown([entry(1, "a", true), entry(2, "b", true)], "b")).toBe(true);
  });

  it("заливка готова сразу, как только легла", () => {
    expect(isShown(pushLayer([entry(1, "a", true)], entry(2, "fill", true), false), "fill")).toBe(true);
  });

  it("возврат к фону, который ещё на экране, — фон есть сразу", () => {
    const back = pushLayer([entry(1, "a", true), entry(2, "b")], entry(3, "a"), false);
    expect(isShown(back, "a")).toBe(true);
  });
});

describe("isOwnEnter", () => {
  const own = {};
  const inner = {};

  it("проявление самого слоя — его событие", () => {
    expect(isOwnEnter({ target: own, currentTarget: own, animationName: ENTER })).toBe(true);
  });

  it("всплывший дрейф картинки внутри слоя — не его", () => {
    expect(isOwnEnter({ target: inner, currentTarget: own, animationName: "art-drift" })).toBe(false);
    expect(isOwnEnter({ target: inner, currentTarget: own, animationName: ENTER })).toBe(false);
  });

  it("другая анимация на самом слое — не проявление", () => {
    expect(isOwnEnter({ target: own, currentTarget: own, animationName: "art-drift" })).toBe(false);
  });

  it("анимация, которой ждёт стопка, есть в стилях и висит на проявляющемся слое", () => {
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toContain(`@keyframes ${ENTER} {`);
    expect(css).toMatch(new RegExp(`\\.art-layer\\.is-in\\s*\\{[^}]*animation:\\s*${ENTER}\\s`));
  });
});

describe("settleAll", () => {
  it("остаётся верхний показанный слой и ещё не загрузившийся над ним", () => {
    const stack = [entry(1, "a", true), entry(2, "b", true), entry(3, "c")];
    expect(ids(settleAll(stack))).toEqual(["2+", "3-"]);
  });

  it("нечего убирать — стопка та же самая", () => {
    const one = [entry(1, "a", true)];
    expect(settleAll(one)).toBe(one);
    const pending = [entry(1, "a")];
    expect(settleAll(pending)).toBe(pending);
    expect(settleAll([])).toEqual([]);
  });
});
