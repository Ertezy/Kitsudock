import { describe, it, expect } from "vitest";
import { timeLeft, timeAgo, burnsToday, progress, hubFreshness, codeShareLeft, bannerShareLeft, clockArc, CLOCK_MIN_ARC } from "./time";

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

describe("codeShareLeft — кольцо часиков у кода", () => {
  it("неделя и больше до сгорания — полное кольцо", () => {
    expect(codeShareLeft(NOW + 7 * DAY, NOW)).toBe(1);
    expect(codeShareLeft(NOW + 30 * DAY, NOW)).toBe(1);
  });
  it("дальше кольцо убывает линейно", () => {
    expect(codeShareLeft(NOW + 3.5 * DAY, NOW)).toBeCloseTo(0.5, 6);
    expect(codeShareLeft(NOW + 2 * DAY, NOW)).toBeCloseTo(2 / 7, 6);
    expect(codeShareLeft(NOW + 12 * HOUR, NOW)).toBeCloseTo(1 / 14, 6);
  });
  it("сгоревший код — пустое кольцо, а не отрицательное", () => {
    expect(codeShareLeft(NOW, NOW)).toBe(0);
    expect(codeShareLeft(NOW - DAY, NOW)).toBe(0);
  });
});

describe("bannerShareLeft — кольцо часиков у баннера", () => {
  it("доля оставшегося от всего срока баннера", () => {
    expect(bannerShareLeft(NOW - 5 * DAY, NOW + 5 * DAY, NOW)).toBeCloseTo(0.5, 6);
    expect(bannerShareLeft(NOW - 12 * DAY, NOW + 6 * DAY, NOW)).toBeCloseTo(1 / 3, 6);
  });
  it("только начался — полное кольцо; ещё не начался — тоже не больше полного", () => {
    expect(bannerShareLeft(NOW, NOW + 10 * DAY, NOW)).toBe(1);
    expect(bannerShareLeft(NOW + DAY, NOW + 10 * DAY, NOW)).toBe(1);
  });
  it("кончился — пустое кольцо", () => {
    expect(bannerShareLeft(NOW - 10 * DAY, NOW, NOW)).toBe(0);
    expect(bannerShareLeft(NOW - 10 * DAY, NOW - DAY, NOW)).toBe(0);
  });
  it("нулевой или обратный срок — пустое кольцо, без деления на ноль", () => {
    expect(bannerShareLeft(NOW + DAY, NOW + DAY, NOW)).toBe(0);
    expect(bannerShareLeft(NOW + 2 * DAY, NOW + DAY, NOW)).toBe(0);
  });
});

describe("clockArc — дуга, которую рисуют часики", () => {
  it("почти истёкший срок всё равно виден краешком дуги", () => {
    expect(CLOCK_MIN_ARC).toBeGreaterThan(0);
    expect(CLOCK_MIN_ARC).toBeLessThanOrEqual(0.06);
    expect(clockArc(0)).toBe(CLOCK_MIN_ARC);
    expect(clockArc(0.001)).toBe(CLOCK_MIN_ARC);
  });
  it("остальные доли рисуются как есть и не выходят за полное кольцо", () => {
    expect(clockArc(0.5)).toBe(0.5);
    expect(clockArc(1)).toBe(1);
    expect(clockArc(1.5)).toBe(1);
  });
});
