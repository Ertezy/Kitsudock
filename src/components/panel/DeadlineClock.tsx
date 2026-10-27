import { useEffect, useRef, useState } from "react";
import { clockHandDelay } from "../../lib/clockHand";
import { useMotionOn } from "../../lib/motion";
import { clockArc } from "../../lib/time";
import { useWindowActive } from "../../lib/windowActive";

/** Радиус кольца в поле рисунка 20×20 и длина окружности по нему. */
const R = 8;
const LENGTH = 2 * Math.PI * R;

interface Props {
  /** Доля оставшегося срока, 0..1 (`codeShareLeft`, `bannerShareLeft` в `lib/time.ts`). */
  share: number;
  /** Последние сутки: кольцо цвета горящей карточки, стрелка прыгает чаще. */
  hot: boolean;
}

/**
 * Маленькие часики слева от срока кода или остатка баннера. Кольцо — доля
 * оставшегося срока: дуга идёт по часовой стрелке от двенадцати и убывает к
 * концу срока; стрелка прыгает по четвертям круга.
 *
 * Часики только дублируют текст срока картинкой: текст рядом не меняется, а
 * экранному диктору они не нужны. Кольцо обновляется с часами панели
 * (`nowSec` в `SidePanel`), своих таймеров нет; стрелку крутят стили.
 *
 * Стрелка — отдельный рисунок поверх кольца: стили поворачивают его целиком,
 * и кольцо под ним не перерисовывается на каждом кадре. Все стрелки идут в
 * ногу (`lib/clockHand.ts`), когда бы ни появились.
 */
export default function DeadlineClock({ share, hot }: Props) {
  const arc = clockArc(share) * LENGTH;
  // Стрелка встаёт по часам заново, когда её анимация начинается заново или
  // стояла: тумблер «Анимация» снова включён, окно снова активно. Стоявшая в
  // неактивном окне стрелка отстаёт от часов компьютера, и новая, вставшая по
  // ним, шла бы не в ногу с ней. Поэтому, когда окно возвращается, все стрелки
  // встают по часам заново и один раз перескакивают на общее место.
  const active = useWindowActive();
  const motion = useMotionOn();
  return (
    <span className={hot ? "clock is-hot" : "clock"} aria-hidden="true">
      <svg className="clock-face" viewBox="0 0 20 20">
        <circle className="clock-track" cx="10" cy="10" r={R} />
        {/* Окружность начинается на трёх часах и идёт по часовой: поворот на
            четверть назад ставит начало дуги на двенадцать. */}
        <circle className="clock-arc" cx="10" cy="10" r={R} strokeDasharray={`${arc} ${LENGTH}`} transform="rotate(-90 10 10)" />
      </svg>
      <ClockHand key={`${active}:${motion}`} hot={hot} />
    </span>
  );
}

/**
 * Стрелка. Её анимация начинается с появлением, и общая фаза считается от этого
 * мига: сначала — от отрисовки, а когда анимация действительно пошла, — от её
 * настоящего начала. Между ними кадр-другой, а при запуске приложения и
 * больше; у горячей стрелки, которая прыгает каждые 0.7 с, это были
 * бы заметные градусы рядом с соседней.
 */
function ClockHand({ hot }: { hot: boolean }) {
  const [start] = useState(() => Date.now());
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const hand = ref.current;
    // Тумблер выключен — анимации нет; окно неактивно — она стоит, и начала у
    // неё нет: стрелка встанет заново, когда окно вернётся.
    const animation = hand?.getAnimations()[0];
    if (!hand || !animation) return;
    let alive = true;
    animation.ready.then(
      () => {
        if (!alive || animation.startTime === null) return;
        hand.style.animationDelay = clockHandDelay(performance.timeOrigin + Number(animation.startTime), hot);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [hot]);
  return (
    <svg ref={ref} className="clock-hand" viewBox="0 0 20 20" style={{ animationDelay: clockHandDelay(start, hot) }}>
      <line x1="10" y1="10" x2="10" y2="4.4" />
    </svg>
  );
}
