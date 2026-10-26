/**
 * Форматирование времени для панели.
 *
 * Все функции принимают `nowSec` явным параметром, а не читают часы сами:
 * иначе их поведение зависело бы от момента запуска тестов.
 * Время везде — unix-секунды, как в файле хаба.
 */

import { dayMonth, relativeDays } from "../i18n/format";
import { dictionary, type Lang } from "../i18n";

const HOUR = 3600;
const DAY = 86400;

/** «3 h 52 min», «9 days», «expired» — и то же по-русски. */
export function timeLeft(untilSec: number, nowSec: number, lang: Lang): string {
  const t = dictionary(lang).time;
  const left = untilSec - nowSec;
  if (left <= 0) return t.expired;
  if (left >= DAY) return t.days(Math.floor(left / DAY));
  const hours = Math.floor(left / HOUR);
  const minutes = Math.floor((left % HOUR) / 60);
  if (hours === 0) return t.minutes(minutes);
  return t.hoursMinutes(hours, minutes);
}

/** «today», «yesterday», «4 days ago», «in 2 days» — и то же по-русски. */
export function timeAgo(sinceSec: number, nowSec: number, lang: Lang): string {
  const diff = nowSec - sinceSec;
  if (diff < 0) return relativeDays(lang, Math.max(1, Math.round(-diff / DAY)));
  return relativeDays(lang, -Math.floor(diff / DAY));
}

/** Сгорает ли код в ближайшие сутки. Уже истёкшие — нет. */
export function burnsToday(untilSec: number, nowSec: number): boolean {
  const left = untilSec - nowSec;
  return left > 0 && left < DAY;
}

/** Доля пройденного срока, 0..1. Полоса заполнения баннера. */
export function progress(startSec: number, endSec: number, nowSec: number): number {
  const total = endSec - startSec;
  if (total <= 0) return 1;
  const passed = (nowSec - startSec) / total;
  return Math.min(1, Math.max(0, passed));
}

const WEEK = 7 * DAY;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Кольцо часиков у кода (спека полировки, §8.3): доля оставшегося срока,
 * 0..1. Неделя и больше до сгорания — полное кольцо, дальше оно убывает
 * линейно. Своего начала у кода нет, поэтому мерка — неделя.
 */
export function codeShareLeft(untilSec: number, nowSec: number): number {
  return clamp01((untilSec - nowSec) / WEEK);
}

/**
 * Кольцо часиков у баннера: доля оставшегося от всего его срока, от начала до
 * конца, 0..1. Нулевой или обратный срок — пустое кольцо.
 */
export function bannerShareLeft(startSec: number, endSec: number, nowSec: number): number {
  const total = endSec - startSec;
  if (total <= 0) return 0;
  return clamp01((endSec - nowSec) / total);
}

/** Самая короткая дуга кольца — краешек, который ещё видно. */
export const CLOCK_MIN_ARC = 0.04;

/**
 * Дуга, которую рисуют часики, 0..1: доля срока, но не короче `CLOCK_MIN_ARC`
 * — почти истёкший срок остаётся видимым краешком, а не пропадает совсем.
 * Истёкшему часики не рисуются вовсе.
 */
export function clockArc(share: number): number {
  return Math.max(CLOCK_MIN_ARC, clamp01(share));
}

/**
 * «data is fresh» или «data from Sep 1» — единая формулировка свежести
 * данных хаба. Используется и в подвале панели, и в разделе «Данные»
 * настроек: два места не должны разойтись в словах. И то же по-русски.
 */
export function hubFreshness(updatedAt: number, nowSec: number, lang: Lang): string {
  const t = dictionary(lang).time;
  if (nowSec - updatedAt <= DAY) return t.fresh;
  return t.dataFrom(dayMonth(lang, updatedAt));
}
