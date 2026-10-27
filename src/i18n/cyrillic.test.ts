import { describe, expect, it } from "vitest";

// Сторож кириллицы: русские буквы в коде страницы живут только в словаре ru.ts
// и в native.ts. Комментарии и файлы тестов не в счёт.

const FILES = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/**/*.d.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const ALLOWED = new Set(["/src/i18n/ru.ts", "/src/i18n/native.ts"]);

const CYRILLIC = /[Ѐ-ӿ]/;

/** Код без комментариев. Строчный комментарий — от `//`, перед которым не
 *  двоеточие: иначе резались бы адреса вида https://.
 *
 *  Разбивка по `/\r?\n/`, а не по `"\n"`: на файле с CRLF (Windows,
 *  `core.autocrlf=true` возвращает такие файлы при каждом чекауте) в конце
 *  строки остаётся `\r`, и `//.*$` не дотягивается до конца строки — комментарий
 *  не срезается, и сторож ложно ругается на уже переведённый файл. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const hasCyrillic = (path: string) => CYRILLIC.test(withoutComments(FILES[path] ?? ""));

describe("сторож кириллицы", () => {
  it("русские буквы — только в словаре", () => {
    const offenders = Object.keys(FILES).filter((p) => !ALLOWED.has(p) && hasCyrillic(p));
    expect(offenders).toEqual([]);
  });

  it("строчный комментарий срезается и на CRLF-файле, адрес не портится", () => {
    const text = 'const a = 1; // комментарий\r\nconst b = "https://x";\r\n';
    const result = withoutComments(text);
    expect(CYRILLIC.test(result)).toBe(false);
    expect(result).toContain('const b = "https://x";');
  });
});
