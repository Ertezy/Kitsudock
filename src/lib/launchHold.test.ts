import { describe, expect, it } from "vitest";
import { LAUNCH_HOLD_MS, launchHeld } from "./launchHold";

describe("«Запускаю…» после ответа на запуск", () => {
  it("удачный запуск, окно всё ещё перед глазами — надпись держится", () => {
    expect(launchHeld(false, { kind: "answered", ok: true, windowActive: true })).toBe(true);
  });

  it("запуск не удался — не держится: ошибка видна сразу", () => {
    expect(launchHeld(false, { kind: "answered", ok: false, windowActive: true })).toBe(false);
    expect(launchHeld(false, { kind: "answered", ok: false, windowActive: false })).toBe(false);
  });

  it("окно уже неактивно к ответу — игра забрала фокус или окно ушло в трей — не держится", () => {
    expect(launchHeld(false, { kind: "answered", ok: true, windowActive: false })).toBe(false);
  });

  it("окно стало неактивным — отпускает; вернулось — снова не держит", () => {
    expect(launchHeld(true, { kind: "windowActive", active: false })).toBe(false);
    expect(launchHeld(false, { kind: "windowActive", active: true })).toBe(false);
  });

  it("окно и так активно — держит дальше", () => {
    expect(launchHeld(true, { kind: "windowActive", active: true })).toBe(true);
  });

  it("вышел потолок — отпускает, даже если окно так и не ушло из фокуса", () => {
    expect(launchHeld(true, { kind: "capped" })).toBe(false);
    expect(launchHeld(false, { kind: "capped" })).toBe(false);
  });
});

describe("LAUNCH_HOLD_MS", () => {
  it("потолок — 8 секунд", () => {
    expect(LAUNCH_HOLD_MS).toBe(8000);
  });
});
