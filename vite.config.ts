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
  // Vitest replaces CSS with an empty string by default, even with `?raw`. The
  // stylesheet guard (`src/styles.test.ts`) needs the real file contents.
  test: { css: { include: [/styles\.css/] } },
});
