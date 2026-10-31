import { describe, expect, it } from "vitest";
import rawConf from "../src-tauri/tauri.conf.json?raw";

// Файл читается средствами Vite (`?raw`), как в остальных сторожах: типов Node
// в проекте нет.

interface WindowConf {
  label?: string;
  dragDropEnabled?: boolean;
}

interface UpdaterConf {
  pubkey?: string;
  endpoints?: string[];
  windows?: { installMode?: string };
}

const conf = JSON.parse(rawConf) as {
  app: { windows: WindowConf[] };
  bundle: { createUpdaterArtifacts?: unknown };
  plugins?: { updater?: UpdaterConf };
};

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

  it("takes updates only from the releases of this repository, signed and installed in passive mode", () => {
    // Кнопка «Обновить» спрашивает о новой версии ровно этот адрес: файл
    // latest.json последнего опубликованного релиза. Чужой адрес или http
    // отдали бы выбор версии тому, кто его держит.
    const updater = conf.plugins?.updater;
    expect(updater?.endpoints).toEqual(["https://github.com/Ertezy/Kitsudock/releases/latest/download/latest.json"]);
    // Установщик ставится, только если его подпись сходится с этим открытым
    // ключом; без ключа плагин не запустится вовсе.
    expect(updater?.pubkey?.trim()).toBeTruthy();
    // Без этого сборка не подписывает установщик, и в релизе нечем
    // подтвердить, что файл наш.
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
    // passive: установщик показывает только полосу хода, сам закрывает и
    // снова запускает приложение — человек ничего не нажимает.
    expect(updater?.windows?.installMode).toBe("passive");
  });
});
