import { describe, expect, it } from "vitest";
import apiSource from "../lib/api.ts?raw";
import viteConfig from "../../vite.config.ts?raw";

// Файлы читаются средствами Vite (`?raw` и `import.meta.glob`), как в сторожах
// кириллицы и стилей: типов Node в проекте нет, а новая зависимость не нужна.
const OUTSIDE = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/preview/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("стенд предпросмотра", () => {
  it("ничто вне стенда не импортирует его код", () => {
    const outside = Object.entries(OUTSIDE);
    expect(outside.length).toBeGreaterThan(20);
    for (const [path, text] of outside) {
      expect(text, path).not.toMatch(/from\s+["'][^"']*preview\//);
    }
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
          const params = { scenario, lang, motion, palette: "current", controls: true };
          expect(readParams(toSearch(params))).toEqual(params);
        }
      }
    }
    expect(readParams("?controls=off").controls).toBe(false);
    expect(toSearch(readParams("?controls=off"))).toContain("controls=off");
  });

  it("незнакомое значение заменяется значением по умолчанию", async () => {
    const { readParams, DEFAULT_PARAMS } = await import("./backend");
    expect(readParams("?scenario=bogus&lang=de&motion=maybe&palette=nope")).toEqual(DEFAULT_PARAMS);
  });
});
