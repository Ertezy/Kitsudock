import { Component, type ReactNode } from "react";
import { currentT } from "../i18n";

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

  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
