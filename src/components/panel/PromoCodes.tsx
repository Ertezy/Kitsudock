import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { COPY_FEEDBACK_MS, copyFeedbackOver, isCopied, type Copied } from "../../lib/copyFeedback";
import { activeCodes, plainSpaces } from "../../lib/panel";
import { burnsToday, timeLeft } from "../../lib/time";
import { useLang, useT } from "../../i18n";
import type { Code, HubGame } from "../../types";

interface Props {
  codes: Code[];
  games: HubGame[];
  nowSec: number;
}

/**
 * Промокоды выбранной в доке игры, отсортированные по сгоранию.
 *
 * Отбор по игре делает панель, как для баннеров и видео: такое решение
 * владельца на этапе 7 (29 сентября), оно отменило решение этапа 2 «коды всех
 * игр сразу». Поэтому на карточке нет значка игры. Список игр нужен только
 * для ссылки «забрать»: шаблон адреса лежит в записи игры.
 */
export default function PromoCodes({ codes, games, nowSec }: Props) {
  const [copied, setCopied] = useState<Copied | null>(null);
  // Номер копирования: у каждого свой срок галочки (`lib/copyFeedback.ts`).
  const copies = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const lang = useLang();
  const t = useT();

  const active = activeCodes(codes, nowSec);

  if (active.length === 0) return null;

  const gameOf = (id: string) => games.find((g) => g.id === id) ?? null;

  const copy = async (code: string) => {
    await api.copyText(code);
    const id = ++copies.current;
    setCopied({ code, id });
    // Срок прежнего копирования больше не нужен: галочку держит новое.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied((c) => copyFeedbackOver(c, id)), COPY_FEEDBACK_MS);
  };

  const redeem = async (code: Code) => {
    const template = gameOf(code.gameId)?.redeemUrl;
    if (!template) return;
    // Код приходит из недоверенного файла: символ & или # в нём поменял бы
    // смысл ссылки. Подставляем через процентное кодирование (спека §8.1).
    await api.openSafeUrl(template.replace("{code}", encodeURIComponent(code.code)));
  };

  return (
    <section className="panel-section">
      <div className="panel-label">
        <span>{t.panel.codes}</span>
        <span>{active.length}</span>
      </div>

      <div className="codes-box">
        {active.map((c) => {
          const game = gameOf(c.gameId);
          const soon = c.expiresAt !== null && burnsToday(c.expiresAt, nowSec);
          return (
            <div
              key={`${c.gameId}:${c.code}`}
              className={soon ? "code-card burning" : "code-card"}
              onClick={() => void copy(c.code)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                // Отсекаем события, всплывшие от вложенных кнопок.
                //
                // Без этой строки Enter на кнопке «забрать» молча копирует код
                // вместо перехода на сайт: событие всплывает сюда, наш
                // preventDefault подавляет синтез нажатия самой кнопки, и
                // выполняется действие карточки. Кнопка становится
                // недоступной с клавиатуры, а человек не понимает почему.
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void copy(c.code);
                }
              }}
            >
              <div className="code-main">
                <code>{c.code}</code>
                <div className={soon ? "code-timer soon" : "code-timer"}>
                  {c.expiresAt === null
                    ? t.panel.noExpiry
                    : soon
                      ? t.panel.expiresIn(timeLeft(c.expiresAt, nowSec, lang))
                      : t.panel.timeRemaining(timeLeft(c.expiresAt, nowSec, lang))}
                </div>
                {c.rewards && <div className="code-meta">{plainSpaces(c.rewards)}</div>}
                {c.region !== "all" && (
                  <div className="code-region">{t.panel.regionOnly(c.region)}</div>
                )}
              </div>

              <div className="code-side">
                <div className="code-buttons">
                  {/* Значок копирования на время становится галочкой: оба
                      лежат в кнопке друг на друге и меняются растяжением и
                      прозрачностью. Экранному диктору значки не нужны — ему
                      строка состояния ниже. */}
                  <button
                    type="button"
                    className={isCopied(copied, c.code) ? "code-copy is-copied" : "code-copy"}
                    aria-label={t.panel.copyCode}
                    onClick={(e) => {
                      e.stopPropagation();
                      void copy(c.code);
                    }}
                  >
                    <span className="code-copy-icon is-copy" aria-hidden="true">
                      ⧉
                    </span>
                    <span className="code-copy-icon is-check" aria-hidden="true">
                      ✓
                    </span>
                  </button>
                  {game?.redeemUrl && (
                    <button
                      type="button"
                      className="primary"
                      aria-label={t.panel.redeem}
                      onClick={(e) => {
                        e.stopPropagation();
                        void redeem(c);
                      }}
                    >
                      ↗
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Что код скопирован, экранный диктор слышит словами: строка
          состояния вежливо объявляет каждое копирование. */}
      <span className="sr-only" role="status">
        {copied ? t.panel.codeCopied(copied.code) : ""}
      </span>
    </section>
  );
}
