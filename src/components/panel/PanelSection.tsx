import { createContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { api } from "../../lib/api";
import { collapse, useCollapsed } from "../../lib/collapse";
import { useT } from "../../i18n";

/** Раздел свёрнут: часики внутри стоят и встают по часам заново, когда он
 *  развернётся (`DeadlineClock`). */
export const FoldedContext = createContext(false);

interface Props {
  part: "codes" | "banners" | "videos";
  title: string;
  /** Счётчик в заголовке; нет — заголовок без числа. */
  count?: number;
  children: ReactNode;
}

/**
 * Раздел боковой панели со сворачиванием. Вся строка заголовка — кнопка:
 * название, счётчик и шеврон. Свёрнутое общее для всех игр и переживает
 * перезапуск (`lib/collapse.ts`).
 *
 * Высота содержимого уходит в ноль плавно (строка сетки обёртки, стили), а
 * само содержимое тает. Свёрнутое сразу недоступно для Tab и диктора
 * (`inert`): оно уже тает, и нажимать в нём нечего.
 */
export default function PanelSection({ part, title, count, children }: Props) {
  const t = useT();
  const id = useId();
  const collapsed = useCollapsed(part);
  const inner = useRef<HTMLDivElement>(null);

  // До отрисовки кадра: свёрнутое при запуске ни на миг не ловит Tab.
  useLayoutEffect(() => {
    if (inner.current) inner.current.inert = collapsed;
  }, [collapsed]);

  return (
    <section className="panel-section">
      <div className="panel-label">
        <button
          type="button"
          className="panel-toggle"
          aria-expanded={!collapsed}
          aria-controls={id}
          aria-label={collapsed ? t.panel.expand[part] : t.panel.collapse[part]}
          // Имя кнопки — действие; число в заголовке диктор читает следом.
          aria-describedby={count !== undefined ? `${id}-count` : undefined}
          onClick={() => collapse(part, !collapsed, api.setCollapsed)}
        >
          <span>{title}</span>
          <span className="panel-toggle-end">
            {count !== undefined && <span id={`${id}-count`}>{count}</span>}
            <span className="panel-chevron" aria-hidden="true" />
          </span>
        </button>
      </div>
      <div className={collapsed ? "panel-fold is-collapsed" : "panel-fold"} id={id}>
        <div className="panel-fold-inner" ref={inner}>
          <FoldedContext.Provider value={collapsed}>{children}</FoldedContext.Provider>
        </div>
      </div>
    </section>
  );
}
