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
        Language::Zh => TrayTexts {
            show: "显示窗口",
            quit: "退出",
            file_missing: "— 找不到文件",
        },
        Language::Ja => TrayTexts {
            show: "ウィンドウを表示",
            quit: "終了",
            file_missing: "— ファイルが見つかりません",
        },
        Language::Ko => TrayTexts {
            show: "창 표시",
            quit: "종료",
            file_missing: "— 파일을 찾을 수 없음",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_language_names_every_item() {
        let en = tray(Language::En);
        let ru = tray(Language::Ru);
        assert_eq!((en.show, en.quit, en.file_missing), ("Show window", "Quit", "— file not found"));
        assert_eq!((ru.show, ru.quit, ru.file_missing), ("Показать окно", "Выход", "— файл не найден"));
        let zh = tray(Language::Zh);
        let ja = tray(Language::Ja);
        let ko = tray(Language::Ko);
        assert_eq!((zh.show, zh.quit, zh.file_missing), ("显示窗口", "退出", "— 找不到文件"));
        assert_eq!((ja.show, ja.quit, ja.file_missing), ("ウィンドウを表示", "終了", "— ファイルが見つかりません"));
        assert_eq!((ko.show, ko.quit, ko.file_missing), ("창 표시", "종료", "— 파일을 찾을 수 없음"));
    }
}
