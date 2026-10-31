import React from "react";
import ReactDOM from "react-dom/client";
// Шрифт лежит в проекте, а не тянется из сети: политика содержимого внешние
// шрифты запрещает, да и настольное приложение не должно ждать интернет,
// чтобы нарисовать буквы. Вариативное начертание — один файл на все веса.
import "@fontsource-variable/golos-text";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { api } from "./lib/api";
import { asLang, setLanguage } from "./i18n";
import { asVideoLang, setVideoLanguage } from "./lib/videoLanguage";
import { NOTHING_COLLAPSED, asCollapsed, setCollapsedAll } from "./lib/collapse";
import "./styles.css";

// Язык читается до первой отрисовки: иначе при запуске на миг мелькнул бы
// английский у того, кто выбрал русский. Свёрнутые разделы — тоже: свёрнутое
// должно сразу встать свёрнутым, а не сворачиваться на глазах. Отказ моста —
// значения по умолчанию, приложение всё равно открывается.
void Promise.all([
  api.getLanguage().then(asLang, () => "en" as const),
  api.getVideoLanguage().then(asVideoLang, () => "en" as const),
  api.getCollapsed().then(asCollapsed, () => NOTHING_COLLAPSED),
]).then(([lang, videoLang, collapsed]) => {
  setLanguage(lang);
  setVideoLanguage(videoLang);
  setCollapsedAll(collapsed);
  // Предохранитель снаружи App: упавшая отрисовка не должна оставлять пустое
  // окно — вместо него короткое сообщение и кнопка перезагрузки.
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
