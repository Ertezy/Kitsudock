import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { gradientFor } from "../lib/gradient";
import { layerFor, layerKey, type Layer } from "../lib/background";
import { isOwnEnter, isShown, markReady, pushLayer, settleAll, settleLayer, type ArtEntry } from "../lib/artLayers";
import { motionOn, useMotionOn } from "../lib/motion";
import { useWindowActive } from "../lib/windowActive";
import type { GameView } from "../types";

interface Props {
  game: GameView | null;
  /** Фон этой игры начал проявляться (`null` — фона на экране нет): по
   *  этому сигналу поднимаются подпись и кнопка PLAY. */
  onShown?: (gameId: string | null) => void;
}

/** Слой фона и заливка на случай, если слой — заливка: она выводится из названия игры. */
interface Scene {
  layer: Layer;
  fill: string;
}

export default function GameArt({ game, onShown }: Props) {
  const reduced = !useMotionOn();
  const active = useWindowActive();
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

  // Сообщается до отрисовки (`useLayoutEffect`): подпись и кнопка начинают
  // подниматься в том же кадре, что и фон, а не кадром позже.
  const shown = isShown(stack, key);
  const gameId = game?.id ?? null;
  useLayoutEffect(() => {
    if (shown) onShown?.(gameId);
  }, [shown, gameId]);
  // Ушли с главного экрана — фона больше нет; вернулись — подпись и кнопка
  // снова ждут его.
  useEffect(() => () => onShown?.(null), []);

  const onReady = useCallback((id: number) => setStack((s) => markReady(s, id, !motionOn())), []);
  const onEntered = useCallback((id: number) => setStack((s) => settleLayer(s, id)), []);

  return (
    <div className="art">
      {stack.map((entry) => (
        <ArtLayer key={entry.id} entry={entry} active={active} onReady={onReady} onEntered={onEntered} />
      ))}
    </div>
  );
}

function ArtLayer({
  entry,
  active,
  onReady,
  onEntered,
}: {
  entry: ArtEntry<Scene>;
  active: boolean;
  onReady: (id: number) => void;
  onEntered: (id: number) => void;
}) {
  const { id } = entry;
  const { layer, fill } = entry.layer;
  const ready = () => onReady(id);
  const ref = useRef<HTMLDivElement>(null);

  // Слой проявился — всё под ним уходит. Оборванное проявление (`animationcancel`:
  // анимацию сняли посреди хода) кончается тем же: без анимации слой просто
  // непрозрачен, и закрытое им больше не видно. Иначе нижние слои копились бы.
  // Слушатели свои, а не через React: обрыва анимации в его событиях нет.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const finish = (e: AnimationEvent) => {
      if (isOwnEnter(e)) onEntered(id);
    };
    el.addEventListener("animationend", finish);
    el.addEventListener("animationcancel", finish);
    return () => {
      el.removeEventListener("animationend", finish);
      el.removeEventListener("animationcancel", finish);
    };
  }, [id, onEntered]);

  return (
    <div ref={ref} className={entry.ready ? "art-layer is-in" : "art-layer"}>
      {layer.kind === "fill" && (
        // Надписи поверх нет: имя игры всплывает над её иконкой в доке.
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
      {layer.kind === "video" && <ArtVideo layer={layer} active={active} onReady={ready} />}
    </div>
  );
}

/**
 * Своё видео фона. Готово, когда есть первый кадр. Пока новый фон проявляется
 * поверх, ролик под ним доигрывает те же полсекунды — это тот же элемент, файл
 * заново не загружается, и кадр не прыгает.
 */
function ArtVideo({
  layer,
  active,
  onReady,
}: {
  layer: Extract<Layer, { kind: "video" }>;
  active: boolean;
  onReady: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  // Ролик не крутится впустую, пока окно в трее или свёрнуто, и стоит, пока
  // окно не в фокусе — человек в игре.
  // Вернулся — ролик идёт дальше с того же кадра.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active) void video.play().catch(() => {});
    else video.pause();
  }, [active]);

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
