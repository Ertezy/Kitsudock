// Какой слой фона показывать на главном экране. Отдельно от компонента, чтобы
// порядок проверялся тестами без окна.

import type { Dictionary } from "../i18n";
import type { GameView } from "../types";

export type Layer =
  | { kind: "video"; path: string; still: string | null }
  | { kind: "image"; path: string }
  | { kind: "fill" };

export function layerFor(
  game: { videoPath: string | null; artPath: string | null },
  reducedMotion: boolean,
): Layer {
  // При «уменьшить движение» ролик не показывается вовсе: вместо него следующий
  // источник, а не остановленное видео.
  if (game.videoPath && !reducedMotion) {
    return { kind: "video", path: game.videoPath, still: game.artPath };
  }
  if (game.artPath) return { kind: "image", path: game.artPath };
  return { kind: "fill" };
}

/** Устойчивый ключ слоя: по нему перетекание понимает, что фон сменился. */
export function layerKey(layer: Layer): string {
  return layer.kind === "fill" ? "fill" : `${layer.kind}:${layer.path}`;
}

/** Откуда у игры фон — подпись на вкладке «Вид». Магазины и официальный
 *  лаунчер делят подпись с `main.launch.from` — слово там то же самое. */
export function sourceText(t: Dictionary, game: Pick<GameView, "artSource" | "videoMissing">): string {
  const text =
    game.artSource === "steam" || game.artSource === "epic" || game.artSource === "hoyoplay"
      ? t.main.launch.from[game.artSource]
      : t.main.background.source[game.artSource];
  return game.videoMissing ? t.main.background.videoMissing(text) : text;
}

/** Есть ли что убирать кнопкой «Убрать»: своё видео или картинка, в том числе
 *  видео, файл которого пропал. */
export function hasOwnBackground(game: Pick<GameView, "artSource" | "videoMissing">): boolean {
  return game.artSource === "video" || game.artSource === "picture" || game.videoMissing;
}

/** Потолок размера своего видео в точках, подобранный живой проверкой.
 *  Ориентация не важна: предел проверяется по большей и меньшей стороне
 *  отдельно, а не по ширине и высоте буквально — ролик 1440×2560 такой же
 *  годный, как и 2560×1440. */
export function videoSizeProblem(t: Dictionary, width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return t.main.background.videoUnreadable;
  }
  if (Math.max(width, height) > 2560 || Math.min(width, height) > 1440) {
    return t.main.background.videoTooBig;
  }
  return null;
}
