import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../lib/api";
import { gradientFor } from "../../lib/gradient";
import { hasOwnBackground, sourceText, videoSizeProblem } from "../../lib/background";
import { setMotion } from "../../lib/motion";
import { setVideoLanguage, useVideoLanguage, videoLanguage } from "../../lib/videoLanguage";
import { currentLang, currentT, dictionary, setLanguage, useLang, useT, type Lang, type VideoLang } from "../../i18n";
import { errorText } from "../../i18n/errors";
import { LANGS, LANG_NAMES, LANGUAGE_BLOCK_TITLE, VIDEO_LANGS, VIDEO_LANG_NAMES } from "../../i18n/native";
import Switch from "./Switch";
import Segmented from "./Segmented";
import EmptyState from "../../components/EmptyState";
import type { GameView } from "../../types";

/** Вкладка «Вид»: всё про фоны в одном месте (спека этапа 5, §7.3). */
export default function LookSection() {
  const [games, setGames] = useState<GameView[]>([]);
  // Как во вкладке «Игры»: пустое место — только когда список прочитан и пуст.
  const [loaded, setLoaded] = useState(false);
  const [storeArt, setStoreArt] = useState<boolean | null>(null);
  const [animation, setAnimation] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = useT();
  const lang = useLang();
  const videoLang = useVideoLanguage();

  // Выбор применяется сразу — страница перерисовывается на новом языке, — а
  // сохраняется следом. Не сохранился — язык возвращается, ошибка на прежнем.
  async function chooseLanguage(next: Lang) {
    const before = currentLang();
    setLanguage(next);
    // Тот же busy, что блокирует кнопки фонов: переключатель языка не должен
    // принять второй клик, пока это или другое сохранение ещё выполняется.
    setBusy(true);
    try {
      await api.setLanguage(next);
      setError("");
    } catch (e) {
      setLanguage(before);
      setError(errorText(dictionary(before), e));
    } finally {
      setBusy(false);
    }
  }

  async function chooseVideoLanguage(next: VideoLang) {
    const before = videoLanguage();
    setVideoLanguage(next);
    setBusy(true);
    try {
      await api.setVideoLanguage(next);
      setError("");
    } catch (e) {
      setVideoLanguage(before);
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  const reload = useCallback(async () => {
    try {
      const [list, storeArtEnabled, animationEnabled] = await Promise.all([
        api.getGames(),
        api.getStoreArt(),
        api.getAnimation(),
      ]);
      setGames(list);
      setLoaded(true);
      setStoreArt(storeArtEnabled);
      setAnimation(animationEnabled);
      setError("");
    } catch (e) {
      // `currentT()`, а не `t`: `reload` не должна меняться при смене языка,
      // иначе подписка ниже пересоздавалась бы.
      setError(errorText(currentT(), e));
    }
  }, []);

  useEffect(() => {
    let active = true;
    void reload();
    // Картинки Epic докачиваются в фоне и могут появиться, пока вкладка открыта.
    // Подписка регистрируется асинхронно, а Tauri не копит события для тех, кто
    // подпишется позже. Поэтому, как только подписка точно действует, список
    // перечитывается ещё раз: всё, что успело докачаться, уже лежит в кеше.
    const unlisten = listen("games-changed", () => void reload());
    void unlisten.then(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
      void unlisten.then((stop) => stop());
    };
  }, [reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (gameId: string, kind: "background" | "video") =>
    void (async () => {
      if (kind === "background") {
        const picked = await api.pickImage();
        if (picked) await run(() => api.updateGame({ gameId, background: picked }));
        return;
      }
      const picked = await api.pickVideo();
      if (!picked) return;
      // Вся цепочка — проверка формата и веса в Rust, затем размер в точках —
      // идёт внутри `run`: кнопки блокируются на время проверки, а отказ
      // `checkVideo` попадает в баннер ошибки той же дорогой, что и остальные.
      await run(async () => {
        await api.checkVideo(picked);
        const { width, height } = await videoPixelSize(picked);
        const problem = videoSizeProblem(t, width, height);
        if (problem) throw problem;
        await api.updateGame({ gameId, video: picked });
      });
    })();

  return (
    <div>
      <h2 className="settings-section-title">{t.settings.tabs.look}</h2>
      {error && <div className="settings-error">{error}</div>}

      <div className="settings-card-caption">{LANGUAGE_BLOCK_TITLE}</div>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.language.interface}</span>
          </div>
          <div className="settings-row-control">
            <Segmented
              options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
              value={lang}
              label={t.language.interface}
              disabled={busy}
              onChange={(next) => void chooseLanguage(next)}
            />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.language.video}</span>
          </div>
          <div className="settings-row-control">
            <Segmented
              options={VIDEO_LANGS.map((l) => ({ value: l, label: VIDEO_LANG_NAMES[l] }))}
              value={videoLang}
              label={t.language.video}
              disabled={busy}
              onChange={(next) => void chooseVideoLanguage(next)}
            />
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.settings.look.storeArt}</span>
            <span className="settings-row-hint">{t.settings.look.storeArtHint}</span>
          </div>
          <div className="settings-row-control">
            {storeArt !== null && (
              <Switch
                checked={storeArt}
                label={t.settings.look.storeArt}
                disabled={busy}
                onChange={(next) => void run(() => api.setStoreArt(next))}
              />
            )}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">{t.settings.look.animation}</span>
            <span className="settings-row-hint">{t.settings.look.animationHint}</span>
          </div>
          <div className="settings-row-control">
            {animation !== null && (
              <Switch
                checked={animation}
                label={t.settings.look.animation}
                disabled={busy}
                onChange={(next) =>
                  void run(async () => {
                    await api.setAnimation(next);
                    // Применяется сразу, не дожидаясь закрытия настроек.
                    setMotion(next);
                  })
                }
              />
            )}
          </div>
        </div>
      </div>

      {!loaded ? null : games.length === 0 ? (
        <EmptyState className="settings-empty" title={t.settings.look.noGames} hint={t.settings.look.noGamesHint} />
      ) : (
        <div className="settings-card">
          {games.map((g) => (
            <div className="settings-row" key={g.id}>
              <Preview game={g} />
              <div className="settings-row-text">
                <span className="settings-row-title">{g.title}</span>
                <span className={g.videoMissing ? "settings-row-hint look-warn" : "settings-row-hint"}>
                  {sourceText(t, g)}
                </span>
              </div>
              <div className="settings-row-control">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => pick(g.id, "background")}
                >
                  {t.settings.look.pickImage}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => pick(g.id, "video")}
                >
                  {t.settings.look.pickVideo}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || !hasOwnBackground(g)}
                  onClick={() =>
                    void run(() => api.updateGame({ gameId: g.id, background: "", video: "" }))
                  }
                >
                  {t.settings.look.removeBackground}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Превью фона. Своё видео — неподвижным первым кадром, а не проигрыванием: пять
 * роликов сразу на одном экране грузили бы компьютер (спека §7.3). У официального
 * фона HoYoPlay берётся его картинка: первый кадр ролика часто чёрный.
 */
function Preview({ game }: { game: GameView }) {
  if (game.videoPath && !(game.artSource === "hoyoplay" && game.artPath)) {
    return (
      <video
        className="look-preview"
        src={convertFileSrc(game.videoPath)}
        preload="metadata"
        muted
        playsInline
      />
    );
  }
  if (game.artPath) {
    return <img className="look-preview" src={convertFileSrc(game.artPath)} alt="" />;
  }
  return <div className="look-preview" style={{ background: gradientFor(game.title) }} />;
}

/**
 * Размер видео в точках. Измеряется здесь, на странице, а не в Rust: Rust
 * умеет проверить формат и вес файла, но разбор самого mp4 или webm ради
 * одних только размеров кадра пришлось бы писать вручную — готового парсера
 * в зависимостях нет, а детачнутый `<video>` браузера делает это бесплатно.
 *
 * Файл к этому моменту уже разрешён окну командой `checkVideo`. `error` и
 * десятисекундный таймер дают `0, 0` — тот же сигнал «не удалось прочитать»,
 * что и у испорченного файла.
 */
function videoPixelSize(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    let done = false;
    const finish = (width: number, height: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Файл держится открытым, пока у элемента есть источник — освобождаем
      // его сразу, не дожидаясь сборки мусора.
      video.src = "";
      video.load();
      resolve({ width, height });
    };

    const timer = setTimeout(() => finish(0, 0), 10_000);
    video.addEventListener("loadedmetadata", () => finish(video.videoWidth, video.videoHeight));
    video.addEventListener("error", () => finish(0, 0));
    video.src = convertFileSrc(path);
  });
}
