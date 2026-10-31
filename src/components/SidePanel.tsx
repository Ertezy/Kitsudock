import { useEffect, useRef, useState } from "react";
import PromoCodes from "./panel/PromoCodes";
import Banners from "./panel/Banners";
import Videos from "./panel/Videos";
import Skeleton from "./panel/Skeleton";
import EmptyState from "./EmptyState";
import { codesFor, emptyArt, emptyReason, linkable, panelIsEmpty, sourceLabel, videosFor } from "../lib/panel";
import { entryEnded, hubChanged, isEntryAnimation, panelMounted, skeletonShown } from "../lib/panelEntry";
import { hubFreshness } from "../lib/time";
import { api } from "../lib/api";
import { availableUpdate, startUpdate, updateFailed, updateRow, type UpdateAttempt } from "../lib/update";
import { useLang, useT } from "../i18n";
import { errorText } from "../i18n/errors";
import { useVideoLanguage } from "../lib/videoLanguage";
import type { HubData } from "../types";

interface Props {
  hub: HubData | null;
  /** Игра, выбранная в доке. Коды, баннеры и видео — только по ней. */
  selectedContentId: string | null;
  /** Название выбранной игры; null — игр нет вовсе. Нужно пустой панели:
   *  сказать, что игр нет, или что для этой игры данных нет. */
  selectedTitle: string | null;
  /** Список игр не загрузился (над артом при этом баннер ошибки). Пустая
   *  панель тогда не говорит «игр нет»: игры есть, их просто не прочитали. */
  gamesFailed: boolean;
  /** Открыть экран настроек — вызывается по клику на шестерёнку. */
  onOpenSettings: () => void;
  /** Версия работающего приложения; null — ещё не узнали. */
  appVersion: string | null;
}

const DAY = 86400;

/** Как часто пересчитывается «сейчас». */
const TICK_MS = 30_000;

