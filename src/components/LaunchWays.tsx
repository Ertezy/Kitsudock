import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../i18n";
import type { WayChoice } from "../lib/launch";
import type { LaunchWay } from "../types";

interface Props {
  /** Строки переключателя (`wayChoices`), их всегда больше одной. */
  choices: WayChoice[];
  /** Подпись над кнопкой (`launchNote`): она и есть переключатель. */
  note: string;
  onChoose: (way: LaunchWay) => void;
  /** Панель открылась (на сколько пикселей подняться ошибке над подписью) или
   *  закрылась (`null`). */
  onShift: (px: number | null) => void;
}

/**
 * Подпись над кнопкой «Играть» («Запустится напрямую ▴»), которая открывает
 * панель со всеми способами запуска: панель выезжает над подписью, шириной с
 * кнопку. Кнопка при этом стоит на месте. Выбор закрывает панель; Esc, щелчок
 * мимо и уход фокуса — тоже. Фокус после закрытия с клавиатуры возвращается на
 * подпись.
 */
export default function LaunchWays({ choices, note, onChoose, onShift }: Props) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = choices.find((c) => c.selected) ?? choices[0];

  // Закрытая панель не ловит ни Tab, ни экранного диктора: она лишь прозрачна
  // и стоит на месте кнопки.
  useEffect(() => {
    if (panel.current) panel.current.inert = !open;
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    onShift(null);
    if (refocus) tab.current?.focus({ preventScroll: true });
  };

  const openPanel = () => {
    // Низ панели стоит над подписью, а `offsetTop` не учитывает `transform`:
    // минус он и есть высота панели вместе с зазором до подписи.
    onShift(panel.current ? -panel.current.offsetTop : 0);
    setOpen(true);
  };

  // Открытая панель: фокус — на выбранный способ; щелчок мимо закрывает.
  useEffect(() => {
    if (!open) return;
    items.current[choices.indexOf(current)]?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
    // Подписка живёт, пока панель открыта; `close` меняется каждую отрисовку.
  }, [open]);

  const choose = (way: LaunchWay) => {
    if (way !== current.way) onChoose(way);
    close(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const at = items.current.findIndex((el) => el === document.activeElement);
    const last = choices.length - 1;
    const next =
      e.key === "ArrowDown" ? (at < 0 || at === last ? 0 : at + 1)
      : e.key === "ArrowUp" ? (at <= 0 ? last : at - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    items.current[next]?.focus();
  };

  return (
    <div
      className="ways"
      ref={root}
      onKeyDown={onKeyDown}
      // Фокус ушёл за пределы подписи и панели (Tab дальше) — панель закрывается.
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <div
        className={open ? "ways-panel is-open" : "ways-panel"}
        ref={panel}
        id={id}
        role="menu"
        aria-label={t.main.launch.way.list}
      >
        {choices.map((c, i) => (
          <button
            key={c.way}
            ref={(el) => {
              items.current[i] = el;
            }}
            type="button"
            className="ways-item"
            role="menuitemradio"
            aria-checked={c.selected}
            // Имя пункта — название способа, пояснение читается отдельно.
            aria-describedby={c.hint ? `${id}-${c.way}` : undefined}
            onClick={() => choose(c.way)}
          >
            <span className="ways-mark" aria-hidden="true" />
            <span>{c.label}</span>
            {c.hint && (
              <span className="ways-hint" id={`${id}-${c.way}`}>
                {c.hint}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* Имя кнопки — то, что видно, с пояснением, что она выбирает. */}
      <button
        ref={tab}
        type="button"
        className="play-note ways-switch"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t.main.launch.way.tab(note)}
        onClick={() => (open ? close(false) : openPanel())}
      >
        <span>{note}</span>
        <span className="ways-arrow" aria-hidden="true">
          ▴
        </span>
      </button>
    </div>
  );
}
