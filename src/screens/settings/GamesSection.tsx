import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { currentT, useT } from "../../i18n";
import { errorText } from "../../i18n/errors";
import GameRow from "./GameRow";
import GameEditor from "./GameEditor";
import FirstRunView from "./FirstRunView";
import EmptyState from "../../components/EmptyState";
import type { GameView, HubGame } from "../../types";

export default function GamesSection() {
  const [games, setGames] = useState<GameView[]>([]);
  const [hubGames, setHubGames] = useState<HubGame[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Список уже прочитан: до этого пустой массив значит «ещё не знаем», а не
  // «игр нет», и пустое место не должно мелькнуть перед списком. Не прочитался —
  // говорит ошибка, а не пустое место.
  const [loaded, setLoaded] = useState(false);
  // Тот же экран с галочками, что и при первом запуске: список установленного
  // мог обновиться, а человеку — захотеться пересмотреть, что добавить.
  const [scanning, setScanning] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const dragTo = useRef<number | null>(null);
  const t = useT();

  const reload = useCallback(async () => {
    try {
      setGames(await api.getGames());
      setLoaded(true);
      setError("");
    } catch (e) {
      // `currentT()`, а не `t`: `reload` не должна меняться при смене языка,
      // иначе эффект ниже заново перечитает список и каталог.
      setError(errorText(currentT(), e));
    }
  }, []);

  const empty = loaded && games.length === 0;

  useEffect(() => {
    void reload();
    // Каталог для привязки контента — грузим один раз, он не меняется
    // действиями этого экрана.
    void (async () => {
      try {
        setHubGames((await api.getHub()).games);
      } catch {
        // Хаб мог быть недоступен — привязка контента просто не предложит
        // вариантов, это не мешает править остальные поля игры.
      }
    })();
  }, [reload]);

  const commitOrder = useCallback(async () => {
    const from = dragFrom.current;
    const to = dragTo.current;
    dragFrom.current = null;
    dragTo.current = null;
    if (from === null || to === null || from === to) return;

    const next = [...games];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGames(next);
    try {
      await api.reorderGames(next.map((g) => g.id));
    } catch (e) {
      setError(errorText(t, e));
      // Порядок на экране разошёлся с конфигом — перечитываем правду.
      void reload();
    }
  }, [games, reload, t]);

  if (scanning) {
    return (
      <FirstRunView
        onDone={() => {
          setScanning(false);
          void reload();
        }}
      />
    );
  }

  return (
    <div>
      <h2 className="settings-section-title">{t.settings.tabs.games}</h2>
      {/* Подсказка про порядок нужна, только когда есть что упорядочивать;
          пустой список вместо неё показывает, что сделать. До ответа нет ни
          той, ни другого: подсказка не мелькает перед пустым местом. */}
      {loaded && !empty && <p className="settings-hint">{t.settings.games.hint}</p>}

      {error && <div className="settings-error">{error}</div>}

      {empty && (
        <EmptyState className="settings-empty" title={t.settings.games.emptyTitle} hint={t.settings.games.emptyHint} />
      )}

      {games.map((g, i) => (
        <GameRow
          key={g.id}
          game={g}
          expanded={expanded === g.id}
          onToggle={() => setExpanded(expanded === g.id ? null : g.id)}
          onDragStart={() => {
            dragFrom.current = i;
          }}
          onDragOver={() => {
            dragTo.current = i;
          }}
          onDrop={() => void commitOrder()}
        >
          <GameEditor game={g} hubGames={hubGames} onChanged={() => void reload()} />
        </GameRow>
      ))}

      <div className="settings-actions">
        <button
          type="button"
          className="button accent"
          onClick={() =>
            void (async () => {
              const exe = await api.pickExe();
              if (!exe) return;
              const guessed = exe.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? t.settings.games.defaultTitle;
              try {
                await api.addGame(guessed, exe);
                await reload();
              } catch (e) {
                setError(errorText(t, e));
              }
            })()
          }
        >
          {t.settings.games.addManually}
        </button>
        <button type="button" className="button" onClick={() => setScanning(true)}>
          {t.settings.games.scanInstalled}
        </button>
      </div>
    </div>
  );
}
