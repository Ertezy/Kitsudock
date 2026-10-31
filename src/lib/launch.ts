import type { Dictionary } from "../i18n";
import type { GameView, LaunchWay } from "../types";

/** Что нужно от игры, чтобы подписать способы её запуска. */
export type WayGame = Pick<GameView, "sourceKind" | "missing" | "ways" | "way" | "launcher">;

/** Подпись над кнопкой запуска: каким способом запустится игра, и нет ли её файла. */
export function launchNote(t: Dictionary, game: WayGame): string {
  const note =
    game.way === "launcher" && game.launcher
      ? t.main.launch.viaLauncher[game.launcher]
      : game.way === "direct"
        ? t.main.launch.note.exe
        : t.main.launch.note[game.sourceKind];
  return game.missing ? `${note} · ${t.main.launch.fileMissing}` : note;
}

/** Название способа — для язычка и строки списка. */
export function wayLabel(t: Dictionary, game: WayGame, way: LaunchWay): string {
  const words = t.main.launch.way;
  if (way === "launcher" && game.launcher) return words.launcher[game.launcher];
  if (way === "store" && game.sourceKind !== "exe") return words.store[game.sourceKind];
  return words.direct;
}

export interface WayChoice {
  way: LaunchWay;
  label: string;
  /** Мелкая строка под названием: у «напрямую» игры из магазина — что может не выйти. */
  hint: string | null;
  selected: boolean;
}

/** Строки переключателя способа. Выбирать не из чего — пусто: переключателя нет совсем. */
export function wayChoices(t: Dictionary, game: WayGame): WayChoice[] {
  if (game.ways.length < 2) return [];
  return game.ways.map((way) => ({
    way,
    label: wayLabel(t, game, way),
    hint:
      way === "direct" && game.sourceKind !== "exe"
        ? t.main.launch.way.directHint(t.settings.launchKind[game.sourceKind])
        : null,
    selected: way === game.way,
  }));
}
