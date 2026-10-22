import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { gradientFor } from "../lib/gradient";
import { layerFor, layerKey, type Layer } from "../lib/background";
import { markReady, pushLayer, settleAll, settleLayer, type ArtEntry } from "../lib/artLayers";
import { motionOn, useMotionOn } from "../lib/motion";
import { useWindowVisible } from "../lib/windowVisible";
import type { GameView } from "../types";

interface Props {
  game: GameView | null;
}

/** Слой фона и заливка на случай, если слой — заливка: она выводится из названия игры. */
interface Scene {
  layer: Layer;
  fill: string;
}

export default function GameArt({ game }: Props) {
  const reduced = !useMotionOn();
  const visible = useWindowVisible();
  const layer: Layer = game ? layerFor(game, reduced) : { kind: "fill" };
  const fill = gradientFor(game?.title ?? "");
  // У двух игр без фона заливки разные, поэтому ключ заливки — сама заливка:
  // иначе переход между такими играми не заметил бы смены фона.
  const key = layer.kind === "fill" ? `fill:${fill}` : layerKey(layer);

  // Слои лежат стопкой (`lib/artLayers.ts`): новый фон ложится сверху
  // невидимым, проявляется, когда загрузился, и только потом убирает прежний.
  // Раньше новый фон проявлялся сразу, ещё не загрузившись, а прежний заново
  // вставлялся нижним слоем — и дрейф у него начинался с начала рывком. Теперь
  // прежний слой — тот же самый элемент, он просто остаётся на месте.
  // Заливке грузить нечего, она готова сразу.
  const nextId = useRef(1);
  const [stack, setStack] = useState<ArtEntry<Scene>[]>(() => [
    { id: 0, key, layer: { layer, fill }, ready: layer.kind === "fill" },
  ]);

  // Зависимость — только ключ: `layer` и `fill` берутся из того отрисовывания,
  // в котором ключ сменился. Повторный вызов с тем же ключом стопку не меняет.
  useEffect(() => {
    const id = nextId.current++;
    setStack((s) => pushLayer(s, { id, key, layer: { layer, fill }, ready: layer.kind === "fill" }, !motionOn()));
  }, [key]);

  // Тумблер «Анимация» выключили посреди перетекания: оно обрывается сразу,
  // а не ждёт конца анимации, которой больше нет.
  useEffect(() => {
    if (reduced) setStack(settleAll);
  }, [reduced]);

  const onReady = useCallback((id: number) => setStack((s) => markReady(s, id, !motionOn())), []);
  const onEntered = useCallback((id: number) => setStack((s) => settleLayer(s, id)), []);

  return (
    <div className="art">
      {stack.map((entry) => (
        <ArtLayer key={entry.id} entry={entry} visible={visible} onReady={onReady} onEntered={onEntered} />
      ))}
    </div>
  );
}

function ArtLayer({
  entry,
  visible,
  onReady,
  onEntered,
}: {
  entry: ArtEntry<Scene>;
  visible: boolean;
  onReady: (id: number) => void;
  onEntered: (id: number) => void;
}) {
  const { id } = entry;
  const { layer, fill } = entry.layer;
  const ready = () => onReady(id);

  return (
    <div
      className={entry.ready ? "art-layer is-in" : "art-layer"}
      onAnimationEnd={(e) => {
        // Событие всплывает и от дрейфа картинки внутри — нужно только своё.
        if (e.target === e.currentTarget && e.animationName === "art-enter") onEntered(id);
      }}
    >
      {layer.kind === "fill" && (
        // Надписи поверх нет: имя игры всплывает над её иконкой в доке
        // (спека этапа 5, §11).
        <div className="art-fill" style={{ background: fill }} />
      )}
      {layer.kind === "image" && (
        <img
          className="art-photo"
          src={convertFileSrc(layer.path)}
          alt=""
          // Готов — значит не только загружен, но и раскодирован: иначе
          // большая картинка раскодировалась бы в первых кадрах перетекания,
          // и оно бы дёрнулось. Битая картинка тоже «готова»: прежний фон
          // чужой игры не должен оставаться на экране навсегда.
          onLoad={(e) => void e.currentTarget.decode().catch(() => {}).finally(ready)}
          onError={ready}
        />
      )}
      {layer.kind === "video" && <ArtVideo layer={layer} visible={visible} onReady={ready} />}
    </div>
  );
}

/**
 * Своё видео фона (спека этапа 5, §6). Готово, когда есть первый кадр. Пока
 * новый фон проявляется поверх, ролик под ним доигрывает те же полсекунды —
 * это тот же элемент, файл заново не загружается, и кадр не прыгает.
 */
function ArtVideo({
  layer,
  visible,
  onReady,
}: {
  layer: Extract<Layer, { kind: "video" }>;
  visible: boolean;
  onReady: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  // Ролик не крутится впустую, пока окно в трее или свёрнуто (спека §6.3).
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (visible) void video.play().catch(() => {});
    else video.pause();
  }, [visible]);

  return (
    <video
      ref={ref}
      className="art-video"
      src={convertFileSrc(layer.path)}
      poster={layer.still ? convertFileSrc(layer.still) : undefined}
      muted
      loop
      playsInline
      autoPlay
      onLoadedData={onReady}
      onError={onReady}
    />
  );
}
