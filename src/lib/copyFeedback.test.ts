import { describe, it, expect } from "vitest";
import { COPY_FEEDBACK_MS, copyFeedbackOver, isCopied, type Copied } from "./copyFeedback";

describe("отклик копирования", () => {
  it("галочка держится полторы секунды, как раньше", () => {
    expect(COPY_FEEDBACK_MS).toBe(1500);
  });

  it("скопированный код отмечен, соседний — нет", () => {
    const state: Copied = { code: "EMBERGLOW26", id: 1 };
    expect(isCopied(state, "EMBERGLOW26")).toBe(true);
    expect(isCopied(state, "LANTERNFEST")).toBe(false);
    expect(isCopied(null, "EMBERGLOW26")).toBe(false);
  });

  it("срок своего копирования снимает галочку", () => {
    expect(copyFeedbackOver({ code: "A", id: 1 }, 1)).toBeNull();
  });

  it("повторное копирование того же кода продлевает галочку: прежний срок её не снимает", () => {
    const again: Copied = { code: "A", id: 2 };
    expect(copyFeedbackOver(again, 1)).toBe(again);
    expect(copyFeedbackOver(again, 2)).toBeNull();
  });

  it("копирование другого кода переносит галочку, срок прежнего её не трогает", () => {
    const other: Copied = { code: "B", id: 2 };
    expect(isCopied(other, "A")).toBe(false);
    expect(copyFeedbackOver(other, 1)).toBe(other);
  });

  it("срок без галочки — по-прежнему ничего", () => {
    expect(copyFeedbackOver(null, 1)).toBeNull();
  });
});
