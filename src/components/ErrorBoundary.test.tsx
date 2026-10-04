import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CrashScreen, ErrorBoundary } from "./ErrorBoundary";
import { en } from "../i18n/en";
import { ru } from "../i18n/ru";
import { setLanguage } from "../i18n";
import { api } from "../lib/api";

// Мост к Rust в тесте не нужен: проверяется только, что предохранитель
// пишет падение в журнал и сам не падает.
vi.mock("../lib/api", () => ({ api: { reportUiError: vi.fn() } }));

beforeEach(() => {
  vi.mocked(api.reportUiError).mockReset();
});

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

describe("запись падения в журнал", () => {
  const info = { componentStack: "\n    at Panel\n    at App" };

  it("в журнал уходит название и текст ошибки вместе со стеком компонентов", () => {
    vi.mocked(api.reportUiError).mockResolvedValue(undefined);
    new ErrorBoundary({ children: null }).componentDidCatch(new TypeError("x is undefined"), info);
    expect(api.reportUiError).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(api.reportUiError).mock.calls[0]![0];
    expect(sent).toContain("TypeError: x is undefined");
    expect(sent).toContain("at Panel");
  });

  it("брошенное не-ошибкой (строка, объект) тоже записывается", () => {
    vi.mocked(api.reportUiError).mockResolvedValue(undefined);
    const boundary = new ErrorBoundary({ children: null });
    boundary.componentDidCatch("просто строка" as unknown as Error, info);
    boundary.componentDidCatch(null as unknown as Error, info);
    // Объект без прототипа в строку не превращается — запись всё равно уходит.
    boundary.componentDidCatch(Object.create(null) as Error, info);
    expect(api.reportUiError).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.reportUiError).mock.calls[0]![0]).toContain("просто строка");
    expect(vi.mocked(api.reportUiError).mock.calls[2]![0]).toContain("unprintable value");
  });

  it("слишком длинный текст обрезается до отправки", () => {
    vi.mocked(api.reportUiError).mockResolvedValue(undefined);
    new ErrorBoundary({ children: null }).componentDidCatch(new Error("я".repeat(10_000)), info);
    expect(vi.mocked(api.reportUiError).mock.calls[0]![0].length).toBeLessThanOrEqual(2000);
  });

  it("сбой самой записи (синхронный или отказ обещания) не вылетает из предохранителя", async () => {
    const boundary = new ErrorBoundary({ children: null });
    vi.mocked(api.reportUiError).mockImplementation(() => {
      throw new Error("нет моста");
    });
    expect(() => boundary.componentDidCatch(new Error("a"), info)).not.toThrow();
    vi.mocked(api.reportUiError).mockRejectedValue(new Error("нет моста"));
    expect(() => boundary.componentDidCatch(new Error("b"), info)).not.toThrow();
    // Отказ обещания не должен остаться необработанным.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
