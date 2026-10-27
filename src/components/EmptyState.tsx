interface Props {
  /** Что случилось — коротко, одной строкой. */
  title: string;
  /** Что с этим сделать. */
  hint?: string;
  /** Рисунок: карточка, которой пока нет, лупа — для поиска без находок, или
   *  без рисунка — для отказа, где сцена «пусто» сказала бы неправду. */
  art?: "card" | "search" | "none";
  /** Свой класс места: панель, настройки. */
  className?: string;
}

/**
 * Пустое место: не голая строка, а маленькая сцена — рисунок из самих стилей,
 * заголовок и подсказка. Рисунок для экранного диктора не существует: ему
 * хватает текста.
 */
export default function EmptyState({ title, hint, art = "card", className }: Props) {
  return (
    <div className={className ? `empty ${className}` : "empty"}>
      {art !== "none" && <span className={art === "search" ? "empty-art is-search" : "empty-art"} aria-hidden="true" />}
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  );
}
