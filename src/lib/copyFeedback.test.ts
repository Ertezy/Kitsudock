import { describe, it, expect } from "vitest";
import { COPY_FAILED_MS, COPY_FEEDBACK_MS, copyAnnouncement, copyFeedbackOver, feedbackMs, isCopied, isCopyFailed, type Copied } from "./copyFeedback";

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

describe("объявление копирования", () => {
  const text = "Code EMBERGLOW26 copied";

  it("повторное копирование того же кода меняет текст строки состояния — диктор объявит его снова", () => {
    for (const id of [1, 2, 3, 10]) expect(copyAnnouncement(text, id + 1)).not.toBe(copyAnnouncement(text, id));
  });

  it("на слух текст тот же: отличие — только неразрывный пробел в конце", () => {
    for (const id of [1, 2, 3, 4]) {
      const said = copyAnnouncement(text, id);
      expect(said.trim()).toBe(text);
      expect(["", String.fromCharCode(0xa0)]).toContain(said.slice(text.length));
    }
  });

  it("у первого копирования текст ровно из словаря", () => {
    expect(copyAnnouncement(text, 1)).toBe(text);
  });
});

describe("копирование не удалось", () => {
  it("ошибка держится дольше галочки: её надо успеть прочитать", () => {
    expect(COPY_FAILED_MS).toBeGreaterThan(COPY_FEEDBACK_MS);
    expect(feedbackMs({ code: "A", id: 1 })).toBe(COPY_FEEDBACK_MS);
    expect(feedbackMs({ code: "A", id: 1, failed: true })).toBe(COPY_FAILED_MS);
  });

  it("неудача отмечает свою карточку ошибкой, а не галочкой", () => {
    const state: Copied = { code: "A", id: 1, failed: true };
    expect(isCopyFailed(state, "A")).toBe(true);
    expect(isCopied(state, "A")).toBe(false);
    expect(isCopyFailed(state, "B")).toBe(false);
    expect(isCopyFailed({ code: "A", id: 1 }, "A")).toBe(false);
    expect(isCopyFailed(null, "A")).toBe(false);
  });

  it("удачное копирование после неудачного снимает ошибку, срок неудачи его не трогает", () => {
    const ok: Copied = { code: "A", id: 2 };
    expect(isCopyFailed(ok, "A")).toBe(false);
    expect(copyFeedbackOver(ok, 1)).toBe(ok);
  });
});
