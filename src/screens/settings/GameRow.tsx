import { useT } from "../../i18n";
import type { GameView } from "../../types";

interface Props {
  game: GameView;
  /** Строка развёрнута для правки. */
  expanded: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  children?: React.ReactNode;
}

export default function GameRow({
  game,
  expanded,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
  children,
}: Props) {
  const t = useT();
  // `is-open` — для стилей: у развёрнутой строки подсветка под курсором только
  // у шапки, а вся карточка при нажатии не вдавливается — она слишком большая.
  const className = ["game-row", game.missing && "missing", expanded && "is-open"].filter(Boolean).join(" ");
  return (
    <div
      className={className}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={onDrop}
    >
      <div
        className="game-row-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="game-row-grip" aria-hidden="true">
          ⋮⋮
        </span>
        <span className="game-row-title">{game.title}</span>
        <span className="game-row-source">{t.settings.launchKind[game.sourceKind]}</span>
        {game.missing && (
          <span className="game-row-warn" title={t.main.gameFileMissing}>
            {t.settings.games.fileMissing}
          </span>
        )}
      </div>
      {expanded && <div className="game-row-body">{children}</div>}
    </div>
  );
}
