import { describe, expect, it } from "vitest";
import { addChecked, defaultChecked } from "./scanAdd";
import type { FoundGame } from "../types";

const found = (key: string, title: string, extra: Partial<FoundGame> = {}): FoundGame => ({
  key,
  title,
  contentId: "ww",
  sourceKind: "steam",
  alreadyAdded: false,
  ...extra,
});

describe("defaultChecked", () => {
  it("отмечает игры с данными, которых ещё нет в списке", () => {
    const list = [
      found("steam:1", "A"),
      found("steam:2", "B", { contentId: null }),
      found("steam:3", "C", { alreadyAdded: true }),
    ];
    expect([...defaultChecked(list)]).toEqual(["steam:1"]);
  });

  it("из установок с одним названием отмечает только первую", () => {
    // Игра стоит и в Steam, и в Epic: в доке она нужна один раз, а вторую
    // установку человек отметит сам, если захочет.
    const list = [found("steam:1", "Same"), found("epic:same", "Same", { sourceKind: "epic" })];
    expect([...defaultChecked(list)]).toEqual(["steam:1"]);
  });
});

describe("addChecked", () => {
  it("добавляет отмеченные по ключу и пропускает уже добавленные", async () => {
    const list = [
      found("steam:1", "Same"),
      found("epic:same", "Same", { sourceKind: "epic" }),
      found("steam:3", "C", { alreadyAdded: true }),
      found("steam:4", "D"),
    ];
    const asked: string[] = [];
    const added: string[] = [];
    await addChecked(
      list,
      new Set(["steam:1", "epic:same", "steam:3"]),
      async (g) => void asked.push(g.key),
      (key) => added.push(key),
    );
    expect(asked).toEqual(["steam:1", "epic:same"]);
    expect(added).toEqual(["steam:1", "epic:same"]);
  });

  it("после провала на середине отмечает только удавшиеся, и повтор их пропускает", async () => {
    let list = [found("steam:1", "A"), found("steam:2", "B"), found("steam:3", "C")];
    const checked = new Set(list.map((g) => g.key));
    const markAdded = (key: string) => {
      list = list.map((g) => (g.key === key ? { ...g, alreadyAdded: true } : g));
    };

    const first: string[] = [];
    await expect(
      addChecked(
        list,
        checked,
        async (g) => {
          if (g.key === "steam:2") throw new Error("нет связи");
          first.push(g.key);
        },
        markAdded,
      ),
    ).rejects.toThrow("нет связи");
    expect(first).toEqual(["steam:1"]);

    const retry: string[] = [];
    await addChecked(list, checked, async (g) => void retry.push(g.key), markAdded);
    expect(retry).toEqual(["steam:2", "steam:3"]);
  });
});
