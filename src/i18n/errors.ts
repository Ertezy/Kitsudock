// Текст ошибки для человека. Rust присылает код и подробность, страница
// подставляет фразу на выбранном языке. Незнакомый код — общая фраза с
// подробностью: новая ошибка Rust не должна превращаться в «[object Object]».

import type { Dictionary } from "./en";

type ErrorPhrase = (detail?: string) => string;

export function errorText(t: Dictionary, e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e) {
    const { code, detail } = e as { code: unknown; detail?: unknown };
    const d = typeof detail === "string" ? detail : undefined;
    const phrases = t.errors as unknown as Record<string, ErrorPhrase | string | undefined>;
    const phrase = typeof code === "string" ? phrases[code] : undefined;
    if (typeof phrase === "function") return phrase(d);
    return d ? `${t.errors.unknown}: ${d}` : t.errors.unknown;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
