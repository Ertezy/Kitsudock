import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTHING_COLLAPSED, asCollapsed, collapse, isCollapsed, setCollapsedAll, subscribeCollapsed } from "./collapse";

afterEach(() => setCollapsedAll(NOTHING_COLLAPSED));

describe("asCollapsed", () => {
  it("ответ моста читается как есть", () => {
    expect(asCollapsed({ codes: true, banners: false, videos: true, socials: true })).toEqual({
      codes: true,
      banners: false,
      videos: true,
      socials: true,
    });
  });

  it("недостающее или чужое — развёрнуто, а не ошибка", () => {
    expect(asCollapsed({ banners: true })).toEqual({ ...NOTHING_COLLAPSED, banners: true });
    expect(asCollapsed({ codes: "yes", videos: 1 })).toEqual(NOTHING_COLLAPSED);
    expect(asCollapsed(null)).toEqual(NOTHING_COLLAPSED);
    expect(asCollapsed("all")).toEqual(NOTHING_COLLAPSED);
    expect(asCollapsed(undefined)).toEqual(NOTHING_COLLAPSED);
  });

  it("по умолчанию развёрнуто всё", () => {
    expect(Object.values(NOTHING_COLLAPSED)).toEqual([false, false, false, false]);
  });
});

describe("collapse", () => {
  it("меняет одно поле, сообщает подписчикам и сохраняет только его", async () => {
    const save = vi.fn(() => Promise.resolve());
    const heard: boolean[] = [];
    const stop = subscribeCollapsed((all) => heard.push(all.banners));
    collapse("banners", true, save);
    stop();
    expect(isCollapsed("banners")).toBe(true);
    expect(isCollapsed("codes")).toBe(false);
    expect(heard).toEqual([true]);
    expect(save).toHaveBeenCalledWith("banners", true);
  });

  it("то же значение — ни подписчиков, ни записи", () => {
    const save = vi.fn(() => Promise.resolve());
    const listener = vi.fn();
    const stop = subscribeCollapsed(listener);
    collapse("videos", false, save);
    stop();
    expect(listener).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("не сохранилось — на экране остаётся выбранное, ошибка не всплывает", async () => {
    const save = vi.fn(() => Promise.reject(new Error("disk full")));
    collapse("socials", true, save);
    await Promise.resolve();
    expect(isCollapsed("socials")).toBe(true);
  });

  it("отписка действует", () => {
    const listener = vi.fn();
    const stop = subscribeCollapsed(listener);
    stop();
    collapse("codes", true, () => Promise.resolve());
    expect(listener).not.toHaveBeenCalled();
  });
});
