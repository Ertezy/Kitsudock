import { useEffect, useRef, useState } from "react";
import PromoCodes from "./panel/PromoCodes";
import Banners from "./panel/Banners";
import Videos from "./panel/Videos";
import Skeleton from "./panel/Skeleton";
import EmptyState from "./EmptyState";
import { codesFor, emptyReason, panelIsEmpty, sourceLabel, videosFor } from "../lib/panel";
import { entryEnded, hubChanged, isEntryAnimation, panelMounted, skeletonShown } from "../lib/panelEntry";
import { hubFreshness } from "../lib/time";
import { api } from "../lib/api";
import { availableUpdate } from "../lib/update";
import { useLang, useT } from "../i18n";
import { useVideoLanguage } from "../lib/videoLanguage";
import type { HubData } from "../types";

interface Props {
  hub: HubData | null;
  /** Игра, выбранная в доке. Коды, баннеры и видео — только по ней. */
  selectedContentId: string | null;
  /** Открыть экран настроек — вызывается по клику на шестерёнку. */
  onOpenSettings: () => void;
  /** Версия работающего приложения; null — ещё не узнали. */
  appVersion: string | null;
}

const DAY = 86400;

/** Как часто пересчитывается «сейчас». */
const TICK_MS = 30_000;

export default function SidePanel({ hub, selectedContentId, onOpenSettings, appVersion }: Props) {
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
  // таймер на протухших данных — это враньё в лицо (спека §6).
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
  const reason = emptyReason(selectedContentId, tooOld);
  const emptyTitle = reason === "unlinked" ? t.panel.unlinkedTitle : t.panel.panelEmpty;
  const emptyHint =
    reason === "unlinked" ? t.panel.unlinkedHint : reason === "stale" ? t.panel.emptyStaleHint : t.panel.emptyQuietHint;

  // Источник данных виден в интерфейсе — требование общей спеки §9.4.
  // Без него невозможно отличить «сеть отвалилась, показываю прошлогодний
  // комплект» от «всё свежее», а это первое, что спросят при разборе жалобы.
  const origin = sourceLabel(hub?._source, t);
  // Вышла версия новее этой — строка внизу панели (спека 2026-10-01 §2.2).
  const update = availableUpdate(hub, appVersion);

  return (
    <aside className="panel" ref={panelRef} data-entry={entry.kind ?? undefined}>
      {/* Секции прокручиваются внутри себя, шестерёнка остаётся прибитой
          к низу (спека §2.4). Пока данных нет, на месте секций стоят
          заглушки, а область помечена занятой. */}
      <div className="panel-scroll" aria-busy={!loaded}>
        {skeletonShown(loaded, selectedContentId) && <Skeleton />}
        {hub && <PromoCodes codes={codes} games={hub.games} nowSec={nowSec} />}
        <Banners banners={banners} nowSec={nowSec} />
        <Videos videos={videos} nowSec={nowSec} />
        {empty && <EmptyState className="panel-empty" title={emptyTitle} hint={emptyHint} />}
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
        {update && (
          <div className="panel-update">
            {t.panel.updateAvailable(update.version)}
            {" · "}
            <button type="button" className="link-button" onClick={() => void api.openSafeUrl(update.url)}>
              {t.panel.download}
            </button>
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
