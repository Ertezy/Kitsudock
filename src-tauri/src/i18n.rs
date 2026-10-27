//! Тексты, которые Rust показывает сам, — только меню трея. Всё остальное
//! переводит страница: ошибки уходят к ней кодами.

use crate::config::Language;

pub struct TrayTexts {
    pub show: &'static str,
    pub quit: &'static str,
    /// Пометка у игры, чей файл пропал с диска.
    pub file_missing: &'static str,
}

pub fn tray(lang: Language) -> TrayTexts {
    match lang {
        Language::En => TrayTexts {
            show: "Show window",
            quit: "Quit",
            file_missing: "— file not found",
        },
        Language::Ru => TrayTexts {
            show: "Показать окно",
            quit: "Выход",
            file_missing: "— файл не найден",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_languages_name_both_items() {
        let en = tray(Language::En);
        let ru = tray(Language::Ru);
        assert_eq!((en.show, en.quit, en.file_missing), ("Show window", "Quit", "— file not found"));
        assert_eq!((ru.show, ru.quit, ru.file_missing), ("Показать окно", "Выход", "— файл не найден"));
    }
}
