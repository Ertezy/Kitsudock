//! Команды — единственный мост между интерфейсом и системой.
//! Все обращения к файлам, реестру и оболочке живут здесь и глубже.
//!
//! Все команды асинхронные: синхронные в Tauri выполняются в главном потоке
//! и подмораживали бы окно на чтении файлов и запуске процессов.
//!
//! Сеть внутри команды — только через `blocking`: рабочие потоки async-пула
//! общие для всех команд и для `asset://`, и медленный сервер не должен их
//! занимать. Остальные команды сети не касаются: докачку картинок магазинов и
//! лаунчера по-прежнему ведут собственные потоки (`art.rs`, `launcher_art.rs`).
//!
//! Команда, ошибку которой страница показывает человеку, возвращает
//! `AppError` — код и подробность; фразу на выбранном языке собирает страница
//! (спека этапа 6 §6.2). Команды, чьи ошибки страница не показывает
//! (`get_config_dir`, `get_hub`, `cache_image`), отдают текст, как раньше.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::config::{self, Game, Language, Launch, VideoLanguage};
use crate::error::{code, AppError};
use crate::hub;
use crate::launch;

/// Запись конфига из команды: текст ошибки сохранения уходит подробностью.
fn save_config(app: &AppHandle, cfg: &config::AppConfig) -> Result<(), AppError> {
    config::save(app, cfg).map_err(|e| AppError::with(code::CONFIG_SAVE_FAILED, e))
}

/// Блокирующая работа команды — сетевой запрос — на пуле для блокирующего.
///
/// Тело `async`-команды идёт на рабочих потоках общего пула, и те же потоки
/// обслуживают остальные команды и протокол `asset://`. Запрос, который
/// ждёт медленный сервер, держал бы такой поток до конца срока, а десяток
/// слайдов карусели с картинками занял бы их все: запуск игры и список игр
/// стояли бы в очереди. Поэтому всё, что ждёт сеть, зовётся только отсюда.
///
/// Синхронной командой это не заменить: в Tauri она выполняется в главном
/// потоке и подвесила бы окно. Оборвавшаяся работа (паника) возвращается той
/// же ошибкой-строкой, какую команда отдаёт и при обычном отказе.
async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("фоновая работа оборвалась: {e}"))?
}

/// Вид запуска кодом — слово на языке интерфейса подставляет страница
/// (спека этапа 6 §6.3). Названия магазинов не переводятся, но и они живут
/// в словаре страницы, рядом с остальным текстом подписи.
fn source_kind(launch: &Launch) -> &'static str {
    match launch {
        Launch::Steam { .. } => "steam",
        Launch::Epic { .. } => "epic",
        Launch::Exe => "exe",
    }
}

/// Подпись найденной игры на экране сканирования. У игры из собственного
/// лаунчера способ запуска — прямой `exe`, и по нему не понять, откуда она;
/// поэтому там подпись берётся из источника. У остальных — из способа запуска,
/// как и у настроенных игр. Уже добавленная игра всегда `exe` (`GameView`),
/// эта подпись живёт только до добавления.
fn found_kind(found: &crate::stores::InstalledGame) -> &'static str {
    use crate::stores::Source;
    match found.source {
        Source::HoYoPlay => "hoyoplay",
        Source::Kuro => "kuro",
        Source::Gryphlink => "gryphlink",
        Source::Steam | Source::Epic => source_kind(&found.launch),
    }
}

/// Игра в том виде, в каком её рисует интерфейс.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameView {
    pub id: String,
    pub title: String,
    pub content_id: Option<String>,
    /// Вид запуска кодом (`"steam" | "epic" | "exe"`) — слово подставляет страница.
    pub source_kind: &'static str,
    /// Путь к файлу иконки на диске. `None` — рисуется заглушка с буквой.
    pub icon_path: Option<String>,
    /// Путь к фоновой картинке. `None` — рисуется сгенерированная заливка.
    pub art_path: Option<String>,
    /// Откуда взят фон, показанный первым (спека этапа 5, §2.1).
    pub art_source: crate::art::ArtSource,
    /// Видео фона: своё или официальное из HoYoPlay (смотри `art_source`).
    /// `None` — видео нет или файл пропал.
    pub video_path: Option<String>,
    /// Своё видео задано, но файла нет на месте или это не mp4 и не webm (спека §6.1, §6.5).
    pub video_missing: bool,
    /// Аргументы запуска. Действуют только при прямом запуске — Steam и Epic
    /// открывают ссылку магазина и передать их игре не могут (`launch.rs`).
    pub args: String,
    /// Файл или папка игры пропали с диска.
    pub missing: bool,
}

