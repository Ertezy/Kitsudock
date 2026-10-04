mod art;
mod autostart;
mod catalog;
mod commands;
mod config;
mod error;
mod hub;
mod i18n;
mod ico;
mod icons;
mod images;
mod instance;
mod launch;
mod launcher_art;
mod library;
mod localcopy;
mod migrate;
mod pe;
mod stores;
mod storeart;
mod tray;
mod vdf;

use std::sync::{Arc, Mutex};

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

/// Слот на время между стартом ответчика и появлением `AppHandle`: значок
/// трея и окно ещё не созданы, когда мог прийти первый запрос показать окно
/// (спека этапа 7 §4.3). Пока `handle` нет, запрос откладывается в `pending`
/// и выполняется, как только `setup()` отдаст сюда `AppHandle`.
#[derive(Default)]
struct ShowSlot {
    handle: Option<tauri::AppHandle>,
    pending: bool,
}

/// Дополняет уже существующие записи данными из манифестов магазинов (важно
/// для тех, что перенеслись из v1 без данных о запуске: см.
/// `catalog::enrich_from_stores`). Список игр больше не заполняется здесь
/// автоматически — на первом запуске это делает экран с галочками, и
/// человек сам решает, что добавить.
fn sync_games_with_stores(app: &tauri::AppHandle) {
    let mut cfg = config::load(app);
    let installed = stores::installed();
    // Локальная копия, без сети: setup() выполняется до появления окна,
    // и сетевой запрос отсюда заставил бы окно ждать сеть (спека §3.4).
    let hub_games = hub::load_local(app).games;

    if catalog::enrich_from_stores(&mut cfg.games, &installed, &hub_games) {
        if let Err(e) = config::save(app, &cfg) {
            log::error!("[setup] не удалось сохранить конфиг: {e}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let identity = instance::current_identity();
    // Второй запуск передаёт просьбу показать окно первому и закрывается
    // (спека этапа 7 §4.3).
    let listener = match instance::claim(instance::PORT, &identity) {
        instance::Start::Handed => return,
        instance::Start::First(listener) => Some(listener),
        instance::Start::Alone => None,
    };
    let autostarted = autostart::launched_by(std::env::args());

    // Отвечать на просьбы показать окно начинаем сразу здесь, а не в конце
    // setup(): второй экземпляр ждёт ответа всего 500 мс (`instance::WAIT`),
    // а до трея и окна путь длиннее — WebView2, сканирование магазинов, чистка
    // кеша картинок. `AppHandle` появится только в setup(), поэтому до тех пор
    // запрос просто откладывается в `ShowSlot::pending`.
    let show_slot: Arc<Mutex<ShowSlot>> = Arc::default();
    if let Some(listener) = listener {
        let slot = show_slot.clone();
        instance::serve(listener, identity, move || {
            let mut slot = slot.lock().unwrap();
            match &slot.handle {
                Some(handle) => tray::restore(handle),
                None => slot.pending = true,
            }
        });
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Видимость окна решает код приложения (старт в трей при автозапуске,
        // спека этапа 7 §4.2), плагин хранит только размер и положение: сам
        // восстановленный «развёрнуто» на скрытом автозапуском окне на миг
        // показал бы и активировал его при входе в систему.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                // В файл и в терминал сразу: файл нужен людям, терминал — нам
                // при разработке.
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                // Журнал попадает к посторонним при разборе жалобы, поэтому
                // в нём только техническое: пути, коды ошибок, счётчики.
                .level(log::LevelFilter::Info)
                .max_file_size(512 * 1024)
                .build(),
        )
        .manage(art::StoreArtDownloads::default())
        .manage(launcher_art::LauncherArtDownloads::default())
        .setup(move |app| {
            // Перенос со старой установки: до первого чтения конфига. Раньше
            // его никто не читает, а после первого же сохранения в новой
            // папке появится свой `config.json`, и переносить станет нечего.
            migrate::from_gacha_hub(&app.handle().clone());
            sync_games_with_stores(&app.handle().clone());
            // Уборка кеша картинок при запуске: дёшево, и без неё папка
            // за год превращается в свалку.
            if let Ok(dir) = images::cache_dir(&app.handle().clone()) {
                let removed = images::evict(&dir, images::MAX_AGE);
                if removed > 0 {
                    log::info!("[images] убрано из кеша: {removed}");
                }
            }
            let handle = app.handle().clone();
            // Провал трея не должен мешать запуску: без значка крестик просто
            // закроет приложение вместо того, чтобы прятать его (см. tray.rs
            // и обработчик CloseRequested ниже).
            let tray_ok = match tray::setup(&handle) {
                Ok(()) => true,
                Err(e) => {
                    log::error!("[tray] не удалось создать значок в трее: {e}");
                    false
                }
            };
            // Отдаём AppHandle в слот и забираем просьбу показать окно, если
            // она успела прийти, пока ответчик ещё не мог её выполнить.
            let pending = {
                let mut slot = show_slot.lock().unwrap();
                slot.handle = Some(handle.clone());
                std::mem::take(&mut slot.pending)
            };
            // Окно создаётся скрытым (tauri.conf.json). Показать его, если это
            // не автозапуск, если трея нет, или если во время старта уже
            // пришла просьба показать окно — иначе приложение было бы нечем
            // вернуть (спека этапа 7 §4.2, §4.3).
            if !autostarted || !tray_ok || pending {
                tray::restore(&handle);
            }
            if let Ok(exe) = std::env::current_exe() {
                autostart::refresh_path(&exe);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Крестик прячет окно, а не закрывает приложение, если так
                // настроено и окно есть чем вернуть (см. `tray::hide_main_window`).
                let cfg = crate::config::load(window.app_handle());
                if cfg.behaviour.close_to_tray && tray::hide_main_window(window.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_games,
            commands::get_config,
            commands::get_config_dir,
            commands::launch_game,
            commands::get_hub,
            commands::get_last_played,
            commands::cache_image,
            commands::scan_installed,
            commands::add_game,
            commands::add_game_from_scan,
            commands::mark_seeded,
            commands::needs_first_run,
            commands::update_game,
            commands::remove_game,
            commands::reorder_games,
            commands::relocate_game,
            commands::get_behaviour,
            commands::set_behaviour,
            commands::get_store_art,
            commands::set_store_art,
            commands::get_animation,
            commands::set_animation,
            commands::get_language,
            commands::set_language,
            commands::get_video_language,
            commands::set_video_language,
            commands::get_autostart,
            commands::set_autostart,
            commands::check_video,
            commands::set_hub_url,
            commands::image_cache_size,
            commands::clear_image_cache,
            commands::get_about,
            commands::open_log_folder,
            commands::report_ui_error
        ])
        .run(tauri::generate_context!())
        .expect("ошибка при запуске приложения");
}
