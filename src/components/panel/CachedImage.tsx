import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../../lib/api";
import { gradientFor } from "../../lib/gradient";

interface Props {
  url: string | null;
  /** Показывается на градиенте, когда картинки нет. */
  fallbackText: string;
  className?: string;
}

/**
 * Картинка из локального кеша.
 *
 * Отсутствие картинки — обычное дело, а не поломка: у баннеров ХСР арта нет
 * вовсе, а любая загрузка может не удаться. В этом случае рисуется градиент
 * из названия — узнаваемый и стабильный, а не серая дырка.
 *
 * Пока картинки нет, на её месте мерцает заглушка того же тона, что и
 * заглушки разделов панели; пришедшая картинка проявляется, а не выскакивает.
 * Тон — отдельный слой под картинкой, в рамке вокруг неё (у баннера и у
 * превью рамка своя и с `position: relative`). Он держится, пока картинка
 * качается и читается, и гаснет одновременно с её проявлением: между ними нет
 * пустого мига, а сквозь прозрачные места готовой картинки тон не проступает.
 */
export default function CachedImage({ url, fallbackText, className }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Файл в кеше уже есть, но браузер его ещё не прочёл: до этого картинка
  // прозрачна, иначе она проступала бы по кускам.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    setShown(false);
    if (!url) {
      setFailed(true);
      return;
    }
    api
      .cacheImage(url)
      .then((path) => {
        if (alive) setSrc(convertFileSrc(path));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (failed) {
    return (
      <div
        className={className}
        style={{ background: gradientFor(fallbackText) }}
        role="img"
        aria-label={fallbackText}
      >
        <span className="img-fallback-text">{fallbackText}</span>
      </div>
    );
  }

  // Слой тона первым и в обеих ветках на одном месте: React сохраняет его, пока
  // ожидание сменяется картинкой, и мерцание не начинается заново.
  const tone = <span className={shown ? "img-tone is-gone" : "img-tone"} aria-hidden="true" />;

  if (!src) {
    return (
      <>
        {tone}
        <div className={className} role="img" aria-label={fallbackText} />
      </>
    );
  }

  return (
    <>
      {tone}
      <img
        className={`${className ?? ""} ${shown ? "img-shown" : "img-reading"}`}
        src={src}
        alt={fallbackText}
        loading="lazy"
        onLoad={() => setShown(true)}
        // Файл из кеша не прочёлся — как не скачался: градиент с названием, а
        // не значок битой картинки.
        onError={() => setFailed(true)}
      />
    </>
  );
}
