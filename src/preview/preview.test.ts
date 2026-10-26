import { afterEach, describe, expect, it, vi } from "vitest";
import apiSource from "../lib/api.ts?raw";
import viteConfig from "../../vite.config.ts?raw";
import type { GameView, HubData } from "../types";
import type { Scenario } from "./backend";

// Файлы читаются средствами Vite (`?raw` и `import.meta.glob`), как в сторожах
// кириллицы и стилей: типов Node в проекте нет, а новая зависимость не нужна.
const OUTSIDE = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/preview/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Любой способ подключить код стенда: `from "…"`, `import("…")` и `import "…"`. */
const IMPORTS_STAND = /(?:from|import)\s*\(?\s*["'][^"']*preview\//;

describe("стенд предпросмотра", () => {
  it("ничто вне стенда не импортирует его код", () => {
    const outside = Object.entries(OUTSIDE);
    expect(outside.length).toBeGreaterThan(20);
    for (const [path, text] of outside) {
      expect(text, path).not.toMatch(IMPORTS_STAND);
    }
  });

  it("сторож замечает и динамический импорт, и импорт ради побочного действия", () => {
    expect('import x from "../preview/data";').toMatch(IMPORTS_STAND);
    expect('export * from "./preview/data";').toMatch(IMPORTS_STAND);
    expect('const m = await import("./preview/main");').toMatch(IMPORTS_STAND);
    expect("void import('../preview/main');").toMatch(IMPORTS_STAND);
    expect('import "./preview/main";').toMatch(IMPORTS_STAND);
    expect('import { api } from "./lib/api";').not.toMatch(IMPORTS_STAND);
    expect('const m = await import("./lib/panel");').not.toMatch(IMPORTS_STAND);
  });

  it("сборка берёт только index.html", () => {
    expect(viteConfig).not.toMatch(/preview\.html/);
    expect(viteConfig).not.toMatch(/rollupOptions[\s\S]*input/);
  });

  it("стенд отвечает на каждую команду из api.ts", async () => {
    const commands = [...apiSource.matchAll(/invoke(?:<[^>]*>)?\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(20);
    const { PREVIEW_COMMANDS } = await import("./backend");
    for (const c of commands) expect(PREVIEW_COMMANDS, c).toContain(c);
  });
});

describe("адрес стенда", () => {
  it("без параметров берёт значения по умолчанию", async () => {
    const { readParams, DEFAULT_PARAMS } = await import("./backend");
    expect(readParams("")).toEqual(DEFAULT_PARAMS);
  });

  it("читает все параметры и отдаёт их обратно в адрес", async () => {
    const { readParams, toSearch, SCENARIOS } = await import("./backend");
    for (const scenario of SCENARIOS) {
      for (const lang of ["ru", "en"] as const) {
        for (const motion of [true, false]) {
          for (const active of [true, false]) {
            const params = { scenario, lang, motion, active, controls: true };
            expect(readParams(toSearch(params))).toEqual(params);
          }
        }
      }
    }
    expect(readParams("?controls=off").controls).toBe(false);
    expect(toSearch(readParams("?controls=off"))).toContain("controls=off");
  });

  it("неактивное окно — отдельный параметр, и по умолчанию окно активно", async () => {
    const { readParams, toSearch, DEFAULT_PARAMS } = await import("./backend");
    expect(DEFAULT_PARAMS.active).toBe(true);
    expect(readParams("?active=off").active).toBe(false);
    expect(readParams("?active=off").motion).toBe(true);
    expect(toSearch(readParams("?active=off"))).toContain("active=off");
  });

  it("неактивное окно стенд изображает ответом окна: оно спрятано", async () => {
    const { pluginHandlers } = await import("./backend");
    expect(pluginHandlers({})["plugin:window|is_visible"]({})).toBe(true);
    expect(pluginHandlers({ active: true })["plugin:window|is_visible"]({})).toBe(true);
    expect(pluginHandlers({ active: false })["plugin:window|is_visible"]({})).toBe(false);
  });

  it("знает все пять состояний данных", async () => {
    const { readParams, SCENARIOS } = await import("./backend");
    expect([...SCENARIOS]).toEqual(["normal", "loading", "offline", "stale", "firstRun"]);
    for (const scenario of SCENARIOS) expect(readParams(`?scenario=${scenario}`).scenario).toBe(scenario);
  });

  it("незнакомое значение заменяется значением по умолчанию", async () => {
    const { readParams, DEFAULT_PARAMS } = await import("./backend");
    expect(readParams("?scenario=bogus&lang=de&motion=maybe")).toEqual(DEFAULT_PARAMS);
  });

  it("палитры на стенде больше нет: старый параметр из ссылки ничего не меняет", async () => {
    const { readParams, toSearch, DEFAULT_PARAMS } = await import("./backend");
    expect(readParams("?palette=a")).toEqual(DEFAULT_PARAMS);
    expect(toSearch(readParams("?palette=a"))).not.toContain("palette");
  });
});

type Call = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Бэкенд стенда без окна: вызов команды, как её сделал бы мост. */
async function stand(scenario: Scenario): Promise<Call> {
  const { createHandlers } = await import("./backend");
  const handlers = createHandlers(scenario) as Record<string, (args: Record<string, unknown>) => unknown>;
  return (cmd, args = {}) => Promise.resolve().then(() => handlers[cmd](args));
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("ответы стенда на состояния данных", () => {
  afterEach(() => vi.useRealTimers());

  it("normal: хаб свежий, из сети", async () => {
    const call = await stand("normal");
    const hub = (await call("get_hub")) as HubData;
    expect(hub._source).toBe("remote");
    expect(nowSec() - hub.updatedAt).toBeLessThan(3600);
    expect(hub.codes.length).toBeGreaterThan(0);
  });

  it("loading: список игр отвечает сразу, хаб — только через минуту", async () => {
    vi.useFakeTimers();
    const call = await stand("loading");
    expect(((await call("get_games")) as GameView[]).length).toBe(5);
    expect(await call("needs_first_run")).toBe(false);

    let answered = false;
    const hub = call("get_hub").then((h) => {
      answered = true;
      return h as HubData;
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await hub)._source).toBe("remote");
  });

  it("offline: хаб не отказывает, а отдаётся из кеша тридцатичасовой давности", async () => {
    const call = await stand("offline");
    const hub = (await call("get_hub")) as HubData;
    expect(hub._source).toBe("cache");
    const age = nowSec() - hub.updatedAt;
    expect(age).toBeGreaterThanOrEqual(30 * 3600);
    expect(age).toBeLessThan(30 * 3600 + 5);
    expect(age).toBeLessThan(7 * 86400);
    await expect(call("cache_image", { url: hub.banners[0].image })).rejects.toEqual(expect.any(String));
  });

  it("stale: хаб из комплекта старше недели — панель спрячет коды и баннеры", async () => {
    const call = await stand("stale");
    const hub = (await call("get_hub")) as HubData;
    expect(hub._source).toBe("bundled");
    expect(nowSec() - hub.updatedAt).toBeGreaterThan(7 * 86400);
    await expect(call("cache_image", { url: hub.banners[0].image })).rejects.toEqual(expect.any(String));
  });

  it("normal: картинки хаба приходят нарисованными", async () => {
    const call = await stand("normal");
    const hub = (await call("get_hub")) as HubData;
    const banner = hub.banners.find((b) => b.image !== null);
    expect(await call("cache_image", { url: banner!.image })).toMatch(/^data:image\/svg\+xml/);
    await expect(call("cache_image", { url: "https://example.com/x.png" })).rejects.toEqual(expect.any(String));
  });

  it("firstRun: игр нет, пока не добавлены из поиска", async () => {
    const call = await stand("firstRun");
    expect(await call("needs_first_run")).toBe(true);
    expect(await call("get_games")).toEqual([]);
    const id = (await call("add_game_from_scan", { title: "Genshin Impact" })) as string;
    expect(((await call("get_games")) as GameView[]).map((g) => g.id)).toEqual([id]);
    await call("mark_seeded");
    expect(await call("needs_first_run")).toBe(false);
  });
});

describe("ответы стенда повторяют команды Rust", () => {
  afterEach(() => vi.useRealTimers());

  it("launch_game отвечает идентификатором игры", async () => {
    vi.useFakeTimers();
    const call = await stand("normal");
    const result = call("launch_game", { gameId: "hsr" });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await result).toBe("hsr");
    expect(await call("get_last_played")).toBe("hsr");
  });

  it("clear_image_cache отвечает числом удалённых файлов", async () => {
    const call = await stand("normal");
    const removed = await call("clear_image_cache");
    expect(Number.isInteger(removed)).toBe(true);
    expect(removed as number).toBeGreaterThan(0);
    expect(await call("image_cache_size")).toBe(0);
    expect(await call("clear_image_cache")).toBe(0);
  });

  it("set_hub_url отказывает не-https кодом без подробности", async () => {
    const call = await stand("normal");
    for (const url of ["http://example.test/hub.json", "ftp://x", "example.test/hub.json", "https:///path"]) {
      await expect(call("set_hub_url", { url })).rejects.toEqual({ code: "hubUrlNotHttps" });
    }
    await call("set_hub_url", { url: "HTTPS://example.test/hub.json" });
    expect(((await call("get_config")) as { hubUrl: string | null }).hubUrl).toBe("HTTPS://example.test/hub.json");
    await call("set_hub_url", { url: "  " });
    expect(((await call("get_config")) as { hubUrl: string | null }).hubUrl).toBeNull();
  });

  it("update_game: пустая строка стирает своё, иначе задаёт нарисованное", async () => {
    const call = await stand("normal");
    const game = async (id: string) => ((await call("get_games")) as GameView[]).find((g) => g.id === id)!;

    // У zzz своя картинка: «убрать» возвращает фон из лаунчера.
    const own = await game("zzz");
    expect(own.artSource).toBe("picture");
    await call("update_game", { gameId: "zzz", background: "", video: "" });
    const cleared = await game("zzz");
    expect(cleared.artSource).toBe("hoyoplay");
    expect(cleared.artPath).toBe(own.artPath);

    await call("update_game", { gameId: "zzz", background: "C:\\pics\\a.png" });
    const picture = await game("zzz");
    expect(picture.artSource).toBe("picture");
    expect(picture.artPath).toMatch(/^data:image\/svg\+xml/);
    expect(picture.artPath).not.toBe(own.artPath);

    await call("update_game", { gameId: "zzz", video: "C:\\clips\\a.mp4" });
    const video = await game("zzz");
    expect(video.artSource).toBe("video");
    expect(video.videoPath).toMatch(/^data:image\/svg\+xml/);
    await call("update_game", { gameId: "zzz", background: "", video: "" });
    const removed = await game("zzz");
    expect(removed.videoPath).toBeNull();
    expect(removed.artSource).toBe("hoyoplay");

    // Игра без картинок после «убрать» остаётся на запасной заливке.
    await call("update_game", { gameId: "endfield", background: "" });
    expect((await game("endfield")).artSource).toBe("fill");
  });

  it("update_game: путь к игре и название проверяются, как в Rust", async () => {
    const call = await stand("normal");
    await expect(call("update_game", { gameId: "hsr", exe: "" })).rejects.toEqual({ code: "fileMissing", detail: "" });
    await expect(call("update_game", { gameId: "hsr", title: "  " })).rejects.toEqual({ code: "emptyTitle" });
    await expect(call("update_game", { gameId: "nope", title: "x" })).rejects.toEqual({ code: "gameNotFound" });
    await call("update_game", { gameId: "hsr", exe: "D:\\Games\\game.exe", title: "Renamed" });
    const games = (await call("get_games")) as GameView[];
    expect(games.find((g) => g.id === "hsr")!.title).toBe("Renamed");
  });
});
