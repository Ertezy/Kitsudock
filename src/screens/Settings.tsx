import { useEffect, useLayoutEffect, useRef, useState } from "react";
import GamesSection from "./settings/GamesSection";
import LookSection from "./settings/LookSection";
import SmallSections from "./settings/SmallSections";
import { useSlots } from "./settings/useSlots";
import { pillPlacement } from "../lib/pill";
import { useT } from "../i18n";

type Tab = "games" | "look" | "behaviour" | "data" | "about";

interface Props {
  onClose: () => void;
}

export default function Settings({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("games");
  const t = useT();
  const tabs = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const TABS: { id: Tab; label: string }[] = [
    { id: "games", label: t.settings.tabs.games },
    { id: "look", label: t.settings.tabs.look },
    { id: "behaviour", label: t.settings.tabs.behaviour },
    { id: "data", label: t.settings.tabs.data },
    { id: "about", label: t.settings.tabs.about },
  ];

  // Подложка выбранной вкладки одна на весь ряд и скользит к новой вкладке
  // (`lib/pill.ts`), как метка выбранной игры в доке. Ряд вкладок — свой
  // элемент: замер идёт от его начала, и кнопка «Назад» над ним на место
  // подложки не влияет. Нужны только сдвиг и высота вкладки: ширину подложка
  // берёт у ряда, растяжение ей не нужно.
  const slots = useSlots(tabs, ":scope > .settings-tab", "y", TABS.map((tb) => tb.label).join("\n"));
  const pill = slots && pillPlacement(slots, TABS.findIndex((tb) => tb.id === tab));

  // Экран открылся по шестерёнке, и она пропала вместе с главным экраном —
  // фокус встаёт на выбранную вкладку, а не теряется в начале страницы. Если
  // фокус уже где-то стоит, его не трогаем.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    tabs.current?.querySelector<HTMLElement>(".settings-tab.active")?.focus({ preventScroll: true });
  }, []);

  // Новая вкладка начинается сверху: её содержимое поднимается на место, а
  // прокрутка прежней вкладки к ней отношения не имеет. До отрисовки — без
  // кадра со старой прокруткой.
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [tab]);

  return (
    <div className="settings">
      <nav className="settings-nav">
        <button type="button" className="settings-back" onClick={onClose}>
          {t.settings.back}
        </button>
        <div className="settings-tabs" ref={tabs}>
          {pill && (
            <span
              className="settings-tab-pill"
              aria-hidden="true"
              style={{ "--pill-y": `${pill.offset}px`, "--pill-size": `${pill.size}px` } as React.CSSProperties}
            />
          )}
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={tb.id === tab ? "settings-tab active" : "settings-tab"}
              aria-current={tb.id === tab ? "page" : undefined}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Каждый раздел — свой корневой элемент: при смене вкладки он появляется
          заново и поднимается на место (`.settings-body > *` в стилях). */}
      <div className="settings-body" ref={body}>
        {tab === "games" && <GamesSection />}
        {tab === "look" && <LookSection />}
        {tab !== "games" && tab !== "look" && <SmallSections tab={tab} />}
      </div>
    </div>
  );
}
