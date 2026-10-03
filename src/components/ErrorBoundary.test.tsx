import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CrashScreen, ErrorBoundary } from "./ErrorBoundary";
import { en } from "../i18n/en";
import { ru } from "../i18n/ru";
import { setLanguage } from "../i18n";

afterEach(() => {
  setLanguage("en");
  vi.unstubAllGlobals();
});

/** Первый элемент данного типа в дереве, не раскрывая компоненты. */
function findElement(node: ReactNode, type: string): ReactElement<{ onClick?: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === type) return node as ReactElement<{ onClick?: () => void }>;
  return findElement(node.props.children, type);
}

describe("корневой предохранитель", () => {
  it("падение отрисовки переводит его в состояние отказа", () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });

  it("пока всё работает, он отдаёт содержимое как есть", () => {
    expect(renderToStaticMarkup(<ErrorBoundary><p>панель</p></ErrorBoundary>)).toBe("<p>панель</p>");
  });

  it("после отказа вместо содержимого — короткое сообщение и кнопка перезагрузки", () => {
    const boundary = new ErrorBoundary({ children: <p>панель</p> });
    boundary.state = ErrorBoundary.getDerivedStateFromError();
    // Разметка экранирует апостроф, а текст в словаре его содержит.
    const html = renderToStaticMarkup(<>{boundary.render()}</>).replaceAll("&#x27;", "'");
    expect(html).not.toContain("панель");
    expect(html).toContain(en.crash.title);
    expect(html).toContain(en.crash.hint);
    expect(html).toContain(`>${en.crash.reload}</button>`);
  });

  it("сообщение — на выбранном языке", () => {
    setLanguage("ru");
    const html = renderToStaticMarkup(<CrashScreen />);
    expect(html).toContain(ru.crash.title);
    expect(html).toContain(ru.crash.reload);
    expect(html).not.toContain(en.crash.title);
  });

  it("кнопка перезагружает окно", () => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    const button = findElement(CrashScreen(), "button");
    expect(button).not.toBeNull();
    button!.props.onClick!();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
