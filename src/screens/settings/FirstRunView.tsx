import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { currentLang, currentT, dictionary, setLanguage, useLang, useT, type Lang } from "../../i18n";
import { errorText } from "../../i18n/errors";
import { LANGS, LANG_SHORT, LANGUAGE_BLOCK_TITLE } from "../../i18n/native";
import Segmented from "./Segmented";
import EmptyState from "../../components/EmptyState";
import type { FoundGame } from "../../types";

interface Props {
  onDone: () => void;
}

export default function FirstRunView({ onDone }: Props) {
  // `null` — поиск ещё идёт: пустой список до ответа значил бы «ничего не
  // нашлось», и это сообщение мелькнуло бы перед находками.
  const [found, setFound] = useState<FoundGame[] | null>(null);
  const [scanFailed, setScanFailed] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = useT();
  const lang = useLang();

  // Выбор применяется сразу — страница перерисовывается на новом языке, — а
  // сохраняется следом. Не сохранился — язык возвращается, ошибка на прежнем.
  async function chooseLanguage(next: Lang) {
    const before = currentLang();
    setLanguage(next);
    // Тот же busy, что блокирует кнопки ниже: переключатель не должен принять
    // второй клик, пока этот запрос или другое сохранение ещё выполняется.
    setBusy(true);
    try {
      await api.setLanguage(next);
      setError("");
    } catch (e) {
      setLanguage(before);
      setError(errorText(dictionary(before), e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      // Поиск не удался — говорим об этом: «проверить не удалось», а не
      // «ничего не нашлось», — и оставляем выход дальше: на этом экране нет
      // кнопки «назад», и он не должен застрять на строке «ищу…».
      let list: FoundGame[] = [];
      try {
        list = await api.scanInstalled();
      } catch (e) {
        setError(errorText(currentT(), e));
        setScanFailed(true);
      }
      setFound(list);
      // По умолчанию отмечены только игры, про которые у нас есть контент,
      // и только те, которых ещё нет в списке.
      setChecked(
        new Set(
          list.filter((g) => g.contentId !== null && !g.alreadyAdded).map((g) => g.title),
        ),
      );
    })();
  }, []);

  const scanned = found ?? [];
  const known = scanned.filter((g) => g.contentId !== null);
  const rest = scanned.filter((g) => g.contentId === null);
  // Пустой список после ответа — «ничего не нашлось», после провала — «проверить
  // не удалось»: сцена та же, слова и выход разные.
  const nothing = found !== null && found.length === 0;

  const toggle = (title: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  // Первый запуск считается состоявшимся после любого решения — и когда
  // добавили отмеченные, и когда нажали «Пропустить». Пропуск это тоже
  // осознанный выбор, и повторно спрашивать нельзя.
  const markSeededAndClose = async () => {
    await api.markSeeded();
    onDone();
  };

  // Отметка пишется в конфиг, а на этом экране нет ни кнопки «назад», ни
  // вкладок — если запись не удастся, об этом обязательно нужно сказать,
  // иначе «Пропустить» молча перестанет что-либо делать.
  const skip = () =>
    void (async () => {
      setBusy(true);
      setError("");
      try {
        await markSeededAndClose();
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();

  const rows = (list: FoundGame[]) =>
    list.map((g) => (
      <label key={g.title} className="found-row">
        <input
          type="checkbox"
          checked={checked.has(g.title)}
          disabled={g.alreadyAdded}
          onChange={() => toggle(g.title)}
        />
        <span className="found-title">{g.title}</span>
        <span className="found-source">{t.main.launch.from[g.sourceKind]}</span>
        {g.alreadyAdded && <span className="found-note">{t.settings.firstRun.alreadyAdded}</span>}
      </label>
    ));

  return (
    <div>
      <div className="first-run-head">
        <h2 className="settings-section-title">{t.settings.firstRun.title}</h2>
        <Segmented
          options={LANGS.map((l) => ({ value: l, label: LANG_SHORT[l] }))}
          value={lang}
          label={LANGUAGE_BLOCK_TITLE}
          disabled={busy}
          onChange={(next) => void chooseLanguage(next)}
        />
      </div>

      {error && <div className="settings-error">{error}</div>}

      {found === null && (
        <p className="settings-hint" role="status">
          {t.settings.firstRun.scanning}
        </p>
      )}

      {nothing && (
        <EmptyState
          className="settings-empty"
          art={scanFailed ? "none" : "search"}
          title={scanFailed ? t.settings.firstRun.scanFailedTitle : t.settings.firstRun.nothingTitle}
          hint={t.settings.firstRun.nothingHint}
        />
      )}

      {known.length > 0 && (
        <>
          <p className="settings-hint">{t.settings.firstRun.knownHint}</p>
          {rows(known)}
        </>
      )}

      {rest.length > 0 && (
        <>
          <p className="settings-hint">{t.settings.firstRun.restHint}</p>
          {rows(rest)}
        </>
      )}

      {/* Ничего не нашлось — добавлять нечего, и главная кнопка просто ведёт
          дальше. */}
      <div className="settings-actions">
        {nothing ? (
          <button type="button" className="button accent" disabled={busy} onClick={skip}>
            {t.settings.firstRun.continue}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button accent"
              disabled={busy || found === null}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setError("");
                  try {
                    for (const g of scanned) {
                      if (!checked.has(g.title) || g.alreadyAdded) continue;
                      // Путь берётся из того же поиска, что заполнил список.
                      await api.addGameFromScan(g.title);
                    }
                    await markSeededAndClose();
                  } catch (e) {
                    setError(errorText(t, e));
                  } finally {
                    // Разблокировать кнопки при любом исходе: иначе провал
                    // на середине списка запирает экран первого запуска
                    // без кнопки «назад» и без иного способа выйти.
                    setBusy(false);
                  }
                })()
              }
            >
              {t.settings.firstRun.addChecked}
            </button>
            <button type="button" className="button" disabled={busy} onClick={skip}>
              {t.settings.firstRun.skip}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
