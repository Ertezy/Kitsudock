import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../i18n";
import { errorText } from "../i18n/errors";
import { useMotionOn } from "../lib/motion";
import { ART_WAIT_MS, playAreaWaiting } from "../lib/playArea";
import type { LaunchResult } from "../types";

interface Props {
  gameId: string;
  /** Подпись над кнопкой: откуда запустится игра (`launchNote`). */
  note: string;
  onLaunch: () => Promise<LaunchResult>;
  /** Путь починили — родителю нужно перечитать список игр, чтобы ошибка
   *  и значок пропажи исчезли (спека §3.4). */
  onFixed: () => void;
  disabled?: boolean;
  /** Ошибка запуска из меню трея (спека этапа 7 §5) — показывается так же,
   *  как ошибка кнопки. `id` растёт с каждым новым провалом трея: без него
   *  повторный провал того же текста не отличался бы от предыдущего и эффект
   *  ниже не сработал бы повторно (правка финальной ревизии этапа 7). */
  externalFailure?: { id: number; text: string } | null;
  /** Фон игры начал проявляться. С анимацией до этого подпись и кнопка ждут
   *  невидимыми (недолго) и поднимаются вслед за фоном, а не раньше него. */
  artShown: boolean;
}

export default function PlayButton({ gameId, note, onLaunch, onFixed, disabled, externalFailure, artShown }: Props) {
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [waitedEnough, setWaitedEnough] = useState(false);
  const motion = useMotionOn();
  const t = useT();

  // Главное действие надолго не прячется (`lib/playArea.ts`): фон ждут не
  // дольше `ART_WAIT_MS`, а без анимации не ждут вовсе.
  useEffect(() => {
    if (artShown || !motion) return;
    const timer = window.setTimeout(() => setWaitedEnough(true), ART_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [artShown, motion]);
  const waiting = playAreaWaiting(motion, artShown, waitedEnough);

  useEffect(() => {
    if (externalFailure) setFailure(externalFailure.text);
    // Зависимость только от `id`: тот же провал трея не должен переигрывать
    // эффект при каждой перерисовке родителя, а новый — обязан, даже если
    // текст ошибки совпал с прошлым разом.
  }, [externalFailure?.id]);

  const click = async () => {
    setBusy(true);
    setFailure(null);
    const result = await onLaunch();
    if (!result.ok) setFailure(result.msg);
    setBusy(false);
  };

  // Оба способа починки — те же, что уже есть в правке игры в настройках
  // (GameEditor): при успехе список должен перечитаться, чтобы ошибка и
  // значок пропажи исчезли; при провале — показать, что пошло не так.
  const runFix = async (fn: () => Promise<void>) => {
    setFixing(true);
    try {
      await fn();
      setFailure(null);
      onFixed();
    } catch (e) {
      setFailure(errorText(t, e));
    } finally {
      setFixing(false);
    }
  };

  const relocate = () => runFix(() => api.relocateGame(gameId));

  const pickManually = () =>
    runFix(async () => {
      const exe = await api.pickExe();
      if (exe) await api.updateGame({ gameId, exe });
    });

  return (
    <div className={waiting ? "play-area is-waiting" : "play-area"}>
      {failure && (
        <>
          <div className="play-error">{failure}</div>
          <div className="play-fix">
            <button type="button" disabled={fixing} onClick={() => void relocate()}>
              {t.main.relocate}
            </button>
            <button type="button" disabled={fixing} onClick={() => void pickManually()}>
              {t.main.pickManually}
            </button>
          </div>
        </>
      )}
      <div className="play-note">{note}</div>
      <button
        className={busy ? "play launching" : "play"}
        disabled={busy || fixing || disabled}
        aria-busy={busy || undefined}
        onClick={() => void click()}
      >
        {/* Блик «запускается…» — только пока идёт запуск: появляется вместе с
            состоянием и начинает проход с начала, а не с середины. */}
        {busy && <span className="play-sheen" aria-hidden="true" />}
        <span className="play-label">{busy ? t.main.launching : t.main.play}</span>
      </button>
    </div>
  );
}
