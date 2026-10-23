import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { launchNote } from "./lib/launch";
import { setMotion } from "./lib/motion";
import { REFRESH_EVERY_MS, backgroundsKey, sameHub, shouldRefreshOnShow, shouldRefreshOnOnline } from "./lib/hubRefresh";
import SidePanel from "./components/SidePanel";
import GameArt from "./components/GameArt";
import PlayButton from "./components/PlayButton";
import GameDock from "./components/GameDock";
import Settings from "./screens/Settings";
import FirstRunView from "./screens/settings/FirstRunView";
import { currentT, useT } from "./i18n";
import { errorText } from "./i18n/errors";
import type { GameView, HubData, LaunchResult } from "./types";

type Screen = "loading" | "firstRun" | "main" | "settings";

export default function App() {
  const [games, setGames] = useState<GameView[]>([]);
  const [hub, setHub] = useState<HubData | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Ошибка запуска из трея: держим отдельно от `error`, чтобы она показывалась
  // у кнопки Play, а не общим баннером (спека этапа 7 §5). `id` растёт с
  // каждым провалом — иначе повторный провал того же текста не отличался бы
  // от предыдущего и PlayButton не показал бы его снова (правка финальной
  // ревизии этапа 7).
  const [trayFailure, setTrayFailure] = useState<{ gameId: string; text: string; id: number } | null>(null);
  const trayFailureId = useRef(0);
  // "loading" — пока не узнали, был ли уже первый запуск: не показывать
  // главный экран, чтобы не мигнуть им перед экраном первого запуска.
  const [screen, setScreen] = useState<Screen>("loading");
  // Версия работающего приложения — для строки «Вышла версия» в панели.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    void api.getAbout().then((about) => setAppVersion(about.version)).catch(() => setAppVersion(null));
  }, []);
  const t = useT();

  // Когда данные панели проверялись последний раз — для проверки при возвращении окна.
  const lastHubCheck = useRef(0);

  // Счётчик запросов к хабу: запросы могут идти внахлёст (таймер, возврат
  // окна, load() после настроек) и ответить не в том порядке, в каком ушли.
  // Побеждает последний запущенный запрос, а не последний ответивший —
  // иначе смена адреса хаба в настройках могла бы откатиться назад, если
  // медленный ответ со старого адреса придёт позже нового.
  const hubRequestId = useRef(0);

  // Только список игр, без выбора и хаба: событие о новых фонах не должно
  // сбрасывать игру, которую человек уже выбрал в доке.
  const reloadGames = useCallback(async () => {
    try {
      setGames(await api.getGames());
      setError("");
    } catch (e) {
      // `currentT()` по той же причине, что и в `load`: подписка ниже не
      // должна пересоздаваться при смене языка.
      setError(errorText(currentT(), e));
    }
  }, []);

  // Отпечаток официальных фонов в последних применённых данных хаба. Rust берёт
  // фоны из ЛОКАЛЬНОГО файла хаба, а свежие данные приходят по сети уже после
  // того, как список игр собран: без перечитывания фон HoYoPlay появился бы
  // только после следующей сборки списка (на первом запуске и в день патча —
  // после перезапуска). Начальное значение — отпечаток «хаба нет».
  const appliedBackgrounds = useRef(backgroundsKey(null));

  // Хаб грузится отдельно: он может ходить в сеть, и его задержка не должна
  // откладывать появление главного экрана. Те же данные панель не
  // перерисовывают; отказ сети оставляет на экране то, что уже показано.
  const refreshHub = useCallback(async () => {
    lastHubCheck.current = Date.now();
    const requestId = ++hubRequestId.current;
    try {
      const next = await api.getHub();
      if (hubRequestId.current !== requestId) return;
      // Побочный эффект здесь, а не внутри функции для `setHub`: та обязана быть
      // чистой, а React может вызвать её не один раз. Перечитываем только при
      // смене отпечатка — почти все проверки хаба фонов не меняют.
      const key = backgroundsKey(next);
      if (key !== appliedBackgrounds.current) {
        appliedBackgrounds.current = key;
        void reloadGames();
      }
      setHub((current) => (sameHub(current, next) ? current : next));
    } catch {
      // Показанные данные остаются; следующая проверка попробует снова.
    }
  }, [reloadGames]);

  const load = useCallback(async () => {
    try {
      const [list, last] = await Promise.all([api.getGames(), api.getLastPlayed()]);
      setGames(list);
      setSelectedId(last);
      setError("");
    } catch (e) {
      // `currentT()`, а не `t`: с `t` в зависимостях `load` менялась бы при
      // смене языка, и эффект первого запуска ниже срабатывал бы заново —
      // уводил бы из настроек на главный экран.
      setError(errorText(currentT(), e));
    }
    void refreshHub();
  }, [refreshHub]);

  // Фоны Epic докачиваются после запуска (спека этапа 5, §3.3), и Rust сообщает
  // об этом событием. Подписка регистрируется асинхронно, а Tauri не копит
  // события для тех, кто подпишется позже: докачка, закончившаяся до
  // регистрации, прошла бы мимо. Поэтому, как только подписка точно действует,
  // список перечитывается один раз — картинка, успевшая скачаться, уже лежит в
  // кеше. Всё, что докачается позже, придёт событием.
  useEffect(() => {
    let active = true;
    const unlisten = listen("games-changed", () => void reloadGames());
    void unlisten.then(() => {
      if (active) void reloadGames();
    });
    return () => {
      active = false;
      void unlisten.then((stop) => stop());
    };
  }, [reloadGames]);

  // Запуск из трея не удался: окно уже открыто Rust — выбрать игру и
  // показать ошибку у кнопки Play (спека этапа 7 §5).
  useEffect(() => {
    const unlisten = listen<{ gameId: string; error: unknown }>("tray-launch-failed", (e) => {
      setSelectedId(e.payload.gameId);
      trayFailureId.current += 1;
      setTrayFailure({ gameId: e.payload.gameId, text: errorText(currentT(), e.payload.error), id: trayFailureId.current });
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  // Выбор другой игры гасит чужую ошибку трея: иначе при возврате к прежней
  // игре она всплыла бы снова, хотя могла давно устареть (правка ревью 1).
  useEffect(() => {
    setTrayFailure((current) => (current && current.gameId !== selectedId ? null : current));
  }, [selectedId]);

  // Приложение живёт в трее днями: данные панели проверяются раз в 3 часа и
  // при возвращении окна, если с прошлой проверки прошёл час (спека сборщика §9).
  useEffect(() => {
    const timer = window.setInterval(() => void refreshHub(), REFRESH_EVERY_MS);
    const onShown = () => {
      if (shouldRefreshOnShow(lastHubCheck.current, Date.now())) void refreshHub();
    };
    const unlisten = listen<boolean>("window-visibility", (e) => {
      if (e.payload) onShown();
    });
    const onVisibility = () => {
      if (document.visibilityState === "visible") onShown();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onOnline = () => {
      if (shouldRefreshOnOnline(lastHubCheck.current, Date.now())) void refreshHub();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      void unlisten.then((stop) => stop());
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [refreshHub]);

  useEffect(() => {
    void (async () => {
      if (await api.needsFirstRun()) {
        setScreen("firstRun");
        return;
      }
      await load();
      setScreen("main");
    })();
  }, [load]);

  // Тумблер «Анимация» читается один раз при запуске: дальше `motion.ts` сам
  // держит актуальное значение и рассылает его подписчикам при переключении
  // на вкладке «Вид» (спека этапа 5, §12).
  useEffect(() => {
    api.getAnimation().then(setMotion).catch(() => {});
  }, []);

  // Экран первого запуска закрывается — список игр мог измениться.
  const finishFirstRun = useCallback(() => {
    setScreen("main");
    void load();
  }, [load]);

  const selected = games.find((g) => g.id === selectedId) ?? games[0] ?? null;

  // Фон какой игры уже начал проявляться. Подпись и кнопка PLAY поднимаются
  // вслед за фоном своей игры, а не сразу после выбора: большая картинка
  // может грузиться заметно дольше, чем длится их появление.
  const [artShownFor, setArtShownFor] = useState<string | null>(null);

  const select = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const launch = useCallback(async (): Promise<LaunchResult> => {
    if (!selected) return { ok: false, msg: t.main.noGameSelected };
    try {
      await api.launchGame(selected.id);
      return { ok: true, msg: "" };
    } catch (e) {
      return { ok: false, msg: errorText(t, e) };
    }
  }, [selected, t]);

  // Возврат из настроек обязан перечитать список игр: человек мог там всё
  // поменять (добавить, убрать, переименовать, отвязать от хаба, сменить фон).
  const backFromSettings = useRef(false);
  const closeSettings = useCallback(() => {
    backFromSettings.current = true;
    setScreen("main");
    void load();
  }, [load]);

  // Кнопка «Назад» пропала вместе с настройками — фокус возвращается на
  // шестерёнку, которой их открыли, а не теряется в начале страницы. Если фокус
  // уже где-то стоит, его не трогаем.
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (screen !== "main" || !backFromSettings.current) return;
    backFromSettings.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    mainRef.current?.querySelector<HTMLElement>(".panel-gear")?.focus({ preventScroll: true });
  }, [screen]);

  if (screen === "loading") {
    return <div className="screen" />;
  }

  if (screen === "firstRun") {
    // Тот же визуальный каркас, что и у настроек, но без навигации по
    // вкладкам: настраивать пока нечего, кроме списка игр. Без колонки вкладок
    // слева содержимое стоит посередине окна, а не прижато к краю.
    return (
      <div className="settings is-first-run">
        <div className="settings-body">
          <FirstRunView onDone={finishFirstRun} />
        </div>
      </div>
    );
  }

  if (screen === "settings") {
    return <Settings onClose={closeSettings} />;
  }

  return (
    <div className="screen" ref={mainRef}>
      <SidePanel
        hub={hub}
        selectedContentId={selected?.contentId ?? null}
        onOpenSettings={() => setScreen("settings")}
        appVersion={appVersion}
      />
      <main className="stage">
        <GameArt game={selected} onShown={setArtShownFor} />
        {selected && (
          <PlayButton
            // key: при смене игры кнопка пересоздаётся, а не переиспользуется —
            // иначе её состояние ошибки осталось бы висеть под новой игрой
            // (правка ревью 1).
            key={selected.id}
            gameId={selected.id}
            artShown={artShownFor === selected.id}
            note={launchNote(t, selected)}
            onLaunch={launch}
            onFixed={load}
            externalFailure={trayFailure?.gameId === selected.id ? { id: trayFailure.id, text: trayFailure.text } : null}
          />
        )}
        {error && <div className="banner">{t.main.loadFailed(error)}</div>}
        <GameDock games={games} selectedId={selected?.id ?? null} onSelect={select} />
      </main>
    </div>
  );
}
