import { useState } from "react";
import { useT } from "../../i18n";
import { errorText } from "../../i18n/errors";
import { COLOR_KEYS, colorsOf, PRESETS, resetColors, setColor, setMode, useTheme, type Mode } from "../../lib/theme";
import ColorPicker from "./ColorPicker";

const MODES: readonly Mode[] = ["dark", "light", "system"];

/** Тема и свои цвета: готовые темы карточками, под ними крупные цвета. */
export default function ThemeSection() {
  const t = useT();
  const theme = useTheme();
  const colors = colorsOf(theme);
  const names = t.settings.look.theme;
  const customised = Object.keys(theme.colors).length > 0;
  const [error, setError] = useState("");
  // Цвет уже на экране; не записался — видно сразу под темой, а не молча.
  const saved = (write: Promise<void>) =>
    void write.then(
      () => setError(""),
      (e: unknown) => setError(errorText(t, e)),
    );

  return (
    <>
      <div className="settings-card-caption">{names.title}</div>
      <div className="theme-cards" role="radiogroup" aria-label={names.title}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={theme.mode === m}
            className={theme.mode === m ? "theme-card is-current" : "theme-card"}
            onClick={() => saved(setMode(m))}
          >
            <span className={`theme-mini is-${m}`} aria-hidden="true">
              {(m === "system" ? (["dark", "light"] as const) : [m]).map((shade) => (
                <span key={shade} className="theme-mini-half" style={{ background: PRESETS[shade].bg }}>
                  <span className="theme-mini-panel" style={{ background: PRESETS[shade].panel }} />
                  <span className="theme-mini-play" style={{ background: PRESETS[shade].accent }} />
                </span>
              ))}
            </span>
            <span className="theme-card-name">{names[m]}</span>
          </button>
        ))}
      </div>

      {error && <div className="settings-error">{error}</div>}
      <div className="theme-colors-head">
        <div className="settings-card-caption">{names.colors}</div>
        <button type="button" className="theme-reset" disabled={!customised} title={names.resetHint} onClick={() => saved(resetColors())}>
          ↺ {names.reset}
        </button>
      </div>
      <div className="settings-card">
        {COLOR_KEYS.map((k) => (
          <div className="settings-row" key={k}>
            <div className="settings-row-text">
              <span className="settings-row-title">{names.names[k]}</span>
            </div>
            <div className="settings-row-control">
              <ColorPicker value={colors[k]} label={names.names[k]} hexLabel={names.hex} onChange={(v) => saved(setColor(k, v))} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
