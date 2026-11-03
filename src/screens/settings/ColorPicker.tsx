import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { isHex, SWATCHES } from "../../lib/theme";

interface Props {
  value: string;
  /** Название цвета — для экранного диктора и подписи. */
  label: string;
  hexLabel: string;
  onChange: (next: string) => void;
}

type Hsv = { h: number; s: number; v: number };

function toHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h =
    d === 0 ? 0
    : max === r ? ((g - b) / d + 6) % 6
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}

function toHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Кружок цвета с кодом рядом; по щелчку плавно раскрывается выбор: квадрат
 * насыщенности и яркости, полоса оттенка, поле кода и готовые цвета. Цвет
 * применяется сразу, пока тянешь. Esc, щелчок мимо и уход фокуса закрывают.
 */
export default function ColorPicker({ value, label, hexLabel, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Оттенок помнится отдельно: у серого и чёрного его нет, и без этого полоса
  // прыгала бы в красный, пока тянешь квадрат к краю.
  const [hsv, setHsv] = useState<Hsv>(() => toHsv(value));
  const [draft, setDraft] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraft(value);
    if (toHex(hsv) !== value) setHsv((was) => ({ ...toHsv(value), h: toHsv(value).s === 0 ? was.h : toHsv(value).h }));
    // Только снаружи пришедший цвет; свой `hsv` здесь не нужен.
  }, [value]);

  useEffect(() => {
    if (panel.current) panel.current.inert = !open;
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const apply = (next: Hsv) => {
    setHsv(next);
    const hex = toHex(next);
    setDraft(hex);
    onChange(hex);
  };

  const drag = (e: ReactPointerEvent<HTMLDivElement>, set: (x: number, y: number) => void) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) =>
      set(clamp((ev.clientX - box.left) / box.width), clamp((ev.clientY - box.top) / box.height));
    at(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      tab.current?.focus({ preventScroll: true });
    }
  };

  return (
    <div
      className={open ? "color-picker is-open" : "color-picker"}
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={tab}
        type="button"
        className="color-switch"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${value}`}
        onClick={() => setOpen(!open)}
      >
        <span className="color-dot" style={{ background: value }} aria-hidden="true" />
        <span className="color-code">{value}</span>
      </button>
      <div className={open ? "color-panel is-open" : "color-panel"} ref={panel} id={id} role="dialog" aria-label={label}>
        <div
          className="color-area"
          style={{ backgroundColor: toHex({ h: hsv.h, s: 1, v: 1 }) }}
          onPointerDown={(e) => drag(e, (x, y) => apply({ h: hsv.h, s: x, v: 1 - y }))}
        >
          <span className="color-area-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
        </div>
        <div className="color-hue" onPointerDown={(e) => drag(e, (x) => apply({ ...hsv, h: Math.min(x * 360, 359.9) }))}>
          <span className="color-hue-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: toHex({ h: hsv.h, s: 1, v: 1 }) }} />
        </div>
        <label className="color-hex">
          <span>{hexLabel}</span>
          <input
            value={draft}
            maxLength={7}
            spellCheck={false}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const next = raw.startsWith("#") ? raw : `#${raw}`;
              setDraft(next);
              if (isHex(next)) {
                setHsv(toHsv(next.toLowerCase()));
                onChange(next.toLowerCase());
              }
            }}
          />
        </label>
        <div className="color-swatches">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              className={s === value ? "color-swatch is-current" : "color-swatch"}
              style={{ background: s }}
              aria-label={s}
              onClick={() => apply(toHsv(s))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