export default function SidePanel({ hub, selectedContentId, selectedTitle, gamesFailed, onOpenSettings, appVersion }: Props) {
  const lang = useLang();
  const t = useT();
  const videoLang = useVideoLanguage();

  // Часы держатся в состоянии, а не вычисляются при отрисовке.
  //
  // Иначе таймеры замерзают: «сгорит через 3 ч 52 мин» висит неизменным, пока
  // человек не кликнет что-нибудь ещё, и код, сгоревший час назад, продолжает
  // предлагать себя. Полминуты достаточно: самая мелкая величина, которую мы
  // показываем, — минуты.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [updateAttempt, setUpdateAttempt] = useState<UpdateAttempt | null>(null);
  const updateAttemptRef = useRef<UpdateAttempt | null>(null);

  useEffect(() => {
    const id = window.setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      TICK_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  // Вход разделов (`lib/panelEntry.ts`): лесенкой — при появлении панели и
  // когда данные пришли впервые, но не от каждого их обновления. Пришли
  // данные — состояние поправляется прямо в отрисовке, а не эффектом: разделы
  // должны появиться в разметке уже с отметкой входа, а не кадром позже.
  const loaded = hub !== null;
  const [entry, setEntry] = useState(() => panelMounted(loaded));
  const nextEntry = hubChanged(entry, loaded);
  if (nextEntry !== entry) setEntry(nextEntry);

  // Вход кончается, когда доиграли его анимации: снятая раньше отметка
  // оборвала бы их на середине, оставленная — подняла бы раздел, появившийся
  // потом при смене игры. Длительность здесь не пишется — её знают только
  // стили (переменные движения), поэтому ждём сами анимации. Без них (тумблер
  // «Анимация» выключен) вход кончается сразу. Смена игры посреди входа
  // собирает их заново: у новой игры могли появиться свои разделы.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (entry.kind === null || !panel) return;
    const run = entry.run;
    let alive = true;
    const running = panel
      .getAnimations({ subtree: true })
      .filter((a) => a instanceof CSSAnimation && isEntryAnimation(a.animationName));
    // Прерванная анимация (тумблер выключили посреди входа) тоже конец.
    void Promise.allSettled(running.map((a) => a.finished)).then(() => {
      if (alive) setEntry((e) => entryEnded(e, run));
    });
    return () => {
      alive = false;
    };
  }, [entry.kind, entry.run, selectedContentId]);

  const age = hub ? nowSec - hub.updatedAt : 0;

  // Старше недели — коды и баннеры прячутся целиком. Код, который наверняка
  // сгорел, и баннер, который наверняка кончился, хуже, чем их отсутствие:
  // таймер на протухших данных — это враньё в лицо.
  const tooOld = hub !== null && age > 7 * DAY;

  const selected = (gameId: string) => gameId === selectedContentId;

  const codes = !hub || tooOld ? [] : codesFor(hub.codes, selectedContentId);
  const banners = !hub || tooOld ? [] : hub.banners.filter((b) => selected(b.gameId));
  // Видео остаются даже на протухших данных: устаревший список роликов
  // просто устаревший, он никого не обманывает.
  const videos = !hub || selectedContentId === null ? [] : videosFor(hub.videos, selectedContentId, videoLang);
  // Хаб ещё не пришёл (null) — это не то же самое, что «пришёл и пуст»:
  // тихая пауза до первого ответа, а не сообщение «кодов нет», которое
  // тут же сменится настоящими данными и будет выглядеть как ложная тревога.
  const empty = hub !== null && panelIsEmpty(codes, banners, videos, nowSec);
  // Пустая панель говорит, почему пуста и что с этим сделать.
  const reason = emptyReason({
    hasGame: selectedTitle !== null,
    contentId: selectedContentId,
    linkable: linkable(hub, selectedTitle),
    tooOld,
    listFailed: gamesFailed,
  });
  const EMPTY = {
    listFailed: [t.panel.listFailedTitle, t.panel.listFailedHint],
    noGames: [t.panel.noGamesTitle, t.panel.noGamesHint],
    unlinked: [t.panel.unlinkedTitle, t.panel.unlinkedHint],
    uncollected: [t.panel.unlinkedTitle, t.panel.uncollectedHint],
    stale: [t.panel.panelEmpty, t.panel.emptyStaleHint],
    quiet: [t.panel.panelEmpty, t.panel.emptyQuietHint],
  } as const;
  const [emptyTitle, emptyHint] = EMPTY[reason];

  // Источник данных обязан быть виден в интерфейсе.
  // Без него невозможно отличить «сеть отвалилась, показываю прошлогодний
  // комплект» от «всё свежее», а это первое, что спросят при разборе жалобы.
  const origin = sourceLabel(hub?._source, t);
  // Вышла версия новее этой — строка внизу панели: «Обновить», загрузка или
  // отказ (`lib/update.ts`, `updateRow`).
  const update = availableUpdate(hub, appVersion);
  const updateLine = updateRow(update, updateAttempt);
  const installUpdate = () => {
    // Два щелчка подряд успевают раньше перерисовки, поэтому решает
    // попытка из ref, а не из состояния отрисовки.
    const attempt = startUpdate(update, updateAttemptRef.current);
    if (attempt === null) return;
    const settle = (next: UpdateAttempt) => {
      updateAttemptRef.current = next;
      setUpdateAttempt(next);
    };
    settle(attempt);
    // Удачная установка не отвечает: установщик закрывает приложение и сам
    // запускает новую версию. Ответ бывает только отказом.
    api.installUpdate().catch((e: unknown) => settle(updateFailed(attempt, errorText(t, e))));
  };

  return (
    <aside className="panel" ref={panelRef} data-entry={entry.kind ?? undefined}>
      {/* Секции прокручиваются внутри себя, шестерёнка остаётся прибитой
          к низу. Пока данных нет, на месте секций стоят
          заглушки, а область помечена занятой. */}
      <div className="panel-scroll" aria-busy={!loaded}>
        {skeletonShown(loaded, selectedContentId) && <Skeleton />}
        {hub && <PromoCodes codes={codes} games={hub.games} nowSec={nowSec} />}
        <Banners banners={banners} nowSec={nowSec} />
        <Videos videos={videos} nowSec={nowSec} />
        {empty && <EmptyState className="panel-empty" title={emptyTitle} hint={emptyHint} art={emptyArt(reason)} />}
      </div>

      <div className="panel-foot">
        {/* Шестерёнка без подписи: значок узнаётся сам, а название есть во
            всплывающей подсказке и для экранного диктора. Зубцы — пунктир
            толстой обводки круга, без чужих иконок и зависимостей. */}
        <button
          type="button"
          className="panel-gear"
          onClick={onOpenSettings}
          aria-label={t.panel.settingsAndGames}
          title={t.panel.settingsAndGames}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="12"
              cy="12"
              r="8.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeDasharray="2.6 3.84"
            />
            <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="2.3" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
        {/* Одна строка во всех трёх видах: смена вида не сдвигает панель.
            Пока идёт загрузка, кнопки нет вовсе — нажать второй раз нечего. */}
        {updateLine && (
          <div className="panel-update" aria-live="polite">
            {updateLine.stage === "offer" && (
              <>
                {t.panel.updateAvailable(updateLine.version)}
                {" · "}
                <button type="button" className="link-button" onClick={installUpdate}>
                  {t.panel.update}
                </button>
              </>
            )}
            {updateLine.stage === "installing" && t.panel.updating}
            {updateLine.stage === "failed" && (
              <>
                <span title={updateLine.reason}>{t.panel.updateFailed}</span>
                {" · "}
                <button type="button" className="link-button" onClick={() => void api.openSafeUrl(updateLine.url)}>
                  {t.panel.download}
                </button>
              </>
            )}
          </div>
        )}
        {hub && (
          <div className="panel-stale">
            {hubFreshness(hub.updatedAt, nowSec, lang)}
            {origin && ` · ${origin}`}
          </div>
        )}
        {/* Материалы принадлежат издателям игр — так помечают себя все
            фанатские источники, из которых мы берём данные. */}
        <div className="panel-disclaimer">{t.panel.disclaimer}</div>
      </div>
    </aside>
  );
}
