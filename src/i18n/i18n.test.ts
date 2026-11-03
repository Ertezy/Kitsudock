import { afterEach, describe, expect, it } from "vitest";
import { dayMonth, plural, relativeDays } from "./format";
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import { ru } from "./ru";
import { zh } from "./zh";
import { asLang, currentLang, currentT, dictionary, setLanguage, subscribeLanguage, systemLang } from "./index";
import { LANGS } from "./native";

const ALL = { en, ru, zh, ja, ko };

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
  it("каждый словарь повторяет форму английского", () => {
    for (const dict of [ru, zh, ja, ko]) expect(shape(dict)).toEqual(shape(en));
  });

  it("словарь есть у каждого языка из списка", () => {
    for (const lang of LANGS) expect(dictionary(lang)).toBe(ALL[lang]);
  });

  it("тексты прямые: без «Упс», восклицаний и «что-то пошло не так»", () => {
    const texts = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (typeof value === "function") return [String(value(1, 2))];
      if (value !== null && typeof value === "object") return Object.values(value).flatMap(texts);
      return [];
    };
    for (const dict of Object.values(ALL)) {
      const all = texts(dict);
      expect(all.length).toBeGreaterThan(100);
      for (const text of all) expect(text, text).not.toMatch(/!|！|Упс|Oops|Что-то пошло не так|Something went wrong/i);
    }
  });

  it("пустая панель обещает только то, что правда", () => {
    // Когда выйдут новые коды, не знает никто: «сами, когда выйдут», без «как только».
    expect(ru.panel.emptyQuietHint).toBe("Новые появятся здесь сами, когда выйдут.");
    expect(en.panel.emptyQuietHint).toBe("New ones will show up here on their own once they're out.");
    // Крестик по умолчанию прячет окно в трей, и «перезапуск» им список не
    // перечитывает. Возврат из настроек перечитывает (`closeSettings` → `load`, App.tsx).
    expect(ru.panel.listFailedHint).toBe("Откройте настройки и вернитесь назад, чтобы загрузить список снова.");
    expect(en.panel.listFailedHint).toBe("Open Settings and come back to load the list again.");
  });

  it("строка «Вышла версия» говорит, что происходит на самом деле", () => {
    // «Обновить» ставит новую версию сама, «Скачать» только открывает
    // страницу релиза. Пока идёт работа, главное, что видно, — загрузка:
    // установщик показывает свою полосу хода уже после неё.
    expect(ru.panel.updateAvailable("0.2.0")).toBe("Вышла версия 0.2.0");
    expect(en.panel.updateAvailable("0.2.0")).toBe("Version 0.2.0 is out");
    expect(ru.panel.update).toBe("Обновить");
    expect(en.panel.update).toBe("Update");
    expect(ru.panel.updating).toBe("Скачиваю обновление…");
    expect(en.panel.updating).toBe("Downloading the update…");
    expect(ru.panel.updateFailed).toBe("Не удалось обновить");
    expect(en.panel.updateFailed).toBe("Couldn't update");
    expect(ru.panel.download).toBe("Скачать");
    expect(en.panel.download).toBe("Download");
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

  it("китайский, японский, корейский: сегодня, вчера, завтра", () => {
    expect([0, -1, 1, 3].map((d) => relativeDays("zh", d))).toEqual(["今天", "昨天", "明天", "3天后"]);
    expect([0, -1, 1].map((d) => relativeDays("ja", d))).toEqual(["今日", "昨日", "明日"]);
    expect([0, -1, 1].map((d) => relativeDays("ko", d))).toEqual(["오늘", "어제", "내일"]);
  });

  it("день и месяц", () => {
    // Полдень по местному времени: в любом поясе это тот же календарный день.
    const noon = new Date(2026, 7, 28, 12).getTime() / 1000;
    expect(dayMonth("en", noon)).toBe("Aug 28");
    expect(dayMonth("ru", noon)).toBe("28 августа");
    expect(dayMonth("zh", noon)).toBe("8月28日");
    expect(dayMonth("ja", noon)).toBe("8月28日");
    expect(dayMonth("ko", noon)).toBe("8월 28일");
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
    expect(asLang("ko")).toBe("ko");
    expect(asLang("fr")).toBe("en");
    expect(asLang(undefined)).toBe("en");
  });

  it("язык системы: свой, если он у нас есть, иначе английский", () => {
    expect(systemLang("ru-RU")).toBe("ru");
    expect(systemLang("zh-CN")).toBe("zh");
    expect(systemLang("zh-TW")).toBe("zh");
    expect(systemLang("ja")).toBe("ja");
    expect(systemLang("ko-KR")).toBe("ko");
    expect(systemLang("de-DE")).toBe("en");
    expect(systemLang(undefined)).toBe("en");
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
