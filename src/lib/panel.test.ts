import { describe, it, expect } from "vitest";
import { activeCodes, bannerKeys, codesFor, dataStatus, MAX_SHOWN_BANNERS, panelIsEmpty, plainSpaces, runningBanners, shownBanners, videosFor } from "./panel";
import { en } from "../i18n/en";
import { ru } from "../i18n/ru";
import type { Banner, Code, HubData, Video } from "../types";

const NOW = 1788091200;

const code = (expiresAt: number | null, name = "C"): Code => ({
  gameId: "g",
  code: name,
  rewards: "",
  expiresAt,
  region: "",
  source: null,
});

const banner = (startsAt: number, endsAt: number): Banner => ({
  gameId: "g",
  title: "B",
  featured: [],
  rarity: null,
  image: null,
  startsAt,
  endsAt,
  url: null,
});

const video: Video = {
  gameId: "g",
  title: "V",
  url: "https://example.test",
  thumb: null,
  publishedAt: NOW - 100,
  duration: null,
  premiere: false,
};

const hub = (source: string, codes: Code[] = []): HubData => ({
  version: 1,
  updatedAt: NOW - 60,
  games: [],
  codes,
  banners: [],
  videos: [],
  _source: source,
});

describe("activeCodes", () => {
  it("убирает сгоревшие и ставит бессрочные в конец", () => {
    const list = [code(null, "forever"), code(NOW - 1, "burnt"), code(NOW + 50, "soon")];
    expect(activeCodes(list, NOW).map((c) => c.code)).toEqual(["soon", "forever"]);
  });
});

describe("runningBanners", () => {
  it("оставляет только идущие сейчас", () => {
    const list = [banner(NOW - 10, NOW + 10), banner(NOW + 5, NOW + 10), banner(NOW - 10, NOW)];
    expect(runningBanners(list, NOW)).toHaveLength(1);
  });
});

describe("panelIsEmpty", () => {
  it("пусто, когда коды сгорели, баннеры кончились и видео нет", () => {
    expect(panelIsEmpty([code(NOW - 1)], [banner(NOW - 10, NOW)], [], NOW)).toBe(true);
  });
  it("не пусто, когда есть видео", () => {
    expect(panelIsEmpty([], [], [video], NOW)).toBe(false);
  });
  it("не пусто, когда идёт баннер", () => {
    expect(panelIsEmpty([], [banner(NOW - 10, NOW + 10)], [], NOW)).toBe(false);
  });
});

describe("dataStatus", () => {
  it("без данных говорит, что они появятся с сервисом", () => {
    expect(dataStatus(null, NOW, "ru")).toBe(ru.panel.noDataYet);
  });
  it("данные из комплекта — то же самое", () => {
    expect(dataStatus(hub("bundled", [code(null)]), NOW, "ru")).toBe(ru.panel.noDataYet);
  });
  it("пустые данные из сети — то же самое", () => {
    expect(dataStatus(hub("remote"), NOW, "ru")).toBe(ru.panel.noDataYet);
  });
  it("живые данные называют источник и свежесть", () => {
    expect(dataStatus(hub("remote", [code(null)]), NOW, "ru")).toBe("Источник — из сети, данные свежие.");
  });
  it("то же по-английски", () => {
    expect(dataStatus(null, NOW, "en")).toBe(en.panel.noDataYet);
    expect(dataStatus(hub("remote", [code(null)]), NOW, "en")).toBe("Source: online, data is fresh.");
  });
});

describe("видео по языку", () => {
  const v = (id: string, gameId: string, lang?: string) =>
    ({ gameId, lang, title: id, url: `https://www.youtube.com/watch?v=${id}`, thumb: null, publishedAt: 1, duration: null, premiere: false });

  it("видео выбранного языка", () => {
    const all = [v("a", "hsr", "en"), v("b", "hsr", "ja"), v("c", "zzz", "ja")];
    expect(videosFor(all, "hsr", "ja").map((x) => x.title)).toEqual(["b"]);
    expect(videosFor(all, "hsr", "en").map((x) => x.title)).toEqual(["a"]);
  });

  it("нет видео на языке — английские этой игры", () => {
    const all = [v("a", "hsr", "en"), v("c", "zzz", "ja")];
    expect(videosFor(all, "hsr", "ja").map((x) => x.title)).toEqual(["a"]);
  });

  it("видео без lang — английское", () => {
    const all = [v("old", "hsr")];
    expect(videosFor(all, "hsr", "en").map((x) => x.title)).toEqual(["old"]);
    expect(videosFor(all, "hsr", "ja").map((x) => x.title)).toEqual(["old"]);
  });

  it("нет ни выбранного языка, ни английских — идут любые видео игры", () => {
    const all = [v("a", "hsr", "ja"), v("b", "zzz", "en")];
    expect(videosFor(all, "hsr", "en").map((x) => x.title)).toEqual(["a"]);
  });
});

