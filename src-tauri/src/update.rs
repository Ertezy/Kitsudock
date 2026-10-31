//! Обновление приложения по кнопке «Обновить» в строке «Вышла версия».
//!
//! Само приложение ничего не скачивает и не ставит: всё начинается с нажатия.
//! Тогда плагин обновлений спрашивает `latest.json` последнего релиза
//! (`plugins.updater` в tauri.conf.json), качает установщик и проверяет его
//! подпись ключом, вшитым в приложение. Подпись не сошлась — не ставит.
//! Сошлась — запускает установщик в режиме passive и завершает процесс;
//! установщик сам ставит новую версию и запускает её.

use std::ffi::OsString;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::AppHandleExt as _;

use crate::error::{code, AppError};

/// Сколько ждать ответа на вопрос о новой версии. Без срока зависший запрос
/// навсегда оставил бы строку «Скачиваю обновление…».
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// Срок на всю загрузку установщика: с запасом на медленную сеть, но конечный —
/// по той же причине.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

fn failed(e: tauri_plugin_updater::Error) -> AppError {
    AppError::with(code::UPDATE_FAILED, e.to_string())
}

/// Проверить, скачать и поставить вышедшую версию.
///
/// На Windows удачная установка из функции не возвращается: плагин запускает
/// установщик и завершает процесс. Возврат — всегда отказ, и его видит человек.
pub async fn install(app: &AppHandle) -> Result<(), AppError> {
    let updater = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(failed)?;
    // Новой версии нет: файл данных уже знает о релизе, а `latest.json` ещё
    // нет — релиз без файла обновления или ещё не опубликован.
    let mut update = updater
        .check()
        .await
        .map_err(failed)?
        .ok_or_else(|| AppError::new(code::UPDATE_NOT_FOUND))?;
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    log::info!("[update] {} -> {}", update.current_version, update.version);

    // Подпись проверяется здесь же: не сошлась — ошибка, установщик не пишется
    // на диск и не запускается.
    let bytes = update.download(|_, _| {}, || {}).await.map_err(failed)?;

    // Дальше процесс завершится без обычного выхода. Настройки к этому
    // времени уже на диске: каждая правка сразу пишется `config::update`
    // (целиком, через временный файл). Размер и положение окна плагин
    // сохраняет при закрытии окна и при выходе — здесь не будет ни того, ни
    // другого, поэтому сохраняем сами.
    if let Err(e) = app.save_window_state(crate::window_state_flags()) {
        log::warn!("[update] не сохранить размер и положение окна: {e}");
    }
    log::info!("[update] запускаю установщик");
    log::logger().flush();
    update.install(bytes).map_err(failed)
}

/// Аргументы, с которыми установщик снова запустит приложение после
/// обновления: аргументы этого процесса без флага автозапуска. С флагом
/// обновлённое приложение стартовало бы спрятанным в трей, хотя человек
/// только что нажал «Обновить» в окне.
pub fn restart_args(args: impl IntoIterator<Item = OsString>) -> Vec<OsString> {
    args.into_iter()
        .filter(|a| a.as_os_str() != crate::autostart::FLAG)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_args_drop_the_autostart_flag_and_keep_the_rest() {
        let args = [
            "C:\\Apps\\Kitsudock\\kitsudock.exe",
            "--autostart",
            "--other",
        ]
        .map(OsString::from);
        assert_eq!(
            restart_args(args),
            ["C:\\Apps\\Kitsudock\\kitsudock.exe", "--other"].map(OsString::from)
        );
        let plain = [OsString::from("kitsudock.exe")];
        assert_eq!(restart_args(plain.clone()), plain);
    }

    #[test]
    fn the_updater_settings_in_tauri_conf_are_accepted_by_the_plugin() {
        // Настройки, которые плагин не примет, остановили бы приложение на
        // старте, ещё до окна.
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater: tauri_plugin_updater::Config =
            serde_json::from_value(conf["plugins"]["updater"].clone()).unwrap();
        assert_eq!(
            updater
                .endpoints
                .iter()
                .map(|u| u.as_str())
                .collect::<Vec<_>>(),
            ["https://github.com/Ertezy/Kitsudock/releases/latest/download/latest.json"]
        );
        assert!(!updater.pubkey.trim().is_empty());
        assert!(!updater.dangerous_insecure_transport_protocol);
        assert!(!updater.dangerous_accept_invalid_certs);
        assert!(!updater.dangerous_accept_invalid_hostnames);
        assert!(!updater.allow_downgrades);
        assert_eq!(updater.windows.unwrap().install_mode.to_string(), "passive");
    }
}
