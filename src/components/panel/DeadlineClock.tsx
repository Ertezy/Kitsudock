import { clockArc } from "../../lib/time";

/** Радиус кольца в поле рисунка 20×20 и длина окружности по нему. */
const R = 8;
const LENGTH = 2 * Math.PI * R;

interface Props {
  /** Доля оставшегося срока, 0..1 (`codeShareLeft`, `bannerShareLeft` в `lib/time.ts`). */
  share: number;
  /** Последние сутки: кольцо цвета горящей карточки, стрелка бежит быстрее. */
  hot: boolean;
}

/**
 * Маленькие часики слева от срока кода или остатка баннера (спека полировки,
 * §8.3). Кольцо — доля оставшегося срока: дуга идёт по часовой стрелке от
 * двенадцати и убывает к концу срока; стрелка спокойно бежит по кругу.
 *
 * Часики только дублируют текст срока картинкой: текст рядом не меняется, а
 * экранному диктору они не нужны. Кольцо обновляется с часами панели
 * (`nowSec` в `SidePanel`), своих таймеров нет; стрелку крутят стили.
 *
 * Стрелка — отдельный рисунок поверх кольца: стили поворачивают его целиком,
 * и кольцо под ним не перерисовывается на каждом кадре.
 */
export default function DeadlineClock({ share, hot }: Props) {
  const arc = clockArc(share) * LENGTH;
  return (
    <span className={hot ? "clock is-hot" : "clock"} aria-hidden="true">
      <svg className="clock-face" viewBox="0 0 20 20">
        <circle className="clock-track" cx="10" cy="10" r={R} />
        {/* Окружность начинается на трёх часах и идёт по часовой: поворот на
            четверть назад ставит начало дуги на двенадцать. */}
        <circle className="clock-arc" cx="10" cy="10" r={R} strokeDasharray={`${arc} ${LENGTH}`} transform="rotate(-90 10 10)" />
      </svg>
      <svg className="clock-hand" viewBox="0 0 20 20">
        <line x1="10" y1="10" x2="10" y2="4.4" />
      </svg>
    </span>
  );
}
