//! Одноразовый перенос со старой установки (приложение называлось Gacha Hub,
//! идентификатор `com.gachahub.desktop`). Новый идентификатор даёт новую
//! папку настроек, и без переноса человек, обновившись, увидел бы пустое
//! приложение вместо своих игр и параметров.
//!
//! Переносится только `config.json`. Кеши картинок скачаются заново, а файл
//! положения окна не переносится: плагин окна читает его раньше, чем
//! срабатывает перенос, так что окно один раз откроется на стандартном месте.
//!
//! Перенос вызывается первым делом в `setup()`, до первого чтения конфига.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::autostart;

/// Идентификатор прежней версии: по нему находится её папка настроек.
pub const OLD_IDENTIFIER: &str = "com.gachahub.desktop";

const CONFIG_FILE: &str = "config.json";
/// Временное имя копии на время переноса (см. `copy_old_config`).
const STAGING_FILE: &str = "config.json.migrating";

/// Копирует `config.json` из папки старой установки в папку новой.
///
/// Делает это не более одного раза и ничего не затирает: если в новой папке
/// конфиг уже есть (перенос состоялся раньше или человек уже пользуется новой
/// версией), либо в старой его нет (чистая установка), возвращает `Ok(false)`
/// и ничего не трогает. Новая папка создаётся, если её ещё нет. Старая папка
/// остаётся как была: её можно удалить вручную, а откат на старую версию
/// сохранит прежние настройки.
pub fn copy_old_config(old_dir: &Path, new_dir: &Path) -> io::Result<bool> {
    let old_config = old_dir.join(CONFIG_FILE);
    let new_config = new_dir.join(CONFIG_FILE);
    if new_config.exists() || !old_config.is_file() {
        return Ok(false);
    }
    fs::create_dir_all(new_dir)?;
    // Копия сначала ложится во временный файл и лишь затем переименовывается:
    // оборванный перенос (сбой диска, закрытие компьютера) не оставит
    // недописанный `config.json`, который следующий запуск принял бы за
    // готовые настройки. Имя не `config.json.tmp` — его занимает
    // запись конфига (`config::update`).
    let staging = new_dir.join(STAGING_FILE);
    let copied = fs::copy(&old_config, &staging).and_then(|_| fs::rename(&staging, &new_config));
    if let Err(e) = copied {
        let _ = fs::remove_file(&staging);
        return Err(e);
    }
    Ok(true)
}

/// Папка настроек старой установки по папке новой: рядом, в том же
/// `%APPDATA%`, под прежним идентификатором.
fn old_dir_for(new_dir: &Path) -> Option<PathBuf> {
    Some(new_dir.parent()?.join(OLD_IDENTIFIER))
}

/// Переносит настройки и автозапуск со старой установки. Вызывается при
/// каждом запуске, но работу делает только на первом после перехода: дальше
/// в новой папке уже есть конфиг, а старого значения в реестре нет.
///
/// Автозапуск переезжает вместе с настройками: значение `Run` названо по
/// приложению, и без этого старая программа продолжила бы стартовать с
/// Windows, а новая считала бы автозапуск выключенным (см.
/// `autostart::take_over_old_value`).
///
/// Любая неудача только пишется в журнал: приложение запускается как обычно,
/// с обычным первым запуском (поиск игр).
pub fn from_gacha_hub(app: &AppHandle) {
    match app.path().app_config_dir() {
        Ok(new_dir) => {
            if let Some(old_dir) = old_dir_for(&new_dir) {
                match copy_old_config(&old_dir, &new_dir) {
                    Ok(true) => log::info!("[migrate] настройки перенесены из Gacha Hub"),
                    Ok(false) => {}
                    Err(e) => log::warn!("[migrate] не удалось перенести настройки: {e}"),
                }
            }
        }
        Err(e) => log::warn!("[migrate] не удалось определить папку настроек: {e}"),
    }
    if let Ok(exe) = std::env::current_exe() {
        autostart::take_over_old_value(&exe);
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn tempdir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("kd-migrate-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn the_old_config_is_copied_when_only_it_exists() {
        let root = tempdir("copy");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("config.json"), br#"{"version":3}"#).unwrap();

        assert!(copy_old_config(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("config.json")).unwrap(), br#"{"version":3}"#);
        // Старая папка не тронута.
        assert_eq!(std::fs::read(old.join("config.json")).unwrap(), br#"{"version":3}"#);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn no_staging_file_is_left_after_a_successful_copy() {
        let root = tempdir("staging");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("config.json"), b"cfg").unwrap();

        assert!(copy_old_config(&old, &new).unwrap());
        assert!(!new.join("config.json.migrating").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_leftover_staging_file_from_an_interrupted_copy_is_replaced() {
        let root = tempdir("leftover");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("config.json"), b"fresh").unwrap();
        // Обрыв при прошлом переносе: недописанный временный файл.
        std::fs::write(new.join("config.json.migrating"), b"half").unwrap();

        assert!(copy_old_config(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("config.json")).unwrap(), b"fresh");
        assert!(!new.join("config.json.migrating").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_existing_new_config_is_never_overwritten() {
        let root = tempdir("keep");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("config.json"), b"old").unwrap();
        std::fs::write(new.join("config.json"), b"new").unwrap();

        assert!(!copy_old_config(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("config.json")).unwrap(), b"new");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_happens_without_an_old_config() {
        let root = tempdir("none");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(&old).unwrap();

        assert!(!copy_old_config(&old, &new).unwrap());
        assert!(!new.join("config.json").exists());
        // Старой папки может не быть вовсе (чистая установка).
        assert!(!copy_old_config(&root.join("missing"), &new).unwrap());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_new_folder_is_created_when_missing() {
        let root = tempdir("mkdir");
        let old = root.join("old");
        let new = root.join("deep").join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("config.json"), b"cfg").unwrap();

        assert!(copy_old_config(&old, &new).unwrap());
        assert_eq!(std::fs::read(new.join("config.json")).unwrap(), b"cfg");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_old_folder_sits_next_to_the_new_one() {
        let new = PathBuf::from("appdata").join("io.github.ertezy.kitsudock");
        assert_eq!(old_dir_for(&new), Some(PathBuf::from("appdata").join(OLD_IDENTIFIER)));
        assert_eq!(old_dir_for(Path::new("")), None);
    }

    #[test]
    fn the_old_identifier_differs_from_the_current_one() {
        assert_eq!(OLD_IDENTIFIER, "com.gachahub.desktop");
        assert_ne!(OLD_IDENTIFIER, "io.github.ertezy.kitsudock");
    }
}