/// Часть представления игры, не требующая `AppHandle`.
///
/// Выделена отдельной функцией, чтобы её можно было проверять в модульных
/// тестах напрямую: `AppHandle` там взять неоткуда (тот же приём, что и у
/// `is_fresh` в `icons.rs` или `reject_if_newer_than_current` в `config.rs`).
/// `icon_path` и `art_path` здесь всегда `None` — их выставляет только
/// `view_of`.
fn view_of_without_icon(game: &Game) -> GameView {
    GameView {
        id: game.id.clone(),
        title: game.title.clone(),
        content_id: game.content_id.clone(),
        source_kind: source_kind(&game.launch),
        icon_path: None,
        art_path: None,
        art_source: crate::art::ArtSource::Fill,
        video_path: None,
        video_missing: game.video.as_ref().is_some_and(|v| !crate::art::is_usable_video(v)),
        args: game.args.clone(),
        missing: !config::is_present(game),
    }
}

pub fn view_of(app: &AppHandle, game: &Game, ctx: &crate::art::ArtContext) -> GameView {
    let art = crate::art::resolve(app, game, ctx);
    GameView {
        icon_path: crate::icons::ensure(app, game).map(|p| p.to_string_lossy().into_owned()),
        art_path: art.art_path.map(|p| p.to_string_lossy().into_owned()),
        art_source: art.source,
        video_path: art.video_path.map(|p| p.to_string_lossy().into_owned()),
        ..view_of_without_icon(game)
    }
}

#[tauri::command]
pub async fn get_games(app: AppHandle) -> Vec<GameView> {
    let cfg = config::load(&app);
    // Фоны официального лаунчера — из файла хаба, без сети (спека 2026-10-02 §3).
    let hub = crate::hub::load_local(&app);
    let ctx = crate::art::ArtContext::build(cfg.store_art, &cfg.games, &hub.games);
    let views = cfg.games.iter().map(|g| view_of(&app, g, &ctx)).collect();
    // Докачка недостающих картинок Epic стартует отсюда: список игр строится
    // при запуске, после настроек и после каждой их правки, так что одна
    // дорога покрывает все случаи (спека §3.3).
    crate::art::start_missing_downloads(&app, &cfg.games, &ctx);
    crate::launcher_art::start_downloads(&app, ctx.launcher_urls(&cfg.games));
    views
}

#[tauri::command]
pub async fn get_config(app: AppHandle) -> config::AppConfig {
    config::load(&app)
}

#[tauri::command]
pub async fn get_config_dir(app: AppHandle) -> Result<String, String> {
    Ok(config::config_dir(&app)?.to_string_lossy().into_owned())
}

/// Запуск игры и запоминание «последней» — общий путь для кнопки Play и
/// меню трея (спека этапа 7 §5).
pub fn launch_and_remember(app: &AppHandle, game_id: &str) -> Result<(), AppError> {
    let mut cfg = config::load(app);
    let game = cfg
        .games
        .iter()
        .find(|g| g.id == game_id)
        .cloned()
        .ok_or_else(|| AppError::with(code::GAME_NOT_FOUND, game_id.to_string()))?;

    launch::launch(app, &game)?;

    cfg.last_played = Some(game_id.to_string());
    if let Err(e) = config::save(app, &cfg) {
        log::error!("[config] не удалось сохранить lastPlayed: {e}");
    }

    // Проверка трея и сообщение странице живут в одном месте.
    if cfg.behaviour.tray_on_launch {
        crate::tray::hide_main_window(app);
    }
    Ok(())
}

/// Запустить игру. `lastPlayed` пишется только после удачного старта.
#[tauri::command]
pub async fn launch_game(app: AppHandle, game_id: String) -> Result<String, AppError> {
    launch_and_remember(&app, &game_id)?;
    Ok(game_id)
}

