// Надписи, которые на любом языке интерфейса пишутся одинаково — каждый язык на
// самом себе: человек, попавший не в тот язык, должен найти, где его сменить.
// Кроме ru.ts, это единственное место, где сторож кириллицы разрешает русские
// буквы.

export type Lang = "en" | "ru";
export type VideoLang = "en" | "ja";

export const LANGS: readonly Lang[] = ["en", "ru"];
export const VIDEO_LANGS: readonly VideoLang[] = ["en", "ja"];

/** Заголовок блока выбора языка — одинаковый на обоих языках. */
export const LANGUAGE_BLOCK_TITLE = "Language · Язык";

export const LANG_NAMES: Record<Lang, string> = { en: "English", ru: "Русский" };
export const VIDEO_LANG_NAMES: Record<VideoLang, string> = { en: "English", ja: "日本語" };

/** Короткие подписи для переключателя на экране первого запуска. */
export const LANG_SHORT: Record<Lang, string> = { en: "EN", ru: "RU" };
