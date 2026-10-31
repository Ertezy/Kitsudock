import { describe, expect, it } from "vitest";
import { launchNote, wayChoices, wayLabel, type WayGame } from "./launch";
import { en } from "../i18n/en";
import { ru } from "../i18n/ru";

/** Игра со способами запуска: по умолчанию — из Epic, запуск через магазин. */
function game(over: Partial<WayGame> = {}): WayGame {
  return { sourceKind: "epic", missing: false, ways: ["store"], way: "store", launcher: null, ...over };
}

describe("подпись над кнопкой запуска", () => {
  it("английский", () => {
    expect(launchNote(en, game({ sourceKind: "steam" }))).toBe("Launches via Steam");
    expect(launchNote(en, game())).toBe("Launches via Epic Games");
    expect(launchNote(en, game({ sourceKind: "exe", way: "direct", missing: true }))).toBe("Launches directly · game file not found");
  });

  it("русский — «напрямую» без «через»", () => {
    expect(launchNote(ru, game({ sourceKind: "steam" }))).toBe("Запустится через Steam");
    expect(launchNote(ru, game({ sourceKind: "exe", way: "direct" }))).toBe("Запустится напрямую");
    expect(launchNote(ru, game({ missing: true }))).toBe("Запустится через Epic Games · файл не найден");
  });

  it("следует за выбором: напрямую у игры из магазина и через лаунчер", () => {
    expect(launchNote(ru, game({ way: "direct" }))).toBe("Запустится напрямую");
    expect(launchNote(ru, game({ way: "launcher", launcher: "hoyoplay" }))).toBe("Запустится через HoYoPlay");
    expect(launchNote(ru, game({ way: "launcher", launcher: "kuro" }))).toBe("Запустится через лаунчер Kuro");
    expect(launchNote(en, game({ way: "launcher", launcher: "gryphlink" }))).toBe("Launches via GRYPHLINK");
    expect(launchNote(en, game({ way: "launcher", launcher: "kuro" }))).toBe("Launches via the Kuro launcher");
  });
});

describe("способы запуска на выбор", () => {
  it("один способ или ни одного — выбирать не из чего", () => {
    expect(wayChoices(ru, game())).toEqual([]);
    expect(wayChoices(ru, game({ ways: [], way: "direct", sourceKind: "exe" }))).toEqual([]);
  });

  it("каждый способ подписан, выбранный отмечен, порядок — как пришёл", () => {
    const choices = wayChoices(ru, game({ ways: ["direct", "launcher", "store"], way: "launcher", launcher: "hoyoplay" }));
    expect(choices.map((c) => [c.way, c.label, c.selected])).toEqual([
      ["direct", "Напрямую", false],
      ["launcher", "Через HoYoPlay", true],
      ["store", "Через Epic Games", false],
    ]);
  });

  it("у игры из магазина «напрямую» честно предупреждает, у прочих — нет", () => {
    const [direct, store] = wayChoices(ru, game({ sourceKind: "steam", ways: ["direct", "store"] }));
    expect(direct.hint).toBe("Может не запуститься: игре бывает нужен запуск через Steam");
    expect(store.hint).toBeNull();
    const [epicDirect] = wayChoices(en, game({ ways: ["direct", "store"] }));
    expect(epicDirect.hint).toBe("May not start: the game may need to be launched through Epic Games");

    const own = wayChoices(ru, game({ sourceKind: "exe", ways: ["direct", "launcher"], way: "direct", launcher: "kuro" }));
    expect(own.map((c) => c.hint)).toEqual([null, null]);
  });

  it("подпись способа для язычка", () => {
    const g = game({ ways: ["direct", "launcher", "store"], launcher: "gryphlink" });
    expect(wayLabel(en, g, "direct")).toBe("Directly");
    expect(wayLabel(en, g, "launcher")).toBe("Via GRYPHLINK");
    expect(wayLabel(en, g, "store")).toBe("Via Epic Games");
    expect(wayLabel(ru, game({ sourceKind: "steam" }), "store")).toBe("Через Steam");
  });
});
