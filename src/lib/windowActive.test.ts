import { afterEach, describe, expect, it } from "vitest";
import { follow, isActive, setSignals, subscribeWindowActive, windowActive } from "./windowActive";

const ALL = { shown: true, pageVisible: true, focused: true };

describe("isActive", () => {
  it("окно активно, только когда оно видно, не свёрнуто и в фокусе", () => {
    expect(isActive(ALL)).toBe(true);
    expect(isActive({ ...ALL, shown: false })).toBe(false);
    expect(isActive({ ...ALL, pageVisible: false })).toBe(false);
    expect(isActive({ ...ALL, focused: false })).toBe(false);
    expect(isActive({ shown: false, pageVisible: false, focused: false })).toBe(false);
  });
});

describe("setSignals", () => {
  afterEach(() => setSignals(ALL));

  it("окно активно по умолчанию", () => {
    expect(windowActive()).toBe(true);
  });

  it("любой погасший признак делает окно неактивным, а вернувшийся — снова активным", () => {
    setSignals({ focused: false });
    expect(windowActive()).toBe(false);
    setSignals({ shown: false });
    setSignals({ focused: true });
    // Окно всё ещё в трее: фокус один его активным не делает.
    expect(windowActive()).toBe(false);
    setSignals({ shown: true });
    expect(windowActive()).toBe(true);
  });

  it("подписчик слышит только смену, а не каждое обновление признаков", () => {
    const seen: boolean[] = [];
    const stop = subscribeWindowActive((active) => seen.push(active));
    setSignals({ focused: false });
    setSignals({ pageVisible: false });
    setSignals({ focused: true });
    setSignals({ pageVisible: true });
    setSignals({ shown: true });
    stop();
    setSignals({ focused: false });
    expect(seen).toEqual([false, true]);
  });

  it("не падает без DOM — окружение тестов его не даёт", () => {
    expect(() => setSignals({ focused: false })).not.toThrow();
  });
});

/** Подписка, которую тест разрешает руками: событие и чтение приходят, когда он скажет. */
function fakeSource() {
  let emit: (value: boolean) => void = () => {};
  let resolveSubscribe: (stop: () => void) => void = () => {};
  let resolveRead: (value: boolean) => void = () => {};
  let rejectRead: (error: unknown) => void = () => {};
  let stopped = 0;
  const subscribe = (on: (value: boolean) => void) => {
    emit = on;
    return new Promise<() => void>((resolve) => {
      resolveSubscribe = resolve;
    });
  };
  const read = () =>
    new Promise<boolean>((resolve, reject) => {
      resolveRead = resolve;
      rejectRead = reject;
    });
  return {
    subscribe,
    read,
    emit: (value: boolean) => emit(value),
    subscribed: () => resolveSubscribe(() => stopped++),
    answer: (value: boolean) => resolveRead(value),
    fail: (error: unknown) => rejectRead(error),
    stopped: () => stopped,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("follow: подписка и начальное чтение без гонки", () => {
  it("без события применяется начальное чтение", async () => {
    const src = fakeSource();
    const seen: boolean[] = [];
    follow(src.subscribe, src.read, (v) => seen.push(v));
    src.answer(false);
    await tick();
    expect(seen).toEqual([false]);
  });

  it("событие, пришедшее раньше чтения, главнее: устаревшее чтение не применяется", async () => {
    const src = fakeSource();
    const seen: boolean[] = [];
    follow(src.subscribe, src.read, (v) => seen.push(v));
    src.emit(true);
    src.answer(false);
    await tick();
    expect(seen).toEqual([true]);
  });

  it("подписка ставится раньше чтения", () => {
    const order: string[] = [];
    follow(
      () => {
        order.push("subscribe");
        return Promise.resolve(() => {});
      },
      () => {
        order.push("read");
        return Promise.resolve(true);
      },
      () => {},
    );
    expect(order).toEqual(["subscribe", "read"]);
  });

  it("после остановки ни событие, ни чтение ничего не применяют, а подписка снимается", async () => {
    const src = fakeSource();
    const seen: boolean[] = [];
    const stop = follow(src.subscribe, src.read, (v) => seen.push(v));
    stop();
    src.emit(false);
    src.answer(false);
    src.subscribed();
    await tick();
    expect(seen).toEqual([]);
    expect(src.stopped()).toBe(1);
  });

  it("отказ чтения или подписки не роняет страницу", async () => {
    const src = fakeSource();
    const seen: boolean[] = [];
    const stop = follow(() => Promise.reject(new Error("no bridge")), src.read, (v) => seen.push(v));
    src.fail(new Error("no window"));
    await tick();
    stop();
    await tick();
    expect(seen).toEqual([]);
  });
});
