import { api } from "../../lib/api";
import CachedImage from "./CachedImage";
import PanelSection from "./PanelSection";
import { plainSpaces } from "../../lib/panel";
import { timeAgo } from "../../lib/time";
import { useLang, useT } from "../../i18n";
import type { Video } from "../../types";

interface Props {
  /** Уже отфильтрованы по выбранной игре. */
  videos: Video[];
  nowSec: number;
}

/** Сколько роликов показываем на игру. Лента отдаёт пятнадцать. */
const SHOWN = 6;

/** Длительность в «м:сс». */
function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Videos({ videos, nowSec }: Props) {
  const lang = useLang();
  const t = useT();
  const shown = [...videos]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, SHOWN);

  if (shown.length === 0) return null;

  return (
    <PanelSection part="videos" title={t.panel.videos}>
      {shown.map((v) => (
        <div
          key={v.url}
          className="video-card"
          role="button"
          tabIndex={0}
          onClick={() => void api.openSafeUrl(v.url).catch(() => undefined)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void api.openSafeUrl(v.url).catch(() => undefined);
            }
          }}
        >
          <div className="video-thumb-wrap">
            <CachedImage className="video-thumb" url={v.thumb} fallbackText={plainSpaces(v.title)} />
            {/* Значок рисуется только когда данные есть: лента RSS не даёт
                ни длительности, ни отметки премьеры. */}
            {v.premiere ? (
              <span className="video-badge premiere">{t.panel.premiere}</span>
            ) : v.duration !== null ? (
              <span className="video-badge">{duration(v.duration)}</span>
            ) : null}
          </div>
          <div className="video-title">{plainSpaces(v.title)}</div>
          <div className="video-meta">{timeAgo(v.publishedAt, nowSec, lang)}</div>
        </div>
      ))}
    </PanelSection>
  );
}
