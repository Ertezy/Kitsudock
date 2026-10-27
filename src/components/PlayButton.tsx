import { useEffect, useReducer, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../i18n";
import { errorText } from "../i18n/errors";
import { useMotionOn } from "../lib/motion";
import { ART_WAIT_MS, playAreaWaiting } from "../lib/playArea";
import { LAUNCH_HOLD_MS, launchHeld } from "../lib/launchHold";
import { useWindowActive, windowActive } from "../lib/windowActive";
import type { LaunchResult } from "../types";

interface Props {
  gameId: string;
  /** Подпись над кнопкой: откуда запустится игра (`launchNote`). */
  note: string;
  onLaunch: () => Promise<LaunchResult>;
  /** Путь починили — родителю нужно перечитать список игр, чтобы ошибка
   *  и значок пропажи исчезли. */
  onFixed: () => void;
  disabled?: boolean;
  /** Ошибка запуска из меню трея — показывается так же, как ошибка кнопки.
   *  `id` растёт с каждым новым провалом трея: без него повторный провал
   *  того же текста не отличался бы от предыдущего и эффект ниже не сработал
   *  бы повторно. */
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

  // После удачного запуска «Запускаю…» держится, пока фокус не заберёт игра
  // или окно не уйдёт в трей, но не дольше потолка (`lib/launchHold.ts`):
  // иначе надпись мелькала бы, а игру запускали бы дважды.
  const active = useWindowActive();
  const [held, dispatch] = useReducer(launchHeld, false);
  useEffect(() => dispatch({ kind: "windowActive", active }), [active]);
  useEffect(() => {
    if (!held) return;
    const timer = window.setTimeout(() => dispatch({ kind: "capped" }), LAUNCH_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [held]);
  const launching = busy || held;

  const click = async () => {
    setBusy(true);
    setFailure(null);
    const result = await onLaunch();
    if (!result.ok) setFailure(result.msg);
    // Активность — сейчас, а не из отрисовки, где нажали: за время запроса
    // фокус могла забрать игра, а окно — уйти в трей.
    dispatch({ kind: "answered", ok: result.ok, windowActive: windowActive() });
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
        className={launching ? "play launching" : "play"}
        disabled={launching || fixing || disabled}
        aria-busy={launching || undefined}
        onClick={() => void click()}
      >
        {/* Блик «запускается…» — только пока идёт запуск: появляется вместе с
            состоянием и начинает проход с начала, а не с середины. */}
        {launching && <span className="play-sheen" aria-hidden="true" />}
        {/* Обе надписи всегда в разметке, видна одна: кнопка шириной с
            длинную и не прыгает, когда «Играть» сменяется на «Запускаю…».
            Спрятанную стили убирают и от экранного диктора. */}
        <span className="play-label">
          <span className={launching ? "is-off" : undefined}>{t.main.play}</span>
          <span className={launching ? undefined : "is-off"}>{t.main.launching}</span>
        </span>
      </button>
    </div>
  );
}
