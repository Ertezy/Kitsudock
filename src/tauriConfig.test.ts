import { describe, expect, it } from "vitest";
import rawConf from "../src-tauri/tauri.conf.json?raw";

// Файл читается средствами Vite (`?raw`), как в остальных сторожах: типов Node
// в проекте нет.

interface WindowConf {
  label?: string;
  dragDropEnabled?: boolean;
}

const conf = JSON.parse(rawConf) as { app: { windows: WindowConf[] } };

describe("tauri.conf.json", () => {
  it("leaves dragging inside the main window to the page", () => {
    // На Windows окно Tauri по умолчанию само перехватывает перетаскивание
    // (чтобы ловить брошенные файлы), и тогда HTML5 drag-and-drop страницы не
    // срабатывает: строки игр в настройках не переставить. Брошенные файлы
    // приложение не принимает, так что перехват ему не нужен.
    const main = conf.app.windows.find((w) => (w.label ?? "main") === "main");
    expect(main).toBeDefined();
    expect(main?.dragDropEnabled).toBe(false);
  });
});
