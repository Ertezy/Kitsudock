import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { dataStatus } from "../../lib/panel";
import { availableUpdate } from "../../lib/update";
import { useLang, useT } from "../../i18n";
import { errorText } from "../../i18n/errors";
import type { About, Behaviour, HubData } from "../../types";
import Switch from "./Switch";

interface Props {
  tab: "behaviour" | "data" | "about";
}

function Behaviours() {
  const [b, setB] = useState<Behaviour | null>(null);
  const [error, setError] = useState("");
  const t = useT();

  useEffect(() => {
    void api.getBehaviour().then(setB);
  }, []);

  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    void api.getAutostart().then(setAutostart).catch(() => setAutostart(false));
  }, []);

  // Как и галочки выше: переключается сразу, откатывается, если запись в
  // реестр не прошла.
  const toggleAutostart = (next: boolean) => {
    const prev = autostart;
    setAutostart(next);
    setError("");
    void api.setAutostart(next).catch((e) => {
      setError(errorText(t, e));
      setAutostart(prev);
    });
  };

  if (!b) return null;

  // Галочка переключается сразу, для отзывчивости. Но если запись в конфиг
  // не прошла (папка только на чтение, файл занят), об этом нужно сказать и
  // вернуть галочку назад — иначе экран покажет состояние, которого на самом
  // деле нет, и человек, например, снимет «крестик прячет окно», закроет его
  // и получит сворачивание в трей вместо выхода.
  const save = (next: Behaviour) => {
    const prev = b;
    setB(next);
    setError("");
    void api.setBehaviour(next).catch((e) => {
      setError(errorText(t, e));
      setB(prev);
    });
  };

  return (
    <div>
      <h2 className="settings-section-title">{t.settings.tabs.behaviour}</h2>
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.settings.behaviour.closeToTray}</span>
            <span className="settings-row-hint">{t.settings.behaviour.closeToTrayHint}</span>
          </div>
          <div className="settings-row-control">
            <Switch
              checked={b.closeToTray}
              label={t.settings.behaviour.closeToTray}
              onChange={(next) => save({ ...b, closeToTray: next })}
            />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.settings.behaviour.trayOnLaunch}</span>
            <span className="settings-row-hint">{t.settings.behaviour.trayOnLaunchHint}</span>
          </div>
          <div className="settings-row-control">
            <Switch
              checked={b.trayOnLaunch}
              label={t.settings.behaviour.trayOnLaunch}
              onChange={(next) => save({ ...b, trayOnLaunch: next })}
            />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.settings.behaviour.autostart}</span>
            <span className="settings-row-hint">{t.settings.behaviour.autostartHint}</span>
          </div>
          <div className="settings-row-control">
            <Switch
              checked={autostart === true}
              label={t.settings.behaviour.autostart}
              disabled={autostart === null}
              onChange={toggleAutostart}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Data() {
  const [url, setUrl] = useState("");
  // Последнее сохранённое значение — по нему решаем, можно ли жать
  // «Сохранить». Без него нетронутое (и потому пустое до загрузки) поле
  // могло бы стереть уже настроенный адрес одним нажатием вслепую.
  const [savedUrl, setSavedUrl] = useState("");
  const [hub, setHub] = useState<HubData | null>(null);
  const [size, setSize] = useState(0);
  const [error, setError] = useState("");
  const lang = useLang();
  const t = useT();

  const reload = () => {
    void api.getHub().then(setHub).catch(() => setHub(null));
    void api.imageCacheSize().then(setSize);
  };

  useEffect(() => {
    reload();
    void api.getConfig().then((cfg) => {
      setUrl(cfg.hubUrl ?? "");
      setSavedUrl(cfg.hubUrl ?? "");
    });
  }, []);

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <div>
      <h2 className="settings-section-title">{t.settings.tabs.data}</h2>
      {error && <div className="settings-error">{error}</div>}

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{dataStatus(hub, nowSec, lang)}</span>
          </div>
          <div className="settings-row-control">
            <button type="button" className="button" onClick={reload}>
              {t.settings.data.refreshNow}
            </button>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.settings.data.imageCache}</span>
            <span className="settings-row-hint">
              {t.settings.data.imageCacheHint((size / 1024 / 1024).toFixed(1))}
            </span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              className="button"
              onClick={() =>
                void api
                  .clearImageCache()
                  .then(reload)
                  .catch((e) => setError(errorText(t, e)))
              }
            >
              {t.settings.data.clearCache}
            </button>
          </div>
        </div>

        {/* Поле адреса свёрнуто: человеку со стороны вписывать туда нечего,
            а открытое поле на виду читается как обязательное. */}
        <details className="settings-extra">
          <summary>{t.settings.advanced}</summary>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-title">{t.settings.data.hubUrl}</span>
              <span className="settings-row-hint">{t.settings.data.hubUrlHint}</span>
            </div>
            <div className="settings-row-control">
              <input
                className="input editor-input"
                aria-label={t.settings.data.hubUrl}
                value={url}
                placeholder={t.settings.data.hubUrlPlaceholder}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                type="button"
                className="button accent"
                disabled={url === savedUrl}
                onClick={() =>
                  void api
                    .setHubUrl(url)
                    .then(() => {
                      setError("");
                      setSavedUrl(url);
                      reload();
                    })
                    .catch((e) => setError(errorText(t, e)))
                }
              >
                {t.settings.save}
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function AboutSection() {
  const [about, setAbout] = useState<About | null>(null);
  const [hub, setHub] = useState<HubData | null>(null);
  const [error, setError] = useState("");
  const t = useT();

  useEffect(() => {
    void api.getAbout().then(setAbout);
    void api.getHub().then(setHub).catch(() => setHub(null));
  }, []);

  const update = availableUpdate(hub, about?.version ?? null);

  return (
    <div>
      <h2 className="settings-section-title">{t.settings.tabs.about}</h2>
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">
              {t.settings.about.version(about?.version ?? "…")}
              {update && (
                <span className="about-update">
                  {" · "}
                  {t.settings.about.updateAvailable(update.version)}
                  {" — "}
                  <button type="button" className="link-button" onClick={() => void api.openSafeUrl(update.url)}>
                    {t.settings.about.download}
                  </button>
                </span>
              )}
            </span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              className="button"
              onClick={() => void api.openSafeUrl("https://github.com/Ertezy/Kitsudock")}
            >
              {t.settings.about.repository}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.settings.about.log}</span>
            <span className="settings-row-hint">{t.settings.about.logHint(about?.logPath ?? "…")}</span>
          </div>
          <div className="settings-row-control">
            <button
              type="button"
              className="button"
              onClick={() => void api.openLogFolder().catch((e) => setError(errorText(t, e)))}
            >
              {t.settings.about.showLog}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void api.openSafeUrl("https://github.com/Ertezy/Kitsudock/issues/new")}
            >
              {t.settings.about.reportProblem}
            </button>
          </div>
        </div>
      </div>
      <p className="settings-note">{t.settings.about.disclaimer}</p>
    </div>
  );
}

export default function SmallSections({ tab }: Props) {
  if (tab === "behaviour") return <Behaviours />;
  if (tab === "data") return <Data />;
  return <AboutSection />;
}
