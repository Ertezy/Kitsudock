import { useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { api } from "../../lib/api";
import { useT } from "../../i18n";
import { errorText } from "../../i18n/errors";
import type { GameView, HubGame } from "../../types";

interface Props {
  game: GameView;
  /** Игры из каталога — для привязки контента. */
  hubGames: HubGame[];
  onChanged: () => void;
}

export default function GameEditor({ game, hubGames, onChanged }: Props) {
  const [title, setTitle] = useState(game.title);
  const [args, setArgs] = useState(game.args);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = useT();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <div className="settings-error">{error}</div>}

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-title">{t.settings.editor.name}</span>
        </div>
        <div className="settings-row-control">
          <input
            className="input editor-input"
            aria-label={t.settings.editor.name}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            type="button"
            className="button"
            disabled={busy || title.trim() === "" || title === game.title}
            onClick={() => void run(() => api.updateGame({ gameId: game.id, title }))}
          >
            {t.settings.save}
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-title">{t.settings.editor.gameFile}</span>
          <span className="settings-row-hint">{t.settings.editor.gameFileHint}</span>
        </div>
        <div className="settings-row-control">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const exe = await api.pickExe();
                if (exe) await api.updateGame({ gameId: game.id, exe });
              })
            }
          >
            {t.settings.choose}
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-title">{t.settings.editor.icon}</span>
          <span className="settings-row-hint">{t.settings.editor.iconHint}</span>
        </div>
        <div className="settings-row-control">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void (async () => {
                const picked = await api.pickImage();
                if (!picked) return;
                await run(() => api.updateGame({ gameId: game.id, icon: picked }));
              })()
            }
          >
            {t.settings.choose}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void run(() => api.updateGame({ gameId: game.id, icon: "" }))}
          >
            {t.settings.editor.reset}
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-title">{t.settings.editor.showContentAs}</span>
          <span className="settings-row-hint">{t.settings.editor.showContentAsHint}</span>
        </div>
        <div className="settings-row-control">
          <select
            className="input"
            aria-label={t.settings.editor.showContentAs}
            value={game.contentId ?? ""}
            disabled={busy}
            onChange={(e) =>
              void run(() => api.updateGame({ gameId: game.id, contentId: e.target.value }))
            }
          >
            <option value="">{t.settings.editor.noContent}</option>
            {hubGames.map((h) => (
              <option key={h.id} value={h.id}>
                {h.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text" />
        <div className="settings-row-control">
          {game.missing && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void run(() => api.relocateGame(game.id))}
            >
              {t.main.relocate}
            </button>
          )}
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => {
              void (async () => {
                const yes = await confirm(t.settings.editor.removeConfirm(game.title), {
                  title: t.settings.editor.removeConfirmTitle,
                  kind: "warning",
                  okLabel: t.settings.editor.removeOk,
                  cancelLabel: t.settings.editor.removeCancel,
                });
                if (yes) await run(() => api.removeGame(game.id));
              })();
            }}
          >
            {t.settings.editor.remove}
          </button>
        </div>
      </div>

      <details className="settings-extra">
        <summary>{t.settings.advanced}</summary>
        {/* Аргументы доходят до игры только при прямом запуске: у игры из
            магазина поле есть, если её можно запустить и напрямую. */}
        {game.sourceKind === "exe" || game.ways.includes("direct") ? (
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-title">{t.settings.editor.args}</span>
              <span className="settings-row-hint">
                {game.way === "direct" ? t.settings.editor.argsHint : t.settings.editor.argsDirectOnly}
              </span>
            </div>
            <div className="settings-row-control">
              <input
                className="input editor-input"
                aria-label={t.settings.editor.args}
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder={t.settings.editor.argsPlaceholder}
              />
              <button
                type="button"
                className="button"
                disabled={busy || args === game.args}
                onClick={() => void run(() => api.updateGame({ gameId: game.id, args }))}
              >
                {t.settings.save}
              </button>
            </div>
          </div>
        ) : (
          <p className="settings-row-hint">
            {t.settings.editor.argsUnavailable(t.settings.launchKind[game.sourceKind])}
          </p>
        )}
      </details>
    </>
  );
}
