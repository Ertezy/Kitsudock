// Какие соцсети показать в столбике у правого края главного экрана. Отдельно
// от компонента, чтобы правило выбора проверялось тестами без окна.

import type { Lang } from "../i18n";
import type { HubGame, Social, SocialKind } from "../types";

/**
 * Сети, для которых есть значок и название. Тот же список — в Rust
 * (`SocialKind` в `src-tauri/src/hub/schema.rs`): там запись с другой сетью
 * отбрасывается ещё при чтении файла, а адрес сверяется с хостами своей сети.
 * Здесь адрес не проверяется второй раз — только вид, чтобы у кнопки точно
 * был значок.
 */
export const SOCIAL_KINDS: readonly SocialKind[] = [
  "hoyolab",
  "site",
  "youtube",
  "x",
  "discord",
  "reddit",
  "facebook",
  "instagram",
  "tiktok",
  "telegram",
  "vk",
];

const known = (list: Social[] | undefined) => (list ?? []).filter((s) => SOCIAL_KINDS.includes(s.kind));

/**
 * Соцсети игры на языке интерфейса; нет списка для этого языка — на другом.
 * Пустой ответ — столбика нет совсем.
 */
export function socialsFor(socials: HubGame["socials"], lang: Lang): Social[] {
  const own = known(socials?.[lang]);
  return own.length > 0 ? own : known(socials?.[lang === "ru" ? "en" : "ru"]);
}
