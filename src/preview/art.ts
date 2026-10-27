// Нарисованные в коде заглушки для стенда. Ни чужих картинок, ни бинарных
// файлов в репозитории: каждая картинка — текст SVG, собранный из градиентов,
// мягких пятен света и силуэтов холмов, и отданный адресом `data:`. Политика
// содержимого приложения такие картинки разрешает (`img-src ... data:`).

/** Адрес `data:` из текста SVG. */
export function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Небольшой детерминированный генератор (mulberry32): одно зерно — одна и та же картинка. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num = (n: number) => Math.round(n * 10) / 10;

/** Плавный силуэт холмов вдоль низа картинки. */
function ridge(r: () => number, w: number, h: number, base: number, amp: number, fill: string, opacity: number): string {
  const steps = 7;
  const pts = Array.from({ length: steps }, (_, i) => ({
    x: (i * w) / (steps - 1),
    y: h * base + (r() - 0.5) * amp * h,
  }));
  let d = `M ${num(pts[0].x)} ${num(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const dx = (q.x - p.x) / 2;
    d += ` C ${num(p.x + dx)} ${num(p.y)}, ${num(q.x - dx)} ${num(q.y)}, ${num(q.x)} ${num(q.y)}`;
  }
  d += ` L ${w} ${h} L 0 ${h} Z`;
  return `<path d="${d}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

/**
 * Пейзаж без сюжета: диагональный градиент двух оттенков, три пятна света,
 * три слоя холмов и пыль. Годится и фоном игры, и баннером, и кадром видео.
 */
function scene(w: number, h: number, hueA: number, hueB: number, seed: number): string {
  const r = rng(seed);
  const hueMid = Math.round((hueA + hueB) / 2);
  const glows = [hueB, hueA, hueMid].map((hue, i) => {
    const cx = num(r() * w);
    const cy = num(r() * h * 0.65);
    const radius = num((0.32 + r() * 0.3) * w);
    const strength = num(0.3 + r() * 0.25);
    return (
      `<radialGradient id="g${i}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${radius}">` +
      `<stop offset="0" stop-color="hsl(${hue} 85% 72%)" stop-opacity="${strength}"/>` +
      `<stop offset="1" stop-color="hsl(${hue} 85% 72%)" stop-opacity="0"/></radialGradient>`
    );
  });
  const glowRects = [0, 1, 2].map((i) => `<rect width="${w}" height="${h}" fill="url(#g${i})"/>`);

  const dust = Array.from({ length: 36 }, () => {
    const x = num(r() * w);
    const y = num(r() * h * 0.62);
    const size = num((0.6 + r() * 1.8) * (w / 1280));
    const alpha = num(0.15 + r() * 0.35);
    return `<circle cx="${x}" cy="${y}" r="${size}" fill="#fff" fill-opacity="${alpha}"/>`;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<defs><linearGradient id="base" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hueA} 55% 17%)"/>` +
    `<stop offset="1" stop-color="hsl(${hueB} 60% 36%)"/></linearGradient>${glows.join("")}</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#base)"/>` +
    glowRects.join("") +
    dust.join("") +
    ridge(r, w, h, 0.74, 0.1, `hsl(${hueA} 38% 14%)`, 0.55) +
    ridge(r, w, h, 0.84, 0.09, `hsl(${hueA} 40% 10%)`, 0.75) +
    ridge(r, w, h, 0.93, 0.07, `hsl(${hueB} 35% 6%)`, 0.92) +
    `</svg>`
  );
}

/** Фон игры, 1920×1080. */
export function backgroundArt(hueA: number, hueB: number, seed = 1): string {
  return svgUrl(scene(1920, 1080, hueA, hueB, seed));
}

/** Иконка игры, 256×256: заливка во всю площадь (скругляют стили, как у настоящих) и буква. */
export function iconArt(letter: string, hueA: number, hueB: number): string {
  const ch = letter.slice(0, 1).toUpperCase().replace(/[<>&"']/g, "") || "?";
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">` +
      `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="hsl(${hueA} 62% 30%)"/>` +
      `<stop offset="1" stop-color="hsl(${hueB} 66% 52%)"/></linearGradient>` +
      `<radialGradient id="h" cx="0.28" cy="0.2" r="0.8">` +
      `<stop offset="0" stop-color="#fff" stop-opacity="0.42"/>` +
      `<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="256" height="256" fill="url(#b)"/><rect width="256" height="256" fill="url(#h)"/>` +
      `<text x="128" y="132" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="'Segoe UI', system-ui, sans-serif" font-size="150" font-weight="700" ` +
      `fill="#fff" fill-opacity="0.92">${ch}</text></svg>`,
  );
}

/** Какие картинки хаб называет по адресу: баннеры и кадры видео. */
export type HubArtKind = "banner" | "thumb";

/**
 * Адрес картинки для данных хаба. Настоящий адрес был бы сетевым; стенд сети не
 * трогает: команда `cache_image` узнаёт такой адрес (`artFromUrl`) и отвечает
 * нарисованной картинкой. Зона `.test` зарезервирована и в сети не существует.
 */
export function imageUrl(kind: HubArtKind, hueA: number, hueB: number, seed: number): string {
  return `https://preview.test/art/${kind}/${hueA}-${hueB}-${seed}`;
}

const IMAGE_URL = /^https:\/\/preview\.test\/art\/(banner|thumb)\/(\d+)-(\d+)-(\d+)$/;

/** Картинка по адресу из `imageUrl`; `null` — адрес не стендовый. */
export function artFromUrl(url: string): string | null {
  const m = IMAGE_URL.exec(url);
  if (!m) return null;
  const [, kind, a, b, seed] = m;
  return svgUrl(kind === "banner" ? scene(1280, 720, +a, +b, +seed) : scene(640, 360, +a, +b, +seed));
}
