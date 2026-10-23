interface Props {
  checked: boolean;
  /** Название настройки — для экранного диктора: у переключателя нет текста. */
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

/** Переключатель в палитре приложения вместо стандартной галочки (спека §7.1).
 *  Бегунок — отдельный элемент: он едет с пружинкой, а его цвет и цвет дорожки
 *  меняются проявлением слоёв, а не сменой фона (спека полировки, §2). */
export default function Switch({ checked, label, disabled = false, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" aria-hidden="true" />
    </button>
  );
}
