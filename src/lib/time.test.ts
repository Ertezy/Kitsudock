import { describe, it, expect } from "vitest";
import { timeLeft, timeAgo, burnsToday, progress, hubFreshness } from "./time";

const HOUR = 3600;
const DAY = 86400;
const NOW = 1788091200; // 30 августа 2026, 12:00 UTC

describe("timeLeft", () => {
  it("часы и минуты, когда меньше суток", () => {
    expect(timeLeft(NOW + 3 * HOUR + 52 * 60, NOW, "ru")).toBe("3 ч 52 мин");
  });
  it("только минуты, когда меньше часа", () => {
    expect(timeLeft(NOW + 7 * 60, NOW, "ru")).toBe("7 мин");
  });
  it("дни, когда больше суток", () => {
    expect(timeLeft(NOW + 9 * DAY, NOW, "ru")).toBe("9 дней");
  });
  it("один день склоняется верно", () => {
    expect(timeLeft(NOW + 1 * DAY + HOUR, NOW, "ru")).toBe("1 день");
  });
  it("двадцать один день склоняется верно", () => {
    expect(timeLeft(NOW + 21 * DAY, NOW, "ru")).toBe("21 день");
  });
  it("истёкшее время", () => {
    expect(timeLeft(NOW - HOUR, NOW, "ru")).toBe("истёк");
  });
});

describe("timeAgo", () => {
  it("сегодня", () => expect(timeAgo(NOW - HOUR, NOW, "ru")).toBe("сегодня"));
  it("вчера", () => expect(timeAgo(NOW - 1 * DAY, NOW, "ru")).toBe("вчера"));
  it("несколько дней", () => expect(timeAgo(NOW - 4 * DAY, NOW, "ru")).toBe("4 дня назад"));
  it("одиннадцать дней", () => expect(timeAgo(NOW - 11 * DAY, NOW, "ru")).toBe("11 дней назад"));
  it("будущее — премьера", () => expect(timeAgo(NOW + 2 * DAY, NOW, "ru")).toBe("через 2 дня"));
});

describe("время по-английски", () => {
  const now = 1_000_000;
  it("остаток", () => {
    expect(timeLeft(now - 1, now, "en")).toBe("expired");
    expect(timeLeft(now + 7 * 60, now, "en")).toBe("7 min");
    expect(timeLeft(now + 3 * 3600 + 52 * 60, now, "en")).toBe("3 h 52 min");
    expect(timeLeft(now + 86400, now, "en")).toBe("1 day");
    expect(timeLeft(now + 9 * 86400, now, "en")).toBe("9 days");
  });
  it("давность", () => {
    expect(timeAgo(now, now, "en")).toBe("today");
    expect(timeAgo(now - 86400, now, "en")).toBe("yesterday");
    expect(timeAgo(now - 4 * 86400, now, "en")).toBe("4 days ago");
    expect(timeAgo(now + 2 * 86400, now, "en")).toBe("in 2 days");
  });
  it("свежесть данных", () => {
    expect(hubFreshness(now - 100, now, "en")).toBe("data is fresh");
    const aug28 = Date.UTC(2026, 7, 28, 12) / 1000;
    expect(hubFreshness(aug28, aug28 + 3 * 86400, "en")).toBe("data from Aug 28");
  });
});

describe("burnsToday", () => {
  it("сгорает через три часа", () => expect(burnsToday(NOW + 3 * HOUR, NOW)).toBe(true));
  it("сгорает через три дня", () => expect(burnsToday(NOW + 3 * DAY, NOW)).toBe(false));
  it("уже сгорел", () => expect(burnsToday(NOW - HOUR, NOW)).toBe(false));
});

describe("hubFreshness", () => {
  it("данные внутри суток считаются свежими", () => {
    expect(hubFreshness(NOW - HOUR, NOW, "ru")).toBe("данные свежие");
  });
  it("данные старше суток показывают дату", () => {
    expect(hubFreshness(NOW - 2 * DAY, NOW, "ru")).toBe("данные от 28 августа");
  });
  it("время, которого нет в календаре, не роняет строку свежести", () => {
    expect(hubFreshness(-9e12, NOW, "ru")).toBe("данные от —");
    expect(hubFreshness(NaN, NOW, "en")).toBe("data from —");
    expect(hubFreshness(-Infinity, NOW, "en")).toBe("data from —");
  });
});

describe("progress", () => {
  it("половина срока", () => {
    expect(progress(NOW - 5 * DAY, NOW + 5 * DAY, NOW)).toBeCloseTo(0.5, 3);
  });
  it("не выходит за единицу", () => {
    expect(progress(NOW - 10 * DAY, NOW - 1 * DAY, NOW)).toBe(1);
  });
  it("не уходит ниже нуля", () => {
    expect(progress(NOW + 1 * DAY, NOW + 5 * DAY, NOW)).toBe(0);
  });
  it("нулевая длительность не даёт деления на ноль", () => {
    expect(progress(NOW, NOW, NOW)).toBe(1);
  });
});
