import { Component, type ErrorInfo, type ReactNode } from "react";
import { currentT } from "../i18n";
import { api } from "../lib/api";

/**
 * Что видно вместо окна, если отрисовка упала. Без этого React убирает всё
 * дерево, и человек остаётся с пустым окном без объяснения и без выхода.
 *
 * Словарь берётся через `currentT()`, а не хуком: экран не должен зависеть от
 * того, что могло упасть. Классы взяты от экрана настроек, отдельных стилей у
 * него нет.
 */
export function CrashScreen() {
  const t = currentT().crash;
  return (
    <div className="settings">
      <div className="settings-body">
        <h2 className="settings-section-title">{t.title}</h2>
        <p className="settings-hint">{t.hint}</p>
        <button type="button" className="button accent" onClick={() => window.location.reload()}>
          {t.reload}
        </button>
      </div>
    </div>
  );
}

interface State {
  failed: boolean;
}

/** Дальше Rust всё равно режет текст; здесь — чтобы не гнать по мосту мегабайты.
 *  Считается знаками (кодовыми точками), а не 16-битными единицами строки. */
const MAX_REPORT_CHARS = 2000;

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/**
 * Первые `max` знаков текста. Резать по единицам (`slice`) нельзя: граница
 * может прийтись посередине суррогатной пары, и по мосту ушла бы одинокая
 * половинка, которую JSON моста не принимает — запись пропала бы. Одинокие
 * половинки, что были в самом тексте, заменяются на U+FFFD по той же причине.
 */
function cutText(text: string, max: number): string {
  // Берётся с запасом по единицам, чтобы не раскладывать огромную строку:
  // в первых 2·max единицах не меньше max знаков, а разрезанная на краю пара
  // оказывается за max-м знаком и отбрасывается.
  return Array.from(text.slice(0, max * 2))
    .slice(0, max)
    .map((ch) => {
      const unit = ch.charCodeAt(0);
      return ch.length === 1 && unit >= 0xd800 && unit <= 0xdfff ? REPLACEMENT_CHAR : ch;
    })
    .join("");
}

/** «Название: текст» для ошибки; бросить можно и строку, и что угодно. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return "(unprintable value)";
  }
}

/**
 * Корневой предохранитель. Классом, потому что у React 18 нет хука для
 * перехвата ошибок отрисовки. Ловит падения при отрисовке и в жизненном
 * цикле потомков; ошибки обработчиков событий и асинхронного кода — нет.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  /**
   * Падение уходит в журнал приложения: у окна своего журнала нет, а без
   * записи по жалобе «окно сломалось» не из чего понять, что именно упало.
   * Из предохранителя ничего не вылетает: сбой записи не должен стать второй
   * ошибкой поверх первой.
   */
  componentDidCatch(error: unknown, info: ErrorInfo) {
    try {
      const text = cutText(`${describe(error)}\n${info?.componentStack ?? ""}`, MAX_REPORT_CHARS);
      void Promise.resolve(api.reportUiError(text)).catch(() => {});
    } catch {
      // Журнал недоступен — экран отказа от этого не зависит.
    }
  }

  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
