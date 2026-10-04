import { afterEach, describe, expect, it } from "vitest";
import { dayMonth, plural, relativeDays } from "./format";
import { en } from "./en";
import { ru } from "./ru";
import { asLang, currentLang, currentT, dictionary, setLanguage, subscribeLanguage } from "./index";

/** Форма словаря: те же поля, функции на тех же местах. */
function shape(value: unknown): unknown {
  if (typeof value === "function") return "fn";
  if (typeof value === "string") return "str";
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, shape(v)] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return typeof value;
}

afterEach(() => setLanguage("en"));

describe("словари", () => {
  it("русский повторяет форму английского", () => {
    expect(shape(ru)).toEqual(shape(en));
  });

  it("dictionary и currentT отдают словарь нужного языка", () => {
    expect(dictionary("en")).toBe(en);
    expect(dictionary("ru")).toBe(ru);
    setLanguage("ru");
    expect(currentT()).toBe(ru);
  });
});

describe("склонения", () => {
  it("английский: one / other", () => {
    const f = { one: "day", other: "days" };
    expect([0, 1, 2, 21].map((n) => plural("en", n, f))).toEqual(["days", "day", "days", "days"]);
  });

  it("русский: one / few / many", () => {
    const f = { one: "день", few: "дня", many: "дней", other: "дня" };
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural("ru", n, f))).toEqual([
      "день", "дня", "дней", "дней", "день", "дня", "дней",
    ]);
  });
});

describe("относительные дни и даты", () => {
  it("английский", () => {
    expect([0, -1, -4, 2].map((d) => relativeDays("en", d))).toEqual(["today", "yesterday", "4 days ago", "in 2 days"]);
  });

  it("русский — как раньше писала панель", () => {
    expect([0, -1, -4, -11, 2].map((d) => relativeDays("ru", d))).toEqual([
      "сегодня", "вчера", "4 дня назад", "11 дней назад", "через 2 дня",
    ]);
  });

  it("день и месяц", () => {
    // Полдень по местному времени: в любом поясе это тот же календарный день.
    const noon = new Date(2026, 7, 28, 12).getTime() / 1000;
    expect(dayMonth("en", noon)).toBe("Aug 28");
    expect(dayMonth("ru", noon)).toBe("28 августа");
  });

  it("время вне календаря JS — прочерк, а не ошибка (иначе окно остаётся пустым)", () => {
    for (const sec of [NaN, Infinity, -Infinity, 8_640_000_000_001, -8_640_000_000_001, 9.2e18]) {
      expect(dayMonth("en", sec), String(sec)).toBe("—");
      expect(dayMonth("ru", sec), String(sec)).toBe("—");
    }
  });

  it("крайние даты, которые Date ещё знает, форматируются как обычно", () => {
    // Самый поздний момент `Date` — 13 сентября 275760 года, 00:00 UTC. Западнее
    // UTC там ещё 12-е: день зависит от пояса, а месяц — нет.
    expect(dayMonth("en", 8_640_000_000_000)).toMatch(/^Sep 1[23]$/);
    expect(dayMonth("en", 0)).not.toBe("—");
  });
});

describe("текущий язык", () => {
  it("по умолчанию английский, незнакомое значение — английский", () => {
    expect(currentLang()).toBe("en");
    expect(asLang("ru")).toBe("ru");
    expect(asLang("fr")).toBe("en");
    expect(asLang(undefined)).toBe("en");
  });

  it("смена оповещает подписчиков, отписка работает", () => {
    const seen: string[] = [];
    const stop = subscribeLanguage((lang) => seen.push(lang));
    setLanguage("ru");
    stop();
    setLanguage("en");
    expect(seen).toEqual(["ru"]);
  });
});
