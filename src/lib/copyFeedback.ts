// Отклик на копирование промокода: кнопка на время становится галочкой, а
// если буфер обмена код не принял — карточка на время принимает вид ошибки.
// Отдельно от компонента, чтобы правило проверялось тестами без окна.

/** Сколько держится галочка после копирования. */
export const COPY_FEEDBACK_MS = 1500;

/** Сколько держится ошибка копирования: дольше галочки — её надо успеть прочитать. */
export const COPY_FAILED_MS = 3000;

/**
 * Какой код копировали последним и чем кончилось. `id` — номер копирования: у
 * каждого свой, и они только растут (счётчик в компоненте). `failed` — буфер
 * обмена код не принял.
 */
export interface Copied {
  code: string;
  id: number;
  failed?: boolean;
}

/**
 * Истёк срок копирования с номером `id`. Срок снимает галочку только своего
 * копирования: иначе повторное копирование того же кода за миг до конца срока
 * погасило бы галочку почти сразу — по сроку прежнего.
 */
export function copyFeedbackOver(current: Copied | null, id: number): Copied | null {
  return current?.id === id ? null : current;
}

/** Сколько держать отклик этого копирования. */
export function feedbackMs(copied: Copied): number {
  return copied.failed ? COPY_FAILED_MS : COPY_FEEDBACK_MS;
}

/** Показывать ли галочку у этого кода. */
export function isCopied(current: Copied | null, code: string): boolean {
  return current?.code === code && !current.failed;
}

/** Показывать ли у этого кода ошибку копирования. */
export function isCopyFailed(current: Copied | null, code: string): boolean {
  return current?.code === code && current.failed === true;
}

/** Неразрывный пробел: на слух его нет, но строка с ним — другая строка. */
const SILENT = String.fromCharCode(0x00a0);

/**
 * Текст строки состояния для копирования с номером `id`. Экранный диктор
 * объявляет строку, только когда её текст меняется, а повторное копирование
 * того же кода дало бы тот же текст — и второе копирование прошло бы молча.
 * Поэтому у чётных копирований в конце неслышный неразрывный пробел: соседние
 * копирования всегда дают разный текст, а слышно одно и то же.
 */
export function copyAnnouncement(text: string, id: number): string {
  return id % 2 === 0 ? text + SILENT : text;
}
