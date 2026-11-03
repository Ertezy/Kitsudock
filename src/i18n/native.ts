// Надписи, которые на любом языке интерфейса пишутся одинаково — каждый язык на
// самом себе: человек, попавший не в тот язык, должен найти, где его сменить.
// Кроме ru.ts, это единственное место, где сторож кириллицы разрешает русские
// буквы.

export type Lang = "en" | "ru" | "zh" | "ja" | "ko";
export type VideoLang = "en" | "ja";

export const LANGS: readonly Lang[] = ["en", "ru", "zh", "ja", "ko"];
export const VIDEO_LANGS: readonly VideoLang[] = ["en", "ja"];

/** Заголовок блока выбора языка — одинаковый на всех языках. */
export const LANGUAGE_BLOCK_TITLE = "Language · Язык · 语言 · 言語 · 언어";

export const LANG_NAMES: Record<Lang, string> = { en: "English", ru: "Русский", zh: "简体中文", ja: "日本語", ko: "한국어" };
export const VIDEO_LANG_NAMES: Record<VideoLang, string> = { en: "English", ja: "日本語" };

