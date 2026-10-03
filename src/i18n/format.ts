// Числа и даты на выбранном языке — встроенным Intl, без библиотек (спека
// этапа 6 §4.2).

import type { Lang } from "./native";

export const LOCALES: Record<Lang, string> = { en: "en-US", ru: "ru-RU" };

/** Формы слова по правилам языка: английскому хватает one/other, русскому
 *  нужны one/few/many (other — для дробей). */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const rulesCache = new Map<Lang, Intl.PluralRules>();

/** Форма слова по числу: «1 day / 2 days», «1 день / 2 дня / 5 дней». */
export function plural(lang: Lang, n: number, forms: PluralForms): string {
  let rules = rulesCache.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[lang]);
    rulesCache.set(lang, rules);
  }
  return forms[rules.select(n)] ?? forms.other;
}

/** «today», «yesterday», «4 days ago», «in 2 days» — и то же по-русски.
 *  `days` — со знаком: прошлое отрицательное, будущее положительное.
 *  `numeric: "auto"` включает идиомы «сегодня/вчера» лишь для ±1 дня — при
 *  ±2 CLDR для русского уже подставляет «послезавтра»/«позавчера», которых
 *  старая панель не знала, поэтому вне ±1 дня формат всегда числовой. */
export function relativeDays(lang: Lang, days: number): string {
  const numeric = Math.abs(days) <= 1 ? "auto" : "always";
  return new Intl.RelativeTimeFormat(LOCALES[lang], { numeric }).format(days, "day");
}

/** Вместо даты, которую нечем показать. */
const NO_DATE = "—";

/** «Aug 28» / «28 августа» — в часовом поясе пользователя. Время приходит из
 *  файла хаба, и дата вне диапазона `Date` (±8.64e12 с) — не повод ронять
 *  отрисовку: `Intl` бросает на ней RangeError, и окно остаётся пустым.
 *  Такая дата — прочерк. */
export function dayMonth(lang: Lang, sec: number): string {
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return NO_DATE;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    day: "numeric",
    month: lang === "en" ? "short" : "long",
  }).format(date);
}