#[tauri::command]
pub async fn get_hub(app: AppHandle) -> Result<hub::HubData, String> {
    // До двух запросов, и у каждого свой срок: ждать их на рабочем потоке нельзя.
    blocking(move || {
        let cfg = config::load(&app);
        hub::load(&app, cfg.hub_url.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn get_last_played(app: AppHandle) -> Option<String> {
    config::load(&app).last_played
}

/// Путь к картинке в локальном кеше; качает, если её там нет.
///
/// Интерфейс получает путь к файлу, а не адрес: страница в интернет не ходит.
#[tauri::command]
pub async fn cache_image(app: AppHandle, url: String) -> Result<String, String> {
    // Каждый слайд карусели просит свою картинку, а хост может отвечать
    // десять секунд: на рабочих потоках таких запросов хватило бы на все.
    blocking(move || {
        let path = crate::images::fetch(&app, &url)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// Найденная в магазинах игра — для экрана с галочками.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundGame {
    pub title: String,
    /// Идентификатор контента, если игру знает каталог. `None` — по ней не
    /// будет ни кодов, ни баннеров, и на экране это подписывается честно.
    pub content_id: Option<String>,
    /// Откуда найдена: `"steam" | "epic" | "hoyoplay" | "kuro" | "gryphlink"`
    /// либо `"exe"` — слово подставляет страница.
    pub source_kind: &'static str,
    /// Игра с таким путём уже есть в конфиге — галочку ставить не нужно.
    pub already_added: bool,
}

/// Что нашлось в магазинах. **Конфиг не меняется** — это только предложение,
/// человек сам решает, что добавить.
#[tauri::command]
pub async fn scan_installed(app: AppHandle) -> Vec<FoundGame> {
    let cfg = config::load(&app);
    let hub_games = crate::hub::load_local(&app).games;

    crate::stores::installed()
        .into_iter()
        .map(|found| {
            let content_id = crate::catalog::content_id_for(&found, &hub_games);
            // То же сравнение, что решает, какую запись пользователя
            // дополнить данными установки (`catalog::already_configured`
            // переиспользует его же) — а не отдельное по exePath: у игр
            // Steam он всегда `None` (см. `stores::steam`), и такое
            // сравнение никогда не находило бы совпадение.
            let already_added = crate::catalog::already_configured(&found, &cfg.games, &hub_games);
            let source_kind = found_kind(&found);
            FoundGame {
                title: found.title,
                content_id,
                source_kind,
                already_added,
            }
        })
        .collect()
}

/// Добавить игру, найденную в магазинах, по её названию.
///
/// Отдельная команда, а не `add_game`: у найденной игры уже известны способ
/// запуска и пути из манифеста, и терять их, сводя всё к `Launch::Exe`,
/// нельзя — тогда игра из Steam перестала бы запускаться через Steam.
#[tauri::command]
pub async fn add_game_from_scan(app: AppHandle, title: String) -> Result<String, AppError> {
    let hub_games = crate::hub::load_local(&app).games;
    let found = crate::stores::installed()
        .into_iter()
        .find(|g| g.title == title)
        .ok_or_else(|| AppError::with(code::GAME_NOT_FOUND, title.clone()))?;

    let content_id = crate::catalog::content_id_for(&found, &hub_games);
    let mut cfg = config::load(&app);
    let id = crate::library::add_found(
        &mut cfg,
        found.title,
        content_id,
        found.launch,
        found.install_path,
        found.exe_path,
    )?;
    save_config(&app, &cfg)?;
    crate::tray::rebuild_menu(&app);
    Ok(id)
}

/// Пометить, что первый запуск состоялся — независимо от того, добавил ли
/// человек что-то с экрана предложений или нажал «Пропустить». Пропуск это
/// тоже осознанное решение, и повторно спрашивать нельзя.
#[tauri::command]
pub async fn mark_seeded(app: AppHandle) -> Result<(), AppError> {
    let mut cfg = config::load(&app);
    cfg.seeded = true;
    save_config(&app, &cfg)
}

/// Нужно ли показать экран первого запуска вместо главного экрана.
#[tauri::command]
pub async fn needs_first_run(app: AppHandle) -> bool {
    !config::load(&app).seeded
}

/// Общий помощник: прочитать конфиг, изменить, записать.
///
/// Отказ правки — `GAME_NOT_FOUND` без подробности: помощник не знает, какая
/// игра имелась в виду (у `reorder_games` их целый список).
fn with_config<F>(app: &AppHandle, f: F) -> Result<(), AppError>
where
    F: FnOnce(&mut config::AppConfig) -> bool,
{
    let mut cfg = config::load(app);
    if !f(&mut cfg) {
        return Err(AppError::new(code::GAME_NOT_FOUND));
    }
    save_config(app, &cfg)?;
    crate::tray::rebuild_menu(app);
    Ok(())
}

#[tauri::command]
pub async fn add_game(app: AppHandle, title: String, exe: String) -> Result<String, AppError> {
    let exe = std::path::PathBuf::from(exe);
    // Путь вводит человек, значит это недоверенный ввод: проверяем, что файл
    // существует, до того как записать его в конфиг.
    if !exe.is_file() {
        return Err(AppError::with(code::FILE_MISSING, exe.display().to_string()));
    }
    // Название тоже вводит человек — проверяем перед записью в конфиг.
    crate::library::validate_title(&title)?;
    let mut cfg = config::load(&app);
    let id = crate::library::add(&mut cfg, title, exe);
    save_config(&app, &cfg)?;
    crate::tray::rebuild_menu(&app);
    Ok(id)
}

#[tauri::command]
pub async fn update_game(
    app: AppHandle,
    game_id: String,
    title: Option<String>,
    exe: Option<String>,
    // Пустая строка означает «убрать свой фон»: null при переходе из JSON
    // неотличим от «поле не передали».
    background: Option<String>,
    // Пустая строка означает «убрать свою картинку»: null при переходе из
    // JSON неотличим от «поле не передали».
    icon: Option<String>,
    // Пустая строка означает «убрать своё видео»: null при переходе из JSON
    // неотличим от «поле не передали».
    video: Option<String>,
    // Пустая строка означает «стереть привязку»: null для этого не годится,
    // потому что при переходе из JSON он неотличим от «поле не передали».
    content_id: Option<String>,
    // Один уровень, как у `title`: `None` — не трогать, `Some` — заменить
    // целиком. Пустая строка здесь не признак стирания, а обычное значение
    // «нет аргументов».
    args: Option<String>,
) -> Result<(), AppError> {
    let exe_path = match exe {
        Some(p) => {
            let p = std::path::PathBuf::from(p);
            if !p.is_file() {
                return Err(AppError::with(code::FILE_MISSING, p.display().to_string()));
            }
            Some(p)
        }
        None => None,
    };
    // Название вводит человек — проверяем перед записью в конфиг.
    if let Some(title_val) = &title {
        crate::library::validate_title(title_val)?;
    }
    // Пустая строка стирает видео и проверке не подлежит. Непустая проходит
    // ту же проверку, что и перед выбором файла (`check_video`): страница не
    // единственная защита (спека §12).
    if let Some(v) = &video {
        if !v.is_empty() {
            if let Some(problem) = crate::art::video_file_problem(std::path::Path::new(v)) {
                return Err(problem);
            }
        }
    }
    let patch = crate::library::GamePatch {
        title,
        exe_path,
        background: background.map(|s| (!s.is_empty()).then(|| std::path::PathBuf::from(s))),
        icon: icon.map(|s| (!s.is_empty()).then(|| std::path::PathBuf::from(s))),
        video: video.map(|s| (!s.is_empty()).then(|| std::path::PathBuf::from(s))),
        content_id: content_id.map(|s| (!s.is_empty()).then_some(s)),
        args,
    };
    with_config(&app, |cfg| crate::library::update(cfg, &game_id, patch))
}

#[tauri::command]
pub async fn remove_game(app: AppHandle, game_id: String) -> Result<(), AppError> {
    with_config(&app, |cfg| crate::library::remove(cfg, &game_id))
}

#[tauri::command]
pub async fn reorder_games(app: AppHandle, ids: Vec<String>) -> Result<(), AppError> {
    with_config(&app, |cfg| crate::library::reorder(cfg, &ids))
}

#[tauri::command]
pub async fn relocate_game(app: AppHandle, game_id: String) -> Result<(), AppError> {
    let hub_games = crate::hub::load_local(&app).games;
    let installed = crate::stores::installed();
    with_config(&app, |cfg| {
        cfg.games
            .iter_mut()
            .find(|g| g.id == game_id)
            .map(|g| crate::catalog::relocate(g, &installed, &hub_games))
            .unwrap_or(false)
    })
}

#[tauri::command]
pub async fn get_behaviour(app: AppHandle) -> config::Behaviour {
    config::load(&app).behaviour
}

#[tauri::command]
pub async fn set_behaviour(
    app: AppHandle,
    close_to_tray: bool,
    tray_on_launch: bool,
) -> Result<(), AppError> {
    let mut cfg = config::load(&app);
    cfg.behaviour = config::Behaviour {
        close_to_tray,
        tray_on_launch,
    };
    save_config(&app, &cfg)
}

#[tauri::command]
pub async fn get_store_art(app: AppHandle) -> bool {
    config::load(&app).store_art
}

#[tauri::command]
pub async fn set_store_art(app: AppHandle, enabled: bool) -> Result<(), AppError> {
    let mut cfg = config::load(&app);
    cfg.store_art = enabled;
    save_config(&app, &cfg)
}

#[tauri::command]
pub async fn get_animation(app: AppHandle) -> bool {
    config::load(&app).animation
}

#[tauri::command]
pub async fn set_animation(app: AppHandle, enabled: bool) -> Result<(), AppError> {
    let mut cfg = config::load(&app);
    cfg.animation = enabled;
    save_config(&app, &cfg)
}

#[tauri::command]
pub async fn get_language(app: AppHandle) -> Language {
    config::load(&app).language
}

/// Меню трея переименовывается сразу — как и страница, без перезапуска.
#[tauri::command]
pub async fn set_language(app: AppHandle, language: Language) -> Result<(), AppError> {
    let mut cfg = config::load(&app);
    cfg.language = language;
    save_config(&app, &cfg)?;
    crate::tray::rebuild_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn get_video_language(app: AppHandle) -> VideoLanguage {
    config::load(&app).video_language
}

#[tauri::command]
pub async fn set_video_language(
    app: AppHandle,
    language: VideoLanguage,
) -> Result<(), AppError> {
    let mut cfg = config::load(&app);
    cfg.video_language = language;
    save_config(&app, &cfg)
}

/// Включён ли автозапуск — по реестру, а не по конфигу (спека этапа 7 §4.1).
#[tauri::command]
pub async fn get_autostart() -> bool {
    crate::autostart::read().is_some()
}

#[tauri::command]
pub async fn set_autostart(enabled: bool) -> Result<(), AppError> {
    let result = if enabled {
        std::env::current_exe().and_then(|exe| crate::autostart::enable(&exe))
    } else {
        crate::autostart::disable()
    };
    result.map_err(|e| AppError::with(code::AUTOSTART_FAILED, e.to_string()))
}

/// Проверяет выбранный файл видео и, если он годится, разрешает окну его
/// прочитать — до записи в конфиг странице ещё нужно измерить размер кадра в
/// точках, открыв файл детачнутым `<video>` (см. `LookSection.tsx`, §1.2).
/// Разбор mp4 и webm на стороне Rust ради одних только размеров кадра
/// пришлось бы писать вручную — своего парсера в зависимостях нет.
#[tauri::command]
pub async fn check_video(app: AppHandle, path: String) -> Result<(), AppError> {
    let path = std::path::PathBuf::from(path);
    if let Some(problem) = crate::art::video_file_problem(&path) {
        return Err(problem);
    }
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| AppError::with(code::VIDEO_PICK_FAILED, e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn set_hub_url(app: AppHandle, url: Option<String>) -> Result<(), AppError> {
    // Пустая строка означает «нет адреса», а не адрес из пустой строки.
    let url = url.filter(|u| !u.trim().is_empty());
    if let Some(u) = &url {
        if !crate::hub::is_safe_https(u) {
            return Err(AppError::new(code::HUB_URL_NOT_HTTPS));
        }
    }
    let mut cfg = config::load(&app);
    cfg.hub_url = url;
    save_config(&app, &cfg)
}

/// Размер файлов в одной папке кеша, в байтах. Общая часть для картинок хаба
/// и добытых иконок — они лежат в разных папках (`icons::cache_dir`
/// отдельно от `images::cache_dir` намеренно, см. комментарий там), но с
/// точки зрения человека это один кеш с одной кнопкой очистки и одним
/// показанным размером.
fn dir_size(dir: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

/// Удаляет файлы из одной папки кеша. Возвращает количество удалённых.
fn clear_dir(dir: &std::path::Path) -> Result<usize, AppError> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::with(code::CACHE_READ_FAILED, e.to_string()))?;
    let mut removed = 0;
    for entry in entries.flatten() {
        if entry.metadata().map(|m| m.is_file()).unwrap_or(false)
            && std::fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Размер кеша картинок в байтах — чтобы показать его рядом с кнопкой очистки.
/// Считает картинки хаба, добытые иконки и копии фонов: иначе смена своей
/// иконки или фона оставляла бы прежнюю копию на диске навсегда, и её никто
/// бы не увидел и не удалил.
#[tauri::command]
pub async fn image_cache_size(app: AppHandle) -> u64 {
    [
        crate::images::cache_dir(&app),
        crate::icons::cache_dir(&app),
        crate::art::cache_dir(&app),
        crate::launcher_art::cache_dir(&app),
    ]
    .into_iter()
    .filter_map(Result::ok)
    .map(|dir| dir_size(&dir))
    .sum()
}

/// Очищает кеш картинок хаба, кеш добытых иконок, кеш фонов и кеш официальных
/// фонов лаунчера. После очистки иконки и фоны добываются заново сами при
/// следующем обращении к списку игр — `icons::ensure` и `art::resolve` каждый
/// раз проверяют, что файл в кеше есть, и пересоздают его, если нет, а картинки
/// Epic и официальные фоны докачиваются в фоне при следующем построении списка.
#[tauri::command]
pub async fn clear_image_cache(app: AppHandle) -> Result<usize, AppError> {
    // Папку кеша не найти или не создать — своего кода у такой ошибки нет:
    // страница покажет общую фразу с текстом ошибки.
    let internal = |e: String| AppError::with(code::INTERNAL, e);
    let mut removed = 0;
    for dir in [
        crate::images::cache_dir(&app).map_err(internal)?,
        crate::icons::cache_dir(&app).map_err(internal)?,
        crate::art::cache_dir(&app).map_err(internal)?,
        crate::launcher_art::cache_dir(&app).map_err(internal)?,
    ] {
        removed += clear_dir(&dir)?;
    }
    crate::art::forget_tried_downloads(&app);
    crate::launcher_art::forget_tried_downloads(&app);
    Ok(removed)
}

/// Сведения для раздела «О программе».
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct About {
    pub version: String,
    pub log_path: String,
}

#[tauri::command]
pub async fn get_about(app: AppHandle) -> About {
    let log_path = app
        .path()
        .app_log_dir()
        .map(|d| d.to_string_lossy().into_owned())
        .unwrap_or_default();
    About {
        version: app.package_info().version.to_string(),
        log_path,
    }
}

/// Открыть папку журнала в проводнике.
#[tauri::command]
pub async fn open_log_folder(app: AppHandle) -> Result<(), AppError> {
    // `open_path` — метод на `Opener`, а не свободная функция; добраться до
    // него можно только через расширение `OpenerExt`.
    use tauri_plugin_opener::OpenerExt;

    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| AppError::with(code::LOG_FOLDER_MISSING, e.to_string()))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::with(code::OPEN_FOLDER_FAILED, e.to_string()))
}

/// Дольше этого сообщение интерфейса в журнал не идёт: стек падения бывает
/// длиной в килобайты, а нужна только суть.
const MAX_UI_ERROR_CHARS: usize = 500;

/// Строка журнала из текста, который прислало окно. Окну доверять нельзя:
/// перевод строки в тексте дописал бы в журнал «чужую» запись, а управляющие
/// знаки испортили бы его при чтении. Поэтому каждый управляющий и пробельный
/// знак (в том числе перевод строки) становится пробелом, подряд идущие
/// пробелы сворачиваются, текст режется до `MAX_UI_ERROR_CHARS` знаков.
fn ui_error_line(message: &str) -> String {
    let mut text = String::new();
    for c in message.chars() {
        let c = if c.is_control() || c.is_whitespace() { ' ' } else { c };
        if c == ' ' && (text.is_empty() || text.ends_with(' ')) {
            continue;
        }
        text.push(c);
    }
    let cut: String = text.chars().take(MAX_UI_ERROR_CHARS).collect();
    format!("[ui] {cut}").trim_end().to_string()
}

/// Записать в журнал ошибку, из-за которой упал интерфейс: у окна своего
/// моста к журналу нет. Ничего не возвращает и не падает: журнал — не повод
/// для второй ошибки поверх первой.
#[tauri::command]
pub async fn report_ui_error(message: String) {
    log::error!("{}", ui_error_line(&message));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Game, Launch};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Condvar, Mutex};
    use std::time::Duration;

    fn steam_game() -> Game {
        Game {
            id: "wuthering".into(),
            title: "Wuthering Waves".into(),
            content_id: Some("wuthering".into()),
            launch: Launch::Steam { appid: 3513350 },
            install_path: Some(std::path::PathBuf::from(r"C:\nope\never")),
            exe_path: None,
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }
    }

    #[test]
    fn a_ui_error_goes_to_the_log_as_one_tagged_line() {
        assert_eq!(
            ui_error_line("TypeError: x is undefined"),
            "[ui] TypeError: x is undefined"
        );
    }

    #[test]
    fn newlines_and_control_characters_cannot_split_or_forge_a_log_line() {
        let line = ui_error_line("boom\r\n[error] forged\n\tat f()\u{0}\u{1b}[31m\u{2028}end");
        assert_eq!(line, "[ui] boom [error] forged at f() [31m end");
        assert!(!line.chars().any(|c| c.is_control()), "{line:?}");
    }

    #[test]
    fn a_ui_error_is_cut_to_500_characters_not_bytes() {
        let long = "ж".repeat(2000);
        let line = ui_error_line(&long);
        assert_eq!(line.chars().count(), "[ui] ".chars().count() + 500);
        assert!(line.ends_with('ж'));
        // Ровно на пределе — без изменений; пробел на срезе не остаётся.
        assert_eq!(ui_error_line(&"a".repeat(500)).chars().count(), 5 + 500);
        let spaced = format!("{} tail", "a".repeat(499));
        assert_eq!(ui_error_line(&spaced), format!("[ui] {}", "a".repeat(499)));
    }

    #[test]
    fn an_empty_ui_error_still_leaves_a_line() {
        assert_eq!(ui_error_line(""), "[ui]");
        assert_eq!(ui_error_line(" \n\t "), "[ui]");
    }

    #[test]
    fn view_labels_the_store_a_game_starts_through() {
        assert_eq!(view_of_without_icon(&steam_game()).source_kind, "steam");
    }

    #[test]
    fn epic_games_are_labelled_as_epic() {
        let mut g = steam_game();
        g.launch = Launch::Epic {
            namespace: "ns".into(),
            catalog_item_id: "cid".into(),
            app_name: "app".into(),
        };
        assert_eq!(view_of_without_icon(&g).source_kind, "epic");
    }

    #[test]
    fn view_marks_a_game_whose_folder_disappeared() {
        assert!(view_of_without_icon(&steam_game()).missing);
    }

    #[test]
    fn exe_games_are_labelled_as_direct() {
        let mut g = steam_game();
        g.launch = Launch::Exe;
        assert_eq!(view_of_without_icon(&g).source_kind, "exe");
    }

    #[test]
    fn blocking_work_runs_off_the_async_workers() {
        // Задача команды крутится на рабочем потоке async-пула, а её
        // блокирующая часть обязана уйти на другой поток.
        let (polled_on, ran_on) = tauri::async_runtime::block_on(tauri::async_runtime::spawn(async {
            let polled_on = std::thread::current().id();
            let ran_on = blocking(|| Ok(std::thread::current().id())).await.unwrap();
            (polled_on, ran_on)
        }))
        .unwrap();
        assert_ne!(polled_on, ran_on);
    }

    #[test]
    fn slow_downloads_do_not_hold_up_other_commands() {
        // Медленных заданий заведомо больше, чем рабочих потоков пула; все
        // они стоят у закрытых ворот. Быстрая команда обязана выполниться,
        // пока ворота закрыты. Сторож откроет их сам через три секунды, чтобы
        // сломанный код дал упавший тест, а не зависший.
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let released = Arc::new(AtomicBool::new(false));
        let open_gate = {
            let gate = gate.clone();
            move || {
                *gate.0.lock().unwrap() = true;
                gate.1.notify_all();
            }
        };
        let workers = std::thread::available_parallelism().map_or(8, |n| n.get());

        let slow: Vec<_> = (0..workers * 4)
            .map(|_| {
                let gate = gate.clone();
                tauri::async_runtime::spawn(async move {
                    blocking(move || {
                        let mut open = gate.0.lock().unwrap();
                        while !*open {
                            open = gate.1.wait(open).unwrap();
                        }
                        Ok(())
                    })
                    .await
                })
            })
            .collect();

        let (done, watchdog_done) = mpsc::channel::<()>();
        let watchdog = {
            let released = released.clone();
            let open_gate = open_gate.clone();
            std::thread::spawn(move || {
                if watchdog_done.recv_timeout(Duration::from_secs(3)).is_err() {
                    released.store(true, Ordering::SeqCst);
                    open_gate();
                }
            })
        };

        let quick = tauri::async_runtime::block_on(tauri::async_runtime::spawn(async { 7 })).unwrap();
        let held_back = released.load(Ordering::SeqCst);

        done.send(()).unwrap();
        watchdog.join().unwrap();
        open_gate();
        for job in slow {
            tauri::async_runtime::block_on(job).unwrap().unwrap();
        }
        assert_eq!(quick, 7);
        assert!(!held_back, "быстрая команда дождалась, пока медленные закончат");
    }

    #[test]
    fn the_work_error_reaches_the_page_unchanged() {
        let result = tauri::async_runtime::block_on(blocking::<(), _>(|| Err("нет сети".to_string())));
        assert_eq!(result, Err("нет сети".to_string()));
    }

    #[test]
    fn work_that_panics_becomes_an_error_instead_of_a_hung_call() {
        let result = tauri::async_runtime::block_on(blocking(|| -> Result<(), String> {
            panic!("сбой внутри загрузки")
        }));
        assert!(result.is_err());
    }

    fn found_game(launch: Launch, source: crate::stores::Source) -> crate::stores::InstalledGame {
        crate::stores::InstalledGame {
            title: "Wuthering Waves".into(),
            install_path: std::path::PathBuf::from(r"C:\Games\Wuthering Waves"),
            exe_path: Some(std::path::PathBuf::from(r"C:\Games\Wuthering Waves\Client.exe")),
            launch,
            source,
        }
    }

    #[test]
    fn scan_labels_launcher_finds_by_their_source() {
        use crate::stores::Source;
        for (source, label) in [
            (Source::HoYoPlay, "hoyoplay"),
            (Source::Kuro, "kuro"),
            (Source::Gryphlink, "gryphlink"),
        ] {
            // Способ запуска у всех троих один и тот же — прямой exe.
            assert_eq!(found_kind(&found_game(Launch::Exe, source)), label);
        }
    }

    #[test]
    fn scan_labels_store_finds_by_how_they_start() {
        use crate::stores::Source;
        assert_eq!(
            found_kind(&found_game(Launch::Steam { appid: 3513350 }, Source::Steam)),
            "steam"
        );
        let epic = Launch::Epic {
            namespace: "ns".into(),
            catalog_item_id: "cid".into(),
            app_name: "app".into(),
        };
        assert_eq!(found_kind(&found_game(epic, Source::Epic)), "epic");
    }

    /// Отдельная папка на тег теста, а не общий путь: тесты этого файла пишут
    /// на диск и выполняются в одном процессе параллельно.
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gh-cmd-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn dir_size_sums_the_files_in_a_folder() {
        // Ровно то, что раньше не считало иконки: если бы папка иконок не
        // попадала в подсчёт, эта сумма не изменилась бы от файлов внутри.
        let dir = temp_dir("dirsize");
        std::fs::write(dir.join("a.png"), vec![0u8; 10]).unwrap();
        std::fs::write(dir.join("b.png"), vec![0u8; 5]).unwrap();
        assert_eq!(dir_size(&dir), 15);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dir_size_of_a_missing_folder_is_zero() {
        assert_eq!(dir_size(std::path::Path::new(r"C:\nope\never\missing")), 0);
    }

    #[test]
    fn clear_dir_removes_files_and_reports_the_count() {
        let dir = temp_dir("cleardir");
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        std::fs::write(dir.join("b.png"), b"y").unwrap();
        assert_eq!(clear_dir(&dir).unwrap(), 2);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn clear_dir_on_a_missing_folder_is_an_error_not_a_panic() {
        let err = clear_dir(std::path::Path::new(r"C:\nope\never\missing")).unwrap_err();
        assert_eq!(err.code, code::CACHE_READ_FAILED);
        assert!(err.detail.is_some(), "текст ошибки чтения должен дойти до страницы");
    }

    #[test]
    fn view_marks_a_video_whose_file_disappeared() {
        let mut g = steam_game();
        g.video = Some(std::path::PathBuf::from(r"C:\nope\never.mp4"));
        let view = view_of_without_icon(&g);
        assert!(view.video_missing);
        assert_eq!(view.video_path, None);
        assert_eq!(view.art_source, crate::art::ArtSource::Fill);
    }

    #[test]
    fn a_video_that_is_not_mp4_or_webm_counts_as_missing() {
        let dir = temp_dir("video-ext");
        let file = dir.join("clip.txt");
        std::fs::write(&file, b"x").unwrap();
        let mut g = steam_game();
        g.video = Some(file);
        assert!(view_of_without_icon(&g).video_missing);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn image_cache_size_sums_hub_icon_and_art_folders() {
        // Раньше папка арта не входила ни в подсчёт, ни в очистку — свои
        // фоны копились на диске без счётчика и без кнопки, которая могла
        // бы их убрать. Три отдельные папки одной природы: их сумма и есть
        // то число, что видит человек в настройках.
        let hub = temp_dir("cachesize-hub");
        let icons = temp_dir("cachesize-icons");
        let art = temp_dir("cachesize-art");
        std::fs::write(hub.join("a.png"), vec![0u8; 4]).unwrap();
        std::fs::write(icons.join("b.png"), vec![0u8; 7]).unwrap();
        std::fs::write(art.join("c.png"), vec![0u8; 11]).unwrap();

        let total: u64 = [&hub, &icons, &art].into_iter().map(|d| dir_size(d)).sum();
        assert_eq!(total, 22);

        std::fs::remove_dir_all(&hub).ok();
        std::fs::remove_dir_all(&icons).ok();
        std::fs::remove_dir_all(&art).ok();
    }
}
