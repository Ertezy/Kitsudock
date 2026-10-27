//! Автозапуск с Windows: значение `Kitsudock` в
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Переключатель читает
//! состояние отсюда, из реестра: конфиг не меняется.
//!
//! Ограничение: отключение в диспетчере задач Windows хранит отдельно
//! (`…\Explorer\StartupApproved\Run`), и здесь оно не видно.

use std::path::Path;

pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
pub const VALUE_NAME: &str = "Kitsudock";
/// Имя значения у прежней версии (приложение называлось Gacha Hub): нужно
/// только затем, чтобы один раз убрать его из реестра (см.
/// `take_over_old_value`).
pub const OLD_VALUE_NAME: &str = "Gacha Hub";
/// С этим флагом приложение стартует спрятанным в трей.
pub const FLAG: &str = "--autostart";

/// Строка запуска: путь в кавычках (в нём бывают пробелы) и флаг.
pub fn command_line(exe: &Path) -> String {
    format!("\"{}\" {FLAG}", exe.display())
}

/// Переписать ли значение: оно есть, но указывает не на этот exe (приложение
/// переехало). Нет значения — автозапуск выключен, трогать нечего.
pub fn needs_rewrite(current: Option<&str>, exe: &Path) -> bool {
    matches!(current, Some(value) if value != command_line(exe))
}

/// Запущено ли приложение автозапуском.
pub fn launched_by(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().any(|a| a == FLAG)
}

/// Значение `name` из `Run`: `None`, если его (или самого ключа) нет.
#[cfg(windows)]
fn read_value(name: &str) -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .ok()?
        .get_value::<String, _>(name)
        .ok()
}

#[cfg(windows)]
pub fn read() -> Option<String> {
    read_value(VALUE_NAME)
}

#[cfg(windows)]
pub fn enable(exe: &Path) -> std::io::Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY)?;
    key.set_value(VALUE_NAME, &command_line(exe))
}

/// Удаляет значение `name`. Его уже нет — не ошибка.
#[cfg(windows)]
fn delete_value(name: &str) -> std::io::Result<()> {
    use std::io::ErrorKind;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;
    match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE) {
        Ok(key) => match key.delete_value(name) {
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            other => other,
        },
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Удаляет значение. Его уже нет — не ошибка.
#[cfg(windows)]
pub fn disable() -> std::io::Result<()> {
    delete_value(VALUE_NAME)
}

#[cfg(not(windows))]
fn read_value(_name: &str) -> Option<String> {
    None
}

#[cfg(not(windows))]
fn delete_value(_name: &str) -> std::io::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn read() -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn enable(_exe: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn disable() -> std::io::Result<()> {
    Ok(())
}

/// При запуске: автозапуск включён, но указывает на старый путь — переписать.
pub fn refresh_path(exe: &Path) {
    if needs_rewrite(read().as_deref(), exe) {
        if let Err(e) = enable(exe) {
            log::error!("[autostart] не удалось обновить путь: {e}");
        }
    }
}

/// Один раз при переходе с Gacha Hub: если в `Run` осталось значение старого
/// имени, автозапуск был включён, и его надо сохранить, но под новым именем.
/// Старое значение убирается, иначе прежняя программа продолжила бы стартовать
/// вместе с Windows, а переключатель Kitsudock показывал бы «выключено».
///
/// Сначала пишется новое значение и только потом удаляется старое: если запись
/// не удалась, старое остаётся, автозапуск не теряется, и перенос повторится
/// при следующем запуске. Нет старого значения — ничего не делается.
pub fn take_over_old_value(exe: &Path) {
    if read_value(OLD_VALUE_NAME).is_none() {
        return;
    }
    if let Err(e) = enable(exe) {
        log::warn!("[autostart] не удалось перенести автозапуск со старого имени: {e}");
        return;
    }
    if let Err(e) = delete_value(OLD_VALUE_NAME) {
        log::warn!("[autostart] не удалось убрать значение автозапуска старого имени: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_command_line_quotes_the_path_and_adds_the_flag() {
        let exe = Path::new(r"C:\Program Files\Kitsudock\kitsudock.exe");
        assert_eq!(command_line(exe), r#""C:\Program Files\Kitsudock\kitsudock.exe" --autostart"#);
    }

    #[test]
    fn the_value_is_rewritten_only_when_it_points_elsewhere() {
        let exe = Path::new(r"C:\Apps\kitsudock.exe");
        assert!(!needs_rewrite(None, exe));
        assert!(!needs_rewrite(Some(&command_line(exe)), exe));
        assert!(needs_rewrite(Some(r#""D:\Old\kitsudock.exe" --autostart"#), exe));
    }

    #[test]
    fn the_old_value_name_is_the_one_the_previous_version_wrote() {
        // Эта константа нужна, чтобы убрать старое значение из реестра: она
        // должна совпадать с тем, что писала прежняя версия, и не с нынешним.
        assert_eq!(OLD_VALUE_NAME, "Gacha Hub");
        assert_ne!(OLD_VALUE_NAME, VALUE_NAME);
    }

    #[test]
    fn the_value_name_equals_the_product_name() {
        // Деинсталлятор NSIS удаляет `Run\<productName>`: если имя значения
        // разойдётся с именем продукта, после удаления программы автозапуск
        // останется в реестре и будет указывать в пустоту.
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["productName"].as_str(), Some(VALUE_NAME));
    }

    #[test]
    fn the_flag_is_found_among_the_arguments() {
        assert!(launched_by(["app.exe".to_string(), "--autostart".to_string()]));
        assert!(!launched_by(["app.exe".to_string()]));
    }
}
