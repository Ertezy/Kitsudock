/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for Tauri v2: fixed port, no hot-reload of the Rust side.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Don't trigger Vite restart when Rust files change.
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  // Vitest по умолчанию подменяет CSS пустой строкой, даже при `?raw`. Сторожу
  // стилей (`src/styles.test.ts`) нужен настоящий текст файла.
  test: { css: { include: [/styles\.css/] } },
});
