/**
 * Сколько строк кодов, точек карусели и превью видео рисуют заглушки. Строк
 * кодов больше, чем влезает: коробка кодов, как и настоящая, срезает
 * последнюю на своём потолке.
 */
const CODE_ROWS = 4;
const BANNER_DOTS = 3;
const VIDEO_THUMBS = 2;

/**
 * Заглушки разделов, пока данные панели не пришли: не пустота, а очертания
 * будущих карточек — строки кодов, одна карточка баннера и превью видео.
 * Размеры и отступы повторяют настоящие: строка кода той же высоты, что
 * карточка кода с наградами, коробка кодов с тем же потолком, карточка баннера
 * с точками карусели и превью с подписью — той же высоты.
 * Пришедшие данные встают почти туда же, где стояли заглушки, и панель при
 * смене не скачет.
 *
 * Каждый раздел — свой блок в ряду разделов панели: лесенка входа и разделители
 * у них те же, что у настоящих. Мерцание — одна прозрачность, и тумблер
 * «Анимация» его выключает (`styles.css`).
 *
 * Для экранного диктора заглушек нет (`aria-hidden`): о загрузке он узнаёт по
 * `aria-busy` у прокручиваемой части панели.
 */
export default function Skeleton() {
  return (
    <>
      <div className="panel-section skeleton-section" aria-hidden="true">
        <div className="skeleton-block skeleton-label" />
        <div className="skeleton-codes">
          {Array.from({ length: CODE_ROWS }, (_, i) => (
            <div key={i} className="skeleton-code">
              <div className="skeleton-code-main">
                <div className="skeleton-block skeleton-line is-code" />
                <div className="skeleton-block skeleton-line is-short" />
                <div className="skeleton-block skeleton-line is-long" />
              </div>
              <div className="skeleton-code-side">
                <div className="skeleton-block skeleton-button" />
                <div className="skeleton-block skeleton-button" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-section skeleton-section" aria-hidden="true">
        <div className="skeleton-block skeleton-label" />
        <div className="skeleton-banner">
          <div className="skeleton-block skeleton-art" />
          <div className="skeleton-banner-foot">
            <div className="skeleton-block skeleton-bar" />
            <div className="skeleton-banner-line">
              <div className="skeleton-block skeleton-line is-title" />
              <div className="skeleton-block skeleton-line is-tail" />
            </div>
          </div>
        </div>
        <div className="skeleton-dots">
          {Array.from({ length: BANNER_DOTS }, (_, i) => (
            <div key={i} className="skeleton-block skeleton-dot" />
          ))}
        </div>
      </div>

      <div className="panel-section skeleton-section" aria-hidden="true">
        <div className="skeleton-block skeleton-label" />
        {Array.from({ length: VIDEO_THUMBS }, (_, i) => (
          <div key={i} className="skeleton-video">
            <div className="skeleton-block skeleton-thumb" />
            <div className="skeleton-block skeleton-line is-long" />
            <div className="skeleton-block skeleton-line is-short" />
          </div>
        ))}
      </div>
    </>
  );
}
