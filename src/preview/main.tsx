import { createRoot } from "react-dom/client";
import Controls from "./Controls";
import { installPreviewBackend, readParams } from "./backend";

// Вход стенда предпросмотра (`preview.html`): настоящее приложение с тестовыми
// данными вместо системной части. Живёт только в режиме разработки — сборка
// установщика берёт один `index.html`, и этот файл в неё не попадает.

const params = readParams(window.location.search);

// Мост подменяется до загрузки настоящего входа: тот сразу спрашивает язык.
installPreviewBackend(params.scenario, { lang: params.lang, motion: params.motion });
// Вариант палитры виден стилям атрибутом корня: у `current` своего блока нет,
// и действуют нынешние значения из `:root`.
document.documentElement.dataset.palette = params.palette;

if (params.controls) {
  const host = document.createElement("div");
  host.id = "preview-controls";
  document.body.appendChild(host);
  createRoot(host).render(<Controls params={params} />);
}

// Тот же вход, что и у приложения: язык, корневой компонент, стили.
void import("../main");