describe("коды выбранной игры", () => {
  const c = (gameId: string, name: string): Code => ({ ...code(null, name), gameId });

  it("возвращаются только коды выбранной игры", () => {
    const all = [c("hsr", "A"), c("zzz", "B"), c("hsr", "C")];
    expect(codesFor(all, "hsr").map((x) => x.code)).toEqual(["A", "C"]);
    expect(codesFor(all, "zzz").map((x) => x.code)).toEqual(["B"]);
    expect(codesFor(all, "gi")).toEqual([]);
  });

  it("без выбранной игры — пустой список", () => {
    expect(codesFor([c("hsr", "A")], null)).toEqual([]);
  });
});

describe("баннеры в карусели", () => {
  const b = (title: string, startsAt: number, endsAt: number) =>
    ({ gameId: "hsr", title, featured: [], rarity: 5, image: null, startsAt, endsAt, url: null });

  it("сначала идущие — ближайшие к концу, потом будущие — ближайшие к началу; кончившихся нет", () => {
    const now = 1000;
    const list = [b("late-end", 0, 5000), b("soon-end", 500, 2000), b("far", 4000, 9000), b("near", 1500, 9000), b("over", 0, 900)];
    expect(shownBanners(list, now).map((x) => x.title)).toEqual(["soon-end", "late-end", "near", "far"]);
  });

  it("в карусель попадает не больше двенадцати баннеров игры", () => {
    expect(MAX_SHOWN_BANNERS).toBe(12);
    const now = 1000;
    // Пятнадцать идущих: у «b0» срок короче всех, у «b14» — длиннее всех.
    const list = Array.from({ length: 15 }, (_, i) => b(`b${i}`, 0, 2000 + i));
    const shown = shownBanners(list, now);
    expect(shown).toHaveLength(MAX_SHOWN_BANNERS);
    // Хвост отбрасывается после обычного порядка, а не до него.
    expect(shown.map((x) => x.title)).toEqual(list.slice(0, 12).map((x) => x.title));
  });

  it("при переполнении будущие баннеры уступают идущим, а не наоборот", () => {
    const now = 1000;
    const running = Array.from({ length: 10 }, (_, i) => b(`run${i}`, 0, 2000 + i));
    const upcoming = Array.from({ length: 5 }, (_, i) => b(`next${i}`, 2000 + i, 9000));
    expect(shownBanners([...upcoming, ...running], now).map((x) => x.title)).toEqual([
      ...running.map((x) => x.title),
      "next0",
      "next1",
    ]);
  });

  it("ровно двенадцать баннеров остаются все", () => {
    const list = Array.from({ length: 12 }, (_, i) => b(`b${i}`, 0, 2000 + i));
    expect(shownBanners(list, 1000)).toHaveLength(12);
  });

  it("одни будущие баннеры — панель не пуста", () => {
    expect(panelIsEmpty([], [b("next", 2000, 3000)], [], 1000)).toBe(false);
  });

  it("метка будущего баннера на обоих языках", () => {
    expect(en.panel.soonIn("3 days")).toBe("Soon · in 3 days");
    expect(ru.panel.soonIn("3 дня")).toBe("Скоро · через 3 дня");
  });
});

describe("bannerKeys", () => {
  const b = (title: string, startsAt: number, endsAt: number) =>
    ({ gameId: "hsr", title, featured: [], rarity: 5, image: null, startsAt, endsAt, url: null });

  it("два баннера одной игры с общим стартом получают разные ключи", () => {
    const list = [b("A", 100, 200), b("B", 100, 300)];
    const keys = bannerKeys(list);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("точные повторы (тот же заголовок тоже) тоже расходятся", () => {
    const list = [b("A", 100, 200), b("A", 100, 200)];
    const keys = bannerKeys(list);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("тот же список — те же ключи", () => {
    const list = [b("A", 100, 200), b("A", 100, 200), b("B", 500, 600)];
    expect(bannerKeys(list)).toEqual(bannerKeys(list));
  });
});

describe("plainSpaces", () => {
  it("неразрывный пробел U+00A0 становится обычным", () => {
    expect(plainSpaces("a\u00A0b")).toBe("a b");
  });

  it("цифровой пробел U+2007 становится обычным", () => {
    expect(plainSpaces("a\u2007b")).toBe("a b");
  });

  it("узкий неразрывный пробел U+202F становится обычным", () => {
    expect(plainSpaces("a\u202Fb")).toBe("a b");
  });

  it("настоящий заголовок из данных разбивается на слова", () => {
    const title = "6th\u00A0Anniversary\u00A0Theme\u00A0Song:\u00A0\"A\u00A0Letter\u00A0From\u00A0the\u00A0Wind\"\u00A0|\u00A0Genshin\u00A0Impact\u00A0#GenshinImpact";
    expect(plainSpaces(title)).toBe("6th Anniversary Theme Song: \"A Letter From the Wind\" | Genshin Impact #GenshinImpact");
  });

  it("обычный текст не меняется", () => {
    expect(plainSpaces("Genshin Impact — 5★ banner, тест")).toBe("Genshin Impact — 5★ banner, тест");
    expect(plainSpaces("")).toBe("");
  });
});
