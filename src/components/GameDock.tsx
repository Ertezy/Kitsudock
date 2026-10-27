import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { motionOn, subscribeMotion } from "../lib/motion";
import { glassScale, nearness, shifts } from "../lib/dock";
import { useT } from "../i18n";
import type { GameView } from "../types";

interface Props {
  games: GameView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Докуда достаёт увеличение, в пикселях от курсора до центра иконки. */
const REACH = 110;

/** Цвет заглушки выводится из названия устойчиво: одна и та же игра всегда
 *  получает один и тот же цвет, и соседние игры не сливаются. */
function tintOf(title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 42% 34%)`;
}

/** Ряд в покое: центры иконок, левый край ряда на экране, полный прирост одной
 *  иконки и ширина подложки — всё в точках. */
interface Rest {
  centres: number[];
  left: number;
  grow: number;
  glassWidth: number;
}

/** Близость к курсору по иконкам и растяжение подложки под неё. */
interface Zoom {
  near: number[];
  glass: number;
}

const REST_ZOOM: Zoom = { near: [], glass: 1 };

/* Ряд меряется по раскладке (`offsetLeft`), а не по `getBoundingClientRect`:
   тот учитывает растяжение и сдвиг, и ряд, пойманный посреди возврата в покой,
   дал бы кривые центры на всё наведение. Раскладка от увеличения больше не
   меняется (оно — растяжение, а не размер), так что эти числа верны всё время,
   пока курсор над доком. Размер иконки и кратность увеличения живут в стилях
   (`--dock-size`, `--dock-zoom`); отсюда они только читаются. */
function measure(dock: HTMLElement, glass: HTMLElement | null): Rest {
  const items = Array.from(dock.querySelectorAll<HTMLElement>(".dock-item"));
  const size = items[0]?.querySelector<HTMLElement>(".dock-icon")?.offsetWidth ?? 0;
  const zoom = Number.parseFloat(getComputedStyle(dock).getPropertyValue("--dock-zoom")) || 1;
  return {
    centres: items.map((el) => el.offsetLeft + el.offsetWidth / 2),
    left: dock.getBoundingClientRect().left + dock.clientLeft,
    grow: size * (zoom - 1),
    glassWidth: glass?.offsetWidth ?? 0,
  };
}

export default function GameDock({ games, selectedId, onSelect }: Props) {
  const dockRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom>(REST_ZOOM);
  const rest = useRef<Rest | null>(null);
  const t = useT();

  const onLeave = useCallback(() => {
    rest.current = null;
    setZoom(REST_ZOOM);
  }, []);

  // Список игр сменился — ряд надо мерить заново.
  useEffect(() => {
    rest.current = null;
  }, [games]);

  // Тумблер «Анимация» могли выключить, пока курсор стоит над доком без
  // движения: `onMove` в таком случае больше не позовут, и увеличенные иконки
  // застряли бы такими до следующего шевеления мыши. Подписка возвращает их в
  // покой сразу же, а не ждёт следующего движения.
  useEffect(() => {
    return subscribeMotion((on) => {
      if (!on) onLeave();
    });
  }, [onLeave]);

  /* Только на стилях это не делается, и это ограничение, а не выбор: CSS умеет
     дотянуться до следующего соседа, но не до предыдущего, и увеличение
     раздувало бы иконки только справа от курсора. Поэтому расстояние от
     курсора до центра каждой иконки, а с ним и сдвиг соседей, считаются здесь
     (`lib/dock.ts`).

     Близость считается от центров ряда в покое, а не от того места, куда
     иконки уехали, раздвигаясь: иначе на следующем движении центры оказались
     бы другими, от них другие расстояния, от тех другие сдвиги — погоня за
     собственным хвостом. От центров в покое близость — простая функция от
     положения курсора, и дрожать ей не с чего. */
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!motionOn()) return;
    const dock = dockRef.current;
    if (!dock) return;
    if (rest.current === null) rest.current = measure(dock, glassRef.current);
    const { centres, left, grow, glassWidth } = rest.current;
    const near = nearness(centres, e.clientX - left + dock.scrollLeft, REACH);
    setZoom({ near, glass: glassScale(near, grow, glassWidth) });
  }, []);

  if (games.length === 0) return null;

  const shift = shifts(zoom.near);
  const selected = games.findIndex((g) => g.id === selectedId);

  return (
    <div className="dock-wrap">
      <div
        className="dock-bg"
        ref={glassRef}
        style={{ "--glass-scale": zoom.glass } as React.CSSProperties}
        aria-hidden="true"
      />
      <div className="dock" ref={dockRef} onMouseMove={onMove} onMouseLeave={onLeave}>
        {games.map((g, i) => {
          // Насколько иконка вырастет и уедет вбок, решают стили: сюда уходят
          // только близость к курсору и сдвиг в долях прироста, а размер и
          // кратность увеличения живут в таблице стилей рядом с теми
          // правилами, которым они тоже нужны.
          const style = { "--near": zoom.near[i] ?? 0, "--shift": shift[i] ?? 0 } as React.CSSProperties;
          return (
            <button
              key={g.id}
              className={`dock-item${g.missing ? " missing" : ""}`}
              style={style}
              onClick={() => onSelect(g.id)}
              title={g.missing ? t.main.dockFileMissing(g.title) : g.title}
              aria-current={i === selected ? "true" : undefined}
            >
              <span className="dock-name">{g.title}</span>
              {/* Обёртка приподнимается при наведении и вдавливается при
                  нажатии, сама иконка внутри растёт от близости курсора: у
                  этих движений разные кривые, и на одном элементе они бы
                  делили одну. */}
              <span className="dock-lift">
                {g.iconPath ? (
                  <img className="dock-icon" src={convertFileSrc(g.iconPath)} alt="" />
                ) : (
                  <span className="dock-icon dock-letter" style={{ background: tintOf(g.title) }}>
                    {g.title.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {/* Метка выбранной игры — одна на весь ряд, а не точка у каждой
            иконки: при смене игры она скользит к новой, а не перепрыгивает. */}
        {selected >= 0 && (
          <span
            className="dock-mark"
            style={{ "--i": selected, "--shift": shift[selected] ?? 0 } as React.CSSProperties}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}
