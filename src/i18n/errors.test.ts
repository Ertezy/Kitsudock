import { describe, expect, it } from "vitest";
import { errorText } from "./errors";
import { en } from "./en";
import { ru } from "./ru";

describe("текст ошибки", () => {
  it("код с подробностью — фраза выбранного языка", () => {
    expect(errorText(en, { code: "fileMissing", detail: "C:\\g.exe" })).toBe("File not found: C:\\g.exe");
    expect(errorText(ru, { code: "fileMissing", detail: "C:\\g.exe" })).toContain("C:\\g.exe");
  });

  it("код без подробности", () => {
    expect(errorText(en, { code: "emptyTitle" })).toBe("The name can't be empty");
  });

  it("незнакомый код — общая фраза с подробностью", () => {
    expect(errorText(en, { code: "somethingNew", detail: "x" })).toBe("Unknown error: x");
    expect(errorText(en, { code: "somethingNew" })).toBe("Unknown error");
    expect(errorText(ru, { code: "somethingNew", detail: "x" })).toBe("Неизвестная ошибка: x");
  });

  it("обычная ошибка JavaScript и строка", () => {
    expect(errorText(en, new Error("boom"))).toBe("boom");
    expect(errorText(en, "plain")).toBe("plain");
  });

  it("у каждого кода Rust есть фраза на обоих языках", () => {
    // Список повторяет src-tauri/src/error.rs, модуль code.
    const codes = [
      "gameNotFound", "fileMissing", "exePathMissing", "argsUnclosedQuote", "exeStartFailed",
      "steamOpenFailed", "epicOpenFailed", "emptyTitle", "hubUrlNotHttps", "videoPickFailed",
      "videoWrongFormat", "videoFileMissing", "videoTooLarge",
      "cacheReadFailed", "logFolderMissing", "openFolderFailed", "configSaveFailed", "autostartFailed", "internal",
    ];
    for (const code of codes) {
      const english = errorText(en, { code, detail: "d" });
      if (code === "internal") expect(english).toBe("Internal error: d");
      expect(english).not.toBe("Unknown error: d");
      const russian = errorText(ru, { code, detail: "d" });
      if (code === "internal") expect(russian).toBe("Внутренняя ошибка: d");
      expect(russian).not.toBe("Неизвестная ошибка: d");
    }
  });

  it("каждая фраза — отдельное предложение с заглавной буквы: она стоит одна в плашке ошибки", () => {
    for (const dict of [en, ru]) {
      for (const [code, phrase] of Object.entries(dict.errors)) {
        const texts = typeof phrase === "function" ? [phrase(), phrase("d")] : [phrase];
        for (const text of texts) {
          expect(text.charAt(0), `${code}: ${text}`).toBe(text.charAt(0).toUpperCase());
          expect(text, `${code}: ${text}`).not.toMatch(/!|Что-то пошло не так|Something went wrong|Упс|Oops/i);
        }
      }
    }
  });

  it("русский — подробность на месте переменной части", () => {
    const ruText = (code: string, detail?: string) => errorText(ru, { code, detail });
    expect(ruText("gameNotFound", "Genshin Impact")).toBe("Игра не найдена: Genshin Impact");
    expect(ruText("gameNotFound")).toBe("Этой игры уже нет в списке.");
    expect(ruText("fileMissing", "C:\\g.exe")).toBe("Файл не найден: C:\\g.exe");
    expect(ruText("exePathMissing")).toBe("Путь к игре не указан. Укажите файл игры вручную.");
    expect(ruText("argsUnclosedQuote", '-name "x')).toBe('Не удалось разобрать аргументы запуска «-name "x»: закройте кавычку.');
    expect(ruText("exeStartFailed", "C:\\g.exe: отказано")).toBe("Не удалось запустить C:\\g.exe: отказано");
    expect(ruText("steamOpenFailed", "steam://rungameid/1: нет")).toBe(
      "Не удалось открыть steam://rungameid/1: нет. Проверьте, что Steam установлен и хотя бы раз запускался.",
    );
    expect(ruText("epicOpenFailed", "нет")).toBe(
      "Не удалось открыть Epic Games Launcher: нет. Проверьте, что он установлен.",
    );
    expect(ruText("emptyTitle")).toBe("Название не может быть пустым");
    expect(ruText("hubUrlNotHttps")).toBe("Адрес должен начинаться с https://");
    expect(ruText("videoPickFailed", "x")).toBe("Не удалось открыть видео: x");
    expect(ruText("videoWrongFormat")).toBe("Видео должно быть в формате mp4 или webm.");
    expect(ruText("videoFileMissing")).toBe("Файл видео не найден.");
    expect(ruText("videoTooLarge", "300")).toBe("Видео тяжелее 300 МБ — выберите файл поменьше.");
    expect(ruText("cacheReadFailed", "x")).toBe("Не удалось прочитать кеш: x");
    expect(ruText("logFolderMissing", "x")).toBe("Папка журнала не найдена: x");
    expect(ruText("openFolderFailed", "x")).toBe("Не удалось открыть папку: x");
    expect(ruText("configSaveFailed", "запись C:\\config.json.tmp: x")).toBe("Не удалось сохранить настройки: запись C:\\config.json.tmp: x");
    expect(ruText("configSaveFailed")).toBe("Не удалось сохранить настройки");
  });

  it("английский — подробность на месте", () => {
    expect(errorText(en, { code: "videoTooLarge", detail: "300" })).toBe(
      "The video is larger than 300 MB — pick a smaller file.",
    );
    expect(errorText(en, { code: "gameNotFound" })).toBe("This game is no longer in the list.");
    expect(errorText(en, { code: "configSaveFailed", detail: "x" })).toBe("Couldn't save the settings: x");
  });
});
