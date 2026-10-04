import type { CSSProperties } from "react";
import { PALETTES, SCENARIOS, toSearch, type PreviewParams, type Scenario } from "./backend";
import type { Lang } from "../i18n/native";

// Плашка с переключателями стенда: живёт в отдельном корне поверх приложения и
// только на этой странице. Каждый переключатель переписывает параметры адреса и
// перезагружает страницу, поэтому любое состояние стенда — просто ссылка.
// Подписи английские: сторож кириллицы пускает русские буквы только в словарь.

const SCENARIO_LABELS: Record<Scenario, string> = {
  normal: "normal",
  loading: "loading",
  offline: "offline",
  stale: "stale",
  firstRun: "first run",
};

const plaque: CSSProperties = {
  position: "fixed",
  top: 10,
  right: 10,
  zIndex: 2147483647,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255, 255, 255, 0.16)",
  background: "rgba(10, 10, 14, 0.84)",
  backdropFilter: "blur(8px)",
  color: "#e9e7ef",
  font: "11px/1.2 system-ui, 'Segoe UI', sans-serif",
};

const row: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const label: CSSProperties = { opacity: 0.55, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 };
const group: CSSProperties = { display: "flex", gap: 2 };

const pill = (active: boolean): CSSProperties => ({
  font: "inherit",
  padding: "3px 8px",
  borderRadius: 999,
  border: 0,
  cursor: active ? "default" : "pointer",
  background: active ? "#e9e7ef" : "rgba(255, 255, 255, 0.1)",
  color: active ? "#111" : "inherit",
});

interface RowProps<T extends string> {
  name: string;
  options: readonly { value: T; text: string }[];
  value: T;
  onPick: (value: T) => void;
}

function Row<T extends string>({ name, options, value, onPick }: RowProps<T>) {
  return (
    <div style={row}>
      <span style={label}>{name}</span>
      <span style={group} role="group" aria-label={name}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            style={pill(o.value === value)}
            onClick={() => o.value !== value && onPick(o.value)}
          >
            {o.text}
          </button>
        ))}
      </span>
    </div>
  );
}

export default function Controls({ params }: { params: PreviewParams }) {
  const go = (patch: Partial<PreviewParams>) => {
    window.location.search = toSearch({ ...params, ...patch });
  };

  // Настоящая шестерёнка на главном экране; внутри настроек её нет, и та же
  // кнопка возвращает назад.
  const openSettings = () => {
    const target =
      document.querySelector<HTMLElement>(".panel-gear") ?? document.querySelector<HTMLElement>(".settings-back");
    target?.click();
  };

  return (
    <div style={plaque}>
      <Row
        name="scenario"
        options={SCENARIOS.map((s) => ({ value: s, text: SCENARIO_LABELS[s] }))}
        value={params.scenario}
        onPick={(scenario) => go({ scenario })}
      />
      <Row<Lang>
        name="language"
        options={[
          { value: "ru", text: "ru" },
          { value: "en", text: "en" },
        ]}
        value={params.lang}
        onPick={(lang) => go({ lang })}
      />
      <Row<"on" | "off">
        name="motion"
        options={[
          { value: "on", text: "on" },
          { value: "off", text: "off" },
        ]}
        value={params.motion ? "on" : "off"}
        onPick={(motion) => go({ motion: motion === "on" })}
      />
      <Row
        name="palette"
        options={PALETTES.map((p) => ({ value: p, text: p }))}
        value={params.palette}
        onPick={(palette) => go({ palette })}
      />
      <button type="button" style={{ ...pill(false), padding: "5px 8px" }} onClick={openSettings}>
        Settings
      </button>
    </div>
  );
}
