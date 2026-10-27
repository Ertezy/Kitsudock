import { describe, it, expect } from "vitest";
import { REFRESH_EVERY_MS, REFRESH_ON_SHOW_AFTER_MS, ONLINE_REFRESH_AFTER_MS, backgroundsKey, finishCheck, reachedServer, sameHub, startCheck, shouldRefreshOnShow, shouldRefreshOnOnline } from "./hubRefresh";
import type { HubData, HubGame } from "../types";

const hub = (updatedAt: number): HubData => ({
  version: 2,
  updatedAt,
  games: [],
  codes: [],
  banners: [],
  videos: [],
  _source: "remote",
});

const game = (id: string, background?: HubGame["background"]): HubGame => ({
  id,
  title: id,
  redeemUrl: null,
  ...(background ? { background } : {}),
});

describe("hubRefresh", () => {
  it("проверяет раз в три часа и при возвращении окна через час", () => {
    expect(REFRESH_EVERY_MS).toBe(10_800_000);
    expect(shouldRefreshOnShow(0, REFRESH_ON_SHOW_AFTER_MS - 1)).toBe(false);
    expect(shouldRefreshOnShow(0, REFRESH_ON_SHOW_AFTER_MS)).toBe(true);
  });

  it("при появлении сети после удачной проверки ждёт минуту", () => {
    expect(ONLINE_REFRESH_AFTER_MS).toBe(60_000);
    const ok = { at: 0, reachedServer: true };
    expect(shouldRefreshOnOnline(ok, 60_000)).toBe(false);
    expect(shouldRefreshOnOnline(ok, 60_001)).toBe(true);
  });

  it("при появлении сети после неудачной проверки проверяет сразу", () => {
    // Приложение стартовало без сети, и Wi-Fi подключился через полминуты:
    // ждать трёхчасового таймера незачем.
    const failed = { at: 0, reachedServer: false };
    expect(shouldRefreshOnOnline(failed, 1)).toBe(true);
    expect(shouldRefreshOnOnline(failed, 30_000)).toBe(true);
  });

  it("новая проверка до ответа не сбрасывает удачу прошлой", () => {
    // Таймер или возврат окна начали проверку при живой сети: появление сети
    // в это время второй запрос не запускает.
    const ok = finishCheck(startCheck({ at: 0, reachedServer: false }, 0), hub(1));
    const running = startCheck(ok, 3_600_000);
    expect(running).toEqual({ at: 3_600_000, reachedServer: true });
    expect(shouldRefreshOnOnline(running, 3_600_001)).toBe(false);
  });

  it("проверка, начатая после неудачной, при появлении сети повторяется", () => {
    const failed = finishCheck({ at: 0, reachedServer: true }, null);
    expect(failed.reachedServer).toBe(false);
    expect(shouldRefreshOnOnline(startCheck(failed, 10), 20)).toBe(true);
    const offline = finishCheck({ at: 0, reachedServer: true }, { ...hub(1), _source: "cache" });
    expect(offline.reachedServer).toBe(false);
  });

  it("до сервера дошли только данные из сети, а не из кеша или комплекта", () => {
    expect(reachedServer(hub(1))).toBe(true);
    for (const source of ["cache", "bundled", "override", undefined]) {
      expect(reachedServer({ ...hub(1), _source: source })).toBe(false);
    }
  });

  it("одинаковые данные не считаются новыми", () => {
    expect(sameHub(hub(1), hub(1))).toBe(true);
    expect(sameHub(hub(1), hub(2))).toBe(false);
    expect(sameHub(null, hub(1))).toBe(false);
    expect(sameHub(null, null)).toBe(true);
  });
});

describe("backgroundsKey", () => {
  const withGames = (games: HubGame[], rest: Partial<HubData> = {}): HubData => ({ ...hub(1), games, ...rest });

  it("меняется, когда сменилась картинка фона игры", () => {
    const a = withGames([game("genshin", { image: "a.png" })]);
    const b = withGames([game("genshin", { image: "b.png" })]);
    expect(backgroundsKey(a)).not.toBe(backgroundsKey(b));
  });

  it("меняется, когда сменилось или появилось видео фона", () => {
    const still = withGames([game("genshin", { image: "a.png" })]);
    const video = withGames([game("genshin", { image: "a.png", video: "a.mp4" })]);
    const other = withGames([game("genshin", { image: "a.png", video: "b.mp4" })]);
    expect(backgroundsKey(still)).not.toBe(backgroundsKey(video));
    expect(backgroundsKey(video)).not.toBe(backgroundsKey(other));
  });

  it("меняется, когда у игры появился фон", () => {
    const without = withGames([game("genshin")]);
    const withBg = withGames([game("genshin", { image: "a.png" })]);
    expect(backgroundsKey(without)).not.toBe(backgroundsKey(withBg));
  });

  it("не меняется от кодов, баннеров, видео и времени обновления", () => {
    const base = withGames([game("genshin", { image: "a.png" })]);
    const noisy = withGames([game("genshin", { image: "a.png" })], {
      updatedAt: 999,
      codes: [{ gameId: "genshin", code: "ABC", rewards: "", expiresAt: null, region: "", source: null }],
      banners: [{ gameId: "genshin", title: "b", featured: [], rarity: null, image: null, startsAt: 1, endsAt: 2, url: null }],
      videos: [{ gameId: "genshin", title: "t", url: "u", thumb: null, publishedAt: 1, duration: null, premiere: false }],
    });
    expect(backgroundsKey(noisy)).toBe(backgroundsKey(base));
  });

  it("пустой хаб и его отсутствие дают один и тот же ключ", () => {
    expect(backgroundsKey(null)).toBe(backgroundsKey(withGames([])));
  });
});
