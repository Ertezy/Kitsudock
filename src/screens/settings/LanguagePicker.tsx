import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LANGS, LANG_NAMES, type Lang } from "../../i18n/native";

interface Props {
  value: Lang;
  /** Название выбора — для экранного диктора. */
  label: string;
  disabled?: boolean;
  onChange: (next: Lang) => void;
}

/**
 * Выбор языка интерфейса: кнопка с названием текущего языка, под ней плавно
 * раскрывается список всех языков, каждый — на самом себе. Выбор закрывает
 * список; Esc, щелчок мимо и уход фокуса — тоже. Строки — те же, что в панели
 * способа запуска над «Играть» (`LaunchWays`): круглая отметка у выбранного.
 */
export default function LanguagePicker({ value, label, disabled = false, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // Закрытый список не ловит ни Tab, ни экранного диктора.
  useEffect(() => {
    if (panel.current) panel.current.inert = !open;
  }, [open]);

  // Пока идёт сохранение, список не открыть, а открытый закрывается.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) tab.current?.focus({ preventScroll: true });
  };

  // Открытый список: фокус — на выбранный язык; щелчок мимо закрывает.
  useEffect(() => {
    if (!open) return;
    items.current[LANGS.indexOf(value)]?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
    // Подписка живёт, пока список открыт; `close` меняется каждую отрисовку.
  }, [open]);

  const choose = (next: Lang) => {
    close(true);
    if (next !== value) onChange(next);
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
    const last = LANGS.length - 1;
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
      className={open ? "lang-picker is-open" : "lang-picker"}
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={tab}
        type="button"
        className="lang-switch"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${LANG_NAMES[value]}`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {/* `lang` у названия — чтобы иероглифы взялись из шрифта своего языка. */}
        <span lang={value}>{LANG_NAMES[value]}</span>
        <span className="lang-arrow" aria-hidden="true">
          ▾
        </span>
      </button>
      <div className={open ? "lang-panel is-open" : "lang-panel"} ref={panel} id={id} role="menu" aria-label={label}>
        {LANGS.map((l, i) => (
          <button
            key={l}
            ref={(el) => {
              items.current[i] = el;
            }}
            type="button"
            className="ways-item"
            role="menuitemradio"
            aria-checked={l === value}
            lang={l}
            onClick={() => choose(l)}
          >
            <span className="ways-mark" aria-hidden="true" />
            <span>{LANG_NAMES[l]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
