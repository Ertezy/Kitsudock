import { useRef } from "react";
import { PILL_BASE, pillPlacement } from "../../lib/pill";
import { useSlots } from "./useSlots";

interface Option<V extends string> {
  value: V;
  label: string;
}

interface Props<V extends string> {
  options: readonly Option<V>[];
  value: V;
  /** Название выбора — для экранного диктора. */
  label: string;
  disabled?: boolean;
  onChange: (next: V) => void;
}

/** Выбор одного из нескольких вариантов кнопками в одну строку — язык
 *  интерфейса и язык видео (спека этапа 6 §5.2).
 *
 *  Выбранный вариант отмечает одна таблетка на весь ряд: при выборе она
 *  переезжает к новому варианту (`lib/pill.ts`). Подпись у варианта в двух
 *  цветах, друг на друге: тёмная на таблетке и приглушённая без неё. Они
 *  сменяют друг друга прозрачностью, пока таблетка едет, — цвет текста не
 *  перескакивает раньше, чем таблетка доехала. */
export default function Segmented<V extends string>({ options, value, label, disabled = false, onChange }: Props<V>) {
  const row = useRef<HTMLDivElement>(null);
  const slots = useSlots(row, ":scope > .segmented-option", "x", options.map((o) => o.label).join("\n"));
  const pill = slots && pillPlacement(slots, options.findIndex((o) => o.value === value));

  return (
    <div ref={row} className={disabled ? "segmented is-disabled" : "segmented"} role="radiogroup" aria-label={label}>
      {/* Появляется уже на месте, после первого замера: появись она раньше, она
          бы приехала к выбранному варианту из начала ряда. */}
      {pill && (
        <span
          className="segmented-pill"
          aria-hidden="true"
          style={{ width: PILL_BASE, "--pill-x": `${pill.offset}px`, "--pill-scale": pill.scale } as React.CSSProperties}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "segmented-option active" : "segmented-option"}
          disabled={disabled}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
        >
          <span className="segmented-label">{o.label}</span>
          {/* Тёмная копия подписи — без текста в разметке: буквы рисуют стили
              (`content: attr(data-label)`), поэтому копия не попадает ни в
              выделение, ни в поиск по странице, ни к экранному диктору. */}
          <span className="segmented-label is-on" data-label={o.label} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
