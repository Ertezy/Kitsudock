import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../i18n";
import type { WayChoice } from "../lib/launch";
import type { LaunchWay } from "../types";

interface Props {
  /** Строки переключателя (`wayChoices`), их всегда больше одной. */
  choices: WayChoice[];
  onChoose: (way: LaunchWay) => void;
  /** Панель открылась (на сколько пикселей подняться всему над язычком) или
   *  закрылась (`null`). */
  onShift: (px: number | null) => void;
}

/**
 * Язычок под кнопкой «Играть» с текущим способом запуска и панель над ним со
 * всеми способами. Выбор закрывает панель; Esc и щелчок мимо — тоже. Фокус
 * после закрытия с клавиатуры возвращается на язычок.
 */
export default function LaunchWays({ choices, onChoose, onShift }: Props) {
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
    // Низ панели стоит на месте низа кнопки, а `offsetTop` не учитывает
    // `transform`: минус он и есть высота панели вместе с зазором до кнопки.
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
      // Фокус ушёл за пределы язычка и панели (Tab дальше) — панель закрывается.
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
      <button
        ref={tab}
        type="button"
        className="ways-tab"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t.main.launch.way.tab(current.label)}
        onClick={() => (open ? close(false) : openPanel())}
      >
        <span className="ways-tab-label">{current.label}</span>
        <span className="ways-arrow" aria-hidden="true">
          ▴
        </span>
      </button>
    </div>
  );
}
