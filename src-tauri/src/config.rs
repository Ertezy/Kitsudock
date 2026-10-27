//! Пользовательские настройки: %APPDATA%\<identifier>\config.json
//!
//! Схема версии 3. От версии 1 к версии 2 игра стала записью в конфиге,
//! а не константой в коде, и `games` — упорядоченный массив, а не словарь.
//! Порядок значим: он задаёт док на главном экране, а словарь давал бы
//! случайный порядок при каждом запуске. Версия 3 добавляет `seeded` (был ли
//! уже первый запуск) и `behaviour` (настройки поведения окна).
//!
//! Запись атомарная: во временный файл рядом, затем переименование поверх.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::cell::Cell;
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::{AppHandle, Manager};

pub const CURRENT_VERSION: u32 = 3;

/// Один замок на процесс для файла конфига. Команды асинхронные и идут
/// одновременно; без замка две правки вплотную читают один и тот же файл, и
/// записанная второй молча отменяет первую. Читает файл тоже только тот, кто
/// держит замок: чтение старого конфига само его переписывает (перенос
/// версий), а на Windows переименование поверх открытого файла не проходит.
static FILE_LOCK: Mutex<()> = Mutex::new(());

thread_local! {
    /// Держит ли этот поток `FILE_LOCK`. Замок не повторный: `load` или
    /// `update` изнутри `update` ждали бы сами себя вечно. Флаг превращает
    /// такую ошибку в немедленную панику в тестах и отладочной сборке.
    static HOLDS_FILE_LOCK: Cell<bool> = const { Cell::new(false) };
}

/// Взятый `FILE_LOCK`; при освобождении снимает флаг потока.
struct FileGuard {
    _guard: MutexGuard<'static, ()>,
}

impl Drop for FileGuard {
    fn drop(&mut self) {
        HOLDS_FILE_LOCK.with(|held| held.set(false));
    }
}

/// Упавший с паникой держатель замка не должен ронять приложение: файл
/// пишется атомарно, так что на диске всегда целый конфиг, и замок можно
/// брать дальше.
fn lock_file() -> FileGuard {
    debug_assert!(
        !HOLDS_FILE_LOCK.with(Cell::get),
        "замок конфига уже взят этим потоком: load или update внутри update"
    );
    let guard = FILE_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    HOLDS_FILE_LOCK.with(|held| held.set(true));
    FileGuard { _guard: guard }
}

/// Способ запуска определён в `stores`, потому что узнаём мы его из манифеста
/// магазина. Переэкспортируем, чтобы остальной код писал `config::Launch`.
pub use crate::stores::Launch;

/// Одна игра в списке пользователя.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    /// Стабильный идентификатор внутри конфига.
    pub id: String,
    pub title: String,
    /// Связь с контентом в файле хаба. `None` — игра добавлена вручную,
    /// новостей и кодов по ней не будет.
    #[serde(default)]
    pub content_id: Option<String>,
    pub launch: Launch,
    /// Папка установки — по ней проверяем, что игра не переехала.
    #[serde(default)]
    pub install_path: Option<PathBuf>,
    /// Исполняемый файл. Обязателен для `Launch::Exe`.
    #[serde(default)]
    pub exe_path: Option<PathBuf>,
    #[serde(default)]
    pub args: String,
    /// Картинка фона, подставленная пользователем.
    #[serde(default)]
    pub background: Option<PathBuf>,
    /// Картинка иконки, подставленная человеком. Перекрывает добытую из файла
    /// игры: это осознанный выбор, и автоматика его не трогает.
    #[serde(default)]
    pub icon: Option<PathBuf>,
    /// Своё видео фона. Важнее своей картинки и картинки магазина.
    #[serde(default)]
    pub video: Option<PathBuf>,
    /// Человек сам выбрал «нет данных» для этой игры. Пустой `content_id`
    /// бывает и у игры, которую каталог просто не узнал при добавлении, и
    /// такую сверка с магазинами при запуске привязывает заново; выбор
    /// человека она трогать не должна. Нет поля в файле — `false`.
    #[serde(default)]
    pub content_unlinked: bool,
}

impl Game {
    /// Игра без привязки к каталогу контента — добавленная руками.
    /// Пока не вызывается за пределами тестов: конструктор для будущего экрана
    /// добавления вручную.
    #[allow(dead_code)]
    pub fn manual(id: String, title: String) -> Self {
        Self {
            id,
            title,
            content_id: None,
            launch: Launch::Exe,
            install_path: None,
            exe_path: None,
            args: String::new(),
            background: None,
            icon: None,
            video: None,
            content_unlinked: false,
        }
    }
}

/// Настройки поведения окна.
///
/// Крестик по умолчанию прячет окно в трей. После запуска игры окно по
/// умолчанию остаётся: так другую игру можно запустить сразу, не доставая окно
/// из трея. Это умолчание действует с 0.1.1, первой публичной версии.
/// Умолчания нужны только свежей установке и конфигу без блока поведения;
/// сохранённое человеком значение никогда не меняется.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Behaviour {
    /// Крестик прячет окно в трей, а не закрывает приложение.
    pub close_to_tray: bool,
    /// После удачного запуска игры окно уходит в трей.
    pub tray_on_launch: bool,
}

impl Default for Behaviour {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            tray_on_launch: false,
        }
    }
}

/// Язык интерфейса. По умолчанию английский — и для свежей установки, и для
/// конфига, где поля ещё нет.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Ru,
}

/// Язык видео в панели. По умолчанию английский.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoLanguage {
    #[default]
    En,
    Ja,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub version: u32,
    #[serde(default)]
    pub hub_url: Option<String>,
    /// Игра, открытая при следующем запуске. Пишется в момент удачного старта.
    #[serde(default)]
    pub last_played: Option<String>,
    /// Первый запуск уже состоялся. После этого пустой список игр остаётся
    /// пустым: человек, удаливший всё, сделал это осознанно, и возвращать
    /// игры автоматически — значит не слушаться его.
    #[serde(default)]
    pub seeded: bool,
    #[serde(default)]
    pub behaviour: Behaviour,
    /// Брать ли фоны из магазинов. Отсутствие поля означает «включено»: после
    /// обновления фоны появляются у всех, а выбора человека при этом не теряется
    /// — раньше этой настройки не было.
    #[serde(default = "enabled")]
    pub store_art: bool,
    /// Тумблер «Анимация»: видео фона, дрейф картинки, увеличение иконок в
    /// доке, поворот шестерёнки. Заменяет собой системную настройку Windows
    /// «уменьшить движение» — та на приложение больше не влияет. Отсутствие
    /// поля означает «включено», как приложение вело себя до тумблера.
    #[serde(default = "enabled")]
    pub animation: bool,
    /// Язык интерфейса. Нет поля или незнакомое значение — английский.
    #[serde(default)]
    pub language: Language,
    /// Язык видео в панели. Нет поля или незнакомое значение — английский.
    #[serde(default)]
    pub video_language: VideoLanguage,
    #[serde(default)]
    pub games: Vec<Game>,
}

fn enabled() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            hub_url: None,
            last_played: None,
            // Свежая установка: первого запуска ещё не было.
            seeded: false,
            behaviour: Behaviour::default(),
            store_art: true,
            animation: true,
            language: Language::En,
            video_language: VideoLanguage::En,
            games: Vec::new(),
        }
    }
}

/// %APPDATA%\<identifier> — создаётся, если её нет.
pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("не удалось определить папку конфига: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("не удалось создать {}: {e}", dir.display()))?;
    Ok(dir)
}

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("config.json"))
}

/// Перенос конфига версии 1 сразу до текущей версии.
///
/// В версии 1 игры лежали словарём, ключ был идентификатором из зашитого
/// каталога, а способ запуска — строкой `launchMode`. Appid и идентификаторы
/// Epic в конфиге не хранились, поэтому режимы `steam` и `epic` при переносе
/// падают до `Exe`: конкретика подтянется заново из манифестов магазинов.
///
/// Функция пишет `version: CURRENT_VERSION` напрямую, минуя промежуточную
/// версию 2: у человека, пришедшего с версии 1, уже есть игры, так что поля
/// уровня приложения, добавленные в версии 3, получают те же значения, что и
/// при переносе с версии 2 (см. `migrate_v2`).
pub fn migrate_v1(raw: &serde_json::Value) -> Option<AppConfig> {
    let games_obj = raw.get("games")?.as_object()?;
    let mut games = Vec::new();

    for (key, value) in games_obj {
        let Some(entry) = value.as_object() else {
            log::warn!("[config] пропускаю «{key}»: запись не объект");
            continue;
        };
        let args = entry
            .get("args")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let exe_path = entry
            .get("exePath")
            .and_then(|v| v.as_str())
            .map(PathBuf::from);
        let mode = entry.get("launchMode").and_then(|v| v.as_str());
        if entry.contains_key("launchMode") && mode.is_none() {
            log::warn!("[config] пропускаю «{key}»: launchMode не строка");
            continue;
        }

        games.push(Game {
            id: key.clone(),
            title: key.clone(),
            content_id: Some(key.clone()),
            launch: Launch::Exe,
            install_path: None,
            exe_path,
            args,
            background: None,
            icon: None,
            video: None,
            content_unlinked: false,
        });
    }

    games.sort_by(|a, b| a.id.cmp(&b.id));

    Some(AppConfig {
        version: CURRENT_VERSION,
        hub_url: raw
            .get("hubUrl")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_played: None,
        // У человека уже есть игры — первый запуск для него состоялся.
        seeded: true,
        behaviour: Behaviour::default(),
        store_art: true,
        animation: true,
        language: Language::En,
        video_language: VideoLanguage::En,
        games,
    })
}

/// Перенос конфига со второй версии на третью.
///
/// Игры переносятся дословно — это главное требование переноса. Прибавляются
/// только поля уровня приложения: `seeded` — включённым, ведь игры у человека
/// уже есть, а блок поведения — нынешними умолчаниями (`Behaviour`): окно
/// после запуска игры остаётся. Вторая версия публично не выходила, так что
/// чужих настроек это не меняет.
///
/// Разбор по одной записи, а не всем массивом.
///
/// `from_value::<Vec<Game>>` провалил бы всю миграцию из-за одной битой
/// записи, а дальше цепочка необратима: `load` вернул бы пустой конфиг,
/// `sync_games_with_stores` увидел бы пустой список и безусловно сохранил
/// его поверх файла человека. Пять настроенных игр исчезли бы молча.
///
/// Так же устроены соседи в этом файле — `migrate_v1` и ветка текущей
/// версии в `load`: битую запись пропускаем с записью в журнал, остальные
/// сохраняем.
pub fn migrate_v2(raw: &serde_json::Value) -> Option<AppConfig> {
    let raw_games = raw.get("games")?.as_array()?;
    let mut games = Vec::with_capacity(raw_games.len());
    for item in raw_games {
        match serde_json::from_value::<Game>(item.clone()) {
            Ok(game) => games.push(game),
            Err(e) => log::warn!("[config] пропускаю игру при переносе на v3: {e}"),
        }
    }

    Some(AppConfig {
        version: CURRENT_VERSION,
        hub_url: raw
            .get("hubUrl")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_played: raw
            .get("lastPlayed")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        // У человека уже есть игры — первый запуск для него состоялся.
        seeded: true,
        behaviour: Behaviour::default(),
        store_art: true,
        animation: true,
        language: Language::En,
        video_language: VideoLanguage::En,
        games,
    })
}

/// Чтение настроек. Терпимое к поломкам: битая запись по одной игре
/// отбрасывается с записью в лог, остальной конфиг живёт. В `.broken`
/// уезжает файл, который либо не читается с диска, либо читается, но не
/// является JSON — в обоих случаях разобрать его как есть невозможно, и
/// оставлять нечитаемый файл под именем `config.json` означает, что
/// следующий запуск снова получит пустой конфиг вместо предупреждения.
///
/// Файл версии выше `CURRENT_VERSION` (например, записанный более новой
/// сборкой) читается как есть, без понижения `version` до `CURRENT_VERSION`:
/// `save` откажется писать такой конфиг обратно (см. ниже), так что файл
/// остаётся на диске нетронутым — как и подобает записи, которая не сломана
/// и не подлежит миграции.
pub fn load(app: &AppHandle) -> AppConfig {
    let Ok(path) = config_path(app) else {
        return AppConfig::default();
    };
    let _guard = lock_file();
    load_from(&path)
}

/// Чтение по готовому пути — сердцевина `load` и `update`, проверяемая без
/// `AppHandle`.
fn load_from(path: &Path) -> AppConfig {
    if !path.exists() {
        return AppConfig::default();
    }
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            log::error!("[config] {} — не читается ({e}), начинаю с чистого", path.display());
            let _ = fs::rename(path, path.with_file_name("config.json.broken"));
            return AppConfig::default();
        }
    };
    let Ok(raw) = serde_json::from_str::<serde_json::Value>(&text) else {
        log::error!("[config] {} — не JSON, начинаю с чистого", path.display());
        let _ = fs::rename(path, path.with_file_name("config.json.broken"));
        return AppConfig::default();
    };

    let version = raw.get("version").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    if version < 2 {
        return match migrate_v1(&raw) {
            Some(cfg) => {
                // Миграция должна пережить перезапуск сама по себе, а не
                // ждать, пока её случайно сохранит другой вызов (например,
                // sync_games_with_stores, если сверка с магазинами ничего
                // не поменяла). Без этого файл на диске остаётся версии 1
                // и мигрирует заново при каждом старте.
                if let Err(e) = save_to(path, &cfg) {
                    log::error!("[config] не удалось сохранить перенесённый конфиг: {e}");
                }
                cfg
            }
            None => {
                log::error!(
                    "[config] {} — не удалось перенести версию 1 (нет «games» или это не объект), начинаю с чистого",
                    path.display()
                );
                AppConfig::default()
            }
        };
    }

    if version < 3 {
        return match migrate_v2(&raw) {
            Some(cfg) => {
                // Та же причина, что и для версии 1: миграция должна
                // пережить перезапуск сама по себе.
                if let Err(e) = save_to(path, &cfg) {
                    log::error!("[config] не удалось сохранить перенесённый конфиг: {e}");
                }
                cfg
            }
            None => {
                log::error!(
                    "[config] {} — не удалось перенести версию 2 (нет «games» или записи не соответствуют схеме), начинаю с чистого",
                    path.display()
                );
                AppConfig::default()
            }
        };
    }

    if version > CURRENT_VERSION {
        log::warn!(
            "[config] {} — версия файла ({version}) новее, чем понимает эта сборка (умеет до {CURRENT_VERSION}); читаю как есть, не понижаю версию",
            path.display()
        );
    }

    let mut games = Vec::new();
    if let Some(list) = raw.get("games").and_then(|v| v.as_array()) {
        for item in list {
            match serde_json::from_value::<Game>(item.clone()) {
                Ok(game) => games.push(game),
                Err(e) => log::warn!("[config] отбрасываю запись игры: {e}"),
            }
        }
    }

    assemble_current(&raw, version, games)
}

/// Собирает `AppConfig` текущей версии из уже разобранного JSON.
///
/// Каждое поле читается из `raw` по отдельности, а не десериализуется целиком
/// через `serde`, — как и в миграциях выше, одна битая часть файла не должна
/// ронять остальной конфиг. Список игр разобран заранее вызывающей стороной
/// (`load`), тем же терпимым к поломкам способом.
///
/// Выделена отдельной чистой функцией, чтобы проверять её без `AppHandle` —
/// как и `recover_seeded` и `reject_if_newer_than_current` рядом.
fn assemble_current(raw: &serde_json::Value, version: u32, games: Vec<Game>) -> AppConfig {
    let seeded = raw.get("seeded").and_then(|v| v.as_bool()).unwrap_or(false);

    AppConfig {
        version,
        hub_url: raw
            .get("hubUrl")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_played: raw
            .get("lastPlayed")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        seeded: recover_seeded(seeded, &games),
        behaviour: raw
            .get("behaviour")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        // Читается здесь, поле за полем, как и всё остальное. Подставь сюда
        // умолчание безусловно — и выключенная человеком галочка включалась бы
        // при каждом чтении. Ровно так едва не случилось с блоком `look`.
        store_art: raw.get("storeArt").and_then(|v| v.as_bool()).unwrap_or(true),
        // Тот же приём, что и у `store_art` прямо выше: подставь сюда
        // умолчание безусловно — и выключенный человеком тумблер включался бы
        // при каждом чтении.
        animation: raw.get("animation").and_then(|v| v.as_bool()).unwrap_or(true),
        // Незнакомое значение — английский, а не ошибка чтения всего конфига.
        language: raw
            .get("language")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        video_language: raw
            .get("videoLanguage")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        // Блок `look` от прежней настройки цвета намеренно не читается. У тех,
        // кто успел его сохранить, он просто исчезнет при следующей записи
        // конфига, а игры и остальные настройки останутся как были.
        games,
    }
}

/// Восстанавливает `seeded` для конфигов версии 3, заполненных старым
/// автопосевом до появления этого поля: `seeded` тогда ещё ничего не
/// выставляла, так что на диске мог осесть файл с непустым списком игр и
/// `seeded: false`. Непустой список сам по себе означает, что настройка уже
/// происходила — без этой поправки такой человек увидел бы экран первого
/// запуска поверх уже готового списка.
///
/// Намеренно очищенный человеком список это не ломает: у него `seeded` уже
/// `true`, выставленный при завершении первичной настройки, и пустой список
/// остаётся пустым.
///
/// Выделена отдельной чистой функцией, чтобы проверять её без `AppHandle` —
/// как и `reject_if_newer_than_current` ниже.
fn recover_seeded(seeded: bool, games: &[Game]) -> bool {
    seeded || !games.is_empty()
}

/// Выделена из `save` отдельной чистой функцией, чтобы проверять её без
/// `AppHandle` — в модульных тестах его взять неоткуда.
fn reject_if_newer_than_current(version: u32) -> Result<(), String> {
    if version > CURRENT_VERSION {
        return Err(format!(
            "конфиг версии {version} новее, чем понимает эта сборка (умеет до версии {CURRENT_VERSION}); отказываюсь перезаписывать файл"
        ));
    }
    Ok(())
}

/// Атомарная запись: временный файл рядом, затем переименование поверх.
///
/// Отказывается писать конфиг версии выше `CURRENT_VERSION`: у этой сборки
/// нет схемы для полей, которых она не знает, и молча их отбросить значило
/// бы необратимо стереть данные более новой версии приложения.
///
/// Снаружи модуля не видна: писать конфиг можно только через `update`.
fn save_to(final_path: &Path, cfg: &AppConfig) -> Result<(), String> {
    reject_if_newer_than_current(cfg.version)?;
    let tmp_path = final_path.with_file_name("config.json.tmp");
    let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("сериализация: {e}"))?;
    fs::write(&tmp_path, json)
        .map_err(|e| format!("запись {}: {e}", tmp_path.display()))?;
    fs::rename(&tmp_path, final_path).map_err(|e| {
        format!(
            "переименование {} -> {}: {e}",
            tmp_path.display(),
            final_path.display()
        )
    })?;
    Ok(())
}

/// Конфиг не записался; внутри — текст ошибки для подробности.
#[derive(Debug)]
pub struct SaveFailed(pub String);

impl From<SaveFailed> for crate::error::AppError {
    fn from(e: SaveFailed) -> Self {
        crate::error::AppError::with(crate::error::code::CONFIG_SAVE_FAILED, e.0)
    }
}

impl From<SaveFailed> for String {
    fn from(e: SaveFailed) -> Self {
        e.0
    }
}

/// Единственный путь записи конфига: прочитать, изменить, записать — всё под
/// одним замком (`FILE_LOCK`), так что одновременные правки не теряются.
///
/// `f` возвращает `Err` — файл не трогается, ошибка уходит вызывающему как
/// есть. Конфиг, который `f` оставила прежним, тоже не переписывается.
///
/// Внутри `f` нельзя звать `load`, `update` и то, что их зовёт (например,
/// `tray::rebuild_menu`): замок не повторный, и вызов ждал бы сам себя
/// (тесты и отладочная сборка вместо этого падают, см. `HOLDS_FILE_LOCK`).
/// И ничего долгого — запуск игры или сеть — тоже: остальные правки стоят.
pub fn update<T, E>(app: &AppHandle, f: impl FnOnce(&mut AppConfig) -> Result<T, E>) -> Result<T, E>
where
    E: From<SaveFailed>,
{
    let path = config_path(app).map_err(|e| E::from(SaveFailed(e)))?;
    update_at(&path, f)
}

/// Сердцевина `update` по готовому пути — проверяется без `AppHandle`.
fn update_at<T, E>(path: &Path, f: impl FnOnce(&mut AppConfig) -> Result<T, E>) -> Result<T, E>
where
    E: From<SaveFailed>,
{
    let _guard = lock_file();
    let mut cfg = load_from(path);
    let before = serde_json::to_value(&cfg).ok();
    let out = f(&mut cfg)?;
    if before.is_none() || before != serde_json::to_value(&cfg).ok() {
        save_to(path, &cfg).map_err(|e| E::from(SaveFailed(e)))?;
    }
    Ok(out)
}

/// Существует ли файл, которым игра запускается.
pub fn is_present(game: &Game) -> bool {
    match &game.launch {
        Launch::Exe => game
            .exe_path
            .as_deref()
            .map(Path::is_file)
            .unwrap_or(false),
        _ => game
            .install_path
            .as_deref()
            .map(Path::is_dir)
            .unwrap_or(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_serialises_with_a_kind_tag() {
        let json = serde_json::to_string(&Launch::Steam { appid: 3513350 }).unwrap();
        assert_eq!(json, r#"{"kind":"steam","appid":3513350}"#);
    }

    #[test]
    fn epic_launch_uses_camel_case_fields() {
        let json = serde_json::to_string(&Launch::Epic {
            namespace: "ns".into(),
            catalog_item_id: "cid".into(),
            app_name: "app".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"kind":"epic","namespace":"ns","catalogItemId":"cid","appName":"app"}"#
        );
    }

    #[test]
    fn migrates_a_version_one_config() {
        let v1 = serde_json::json!({
            "version": 1,
            "hubUrl": "https://example.com/hub.json",
            "games": {
                "wuthering": { "launchMode": "steam", "exePath": null, "args": "" },
                "hsr": {
                    "launchMode": "exe",
                    "exePath": "C:\\Games\\HSR\\launcher.exe",
                    "args": "-dx12"
                }
            }
        });

        let cfg = migrate_v1(&v1).expect("миграция должна пройти");

        assert_eq!(cfg.version, CURRENT_VERSION);
        assert_eq!(cfg.hub_url.as_deref(), Some("https://example.com/hub.json"));
        assert_eq!(cfg.games.len(), 2);
        assert!(cfg.seeded);
        assert!(cfg.behaviour.close_to_tray);
        assert!(!cfg.behaviour.tray_on_launch);

        let hsr = cfg.games.iter().find(|g| g.id == "hsr").unwrap();
        assert_eq!(hsr.content_id.as_deref(), Some("hsr"));
        assert_eq!(hsr.args, "-dx12");
        assert!(matches!(hsr.launch, Launch::Exe));
        assert_eq!(hsr.exe_path.as_deref(), Some(Path::new(r"C:\Games\HSR\launcher.exe")));
    }

    #[test]
    fn migration_drops_a_broken_game_but_keeps_the_rest() {
        let v1 = serde_json::json!({
            "version": 1,
            "games": {
                "hsr": { "launchMode": "exe", "exePath": "C:\\ok.exe", "args": "" },
                "broken": { "launchMode": 42 }
            }
        });
        let cfg = migrate_v1(&v1).unwrap();
        assert_eq!(cfg.games.len(), 1);
        assert_eq!(cfg.games[0].id, "hsr");
    }

    #[test]
    fn v1_steam_mode_without_an_appid_becomes_exe() {
        // В v1 appid жил в коде, а не в конфиге. При миграции его взять
        // неоткуда, поэтому режим падает до «свой .exe» — путь пользователь
        // либо уже указал, либо укажет заново.
        let v1 = serde_json::json!({
            "version": 1,
            "games": { "wuthering": { "launchMode": "steam", "args": "" } }
        });
        let cfg = migrate_v1(&v1).unwrap();
        assert!(matches!(cfg.games[0].launch, Launch::Exe));
    }

    #[test]
    fn save_refuses_a_config_newer_than_this_build_understands() {
        // `save` delegates the check to `reject_if_newer_than_current`, since
        // `save` itself needs an `AppHandle` that unit tests have no way to
        // construct. This exercises the exact guard `save` runs first, before
        // any file is touched.
        let newer = CURRENT_VERSION + 1;
        let err = reject_if_newer_than_current(newer).expect_err("должен отказать");
        assert!(
            err.contains(&newer.to_string()),
            "ошибка должна называть версию файла: {err}"
        );
        assert!(
            err.contains(&CURRENT_VERSION.to_string()),
            "ошибка должна называть версию, которую понимает сборка: {err}"
        );

        assert!(reject_if_newer_than_current(CURRENT_VERSION).is_ok());
    }

    #[test]
    fn recover_seeded_marks_a_pre_seeded_field_config_as_already_seeded() {
        // `seed_games` появилась раньше поля `seeded` и никогда его не
        // выставляла — на диске мог осесть конфиг версии 3 с непустым
        // списком игр и `seeded: false`. Непустой список сам по себе
        // значит, что настройка уже прошла.
        let games = vec![Game::manual("a".into(), "Игра".into())];
        assert!(recover_seeded(false, &games));
    }

    #[test]
    fn recover_seeded_leaves_an_intentionally_emptied_list_alone() {
        // Человек, удаливший всё намеренно, уже получил `seeded: true` при
        // завершении первичной настройки — пустой список не должен снова
        // включать экран первого запуска.
        assert!(recover_seeded(true, &[]));
    }

    #[test]
    fn recover_seeded_keeps_a_genuinely_fresh_install_unseeded() {
        assert!(!recover_seeded(false, &[]));
    }

    #[test]
    fn games_keep_their_order_across_a_save_round_trip() {
        let cfg = AppConfig {
            version: 2,
            hub_url: None,
            last_played: None,
            seeded: false,
            behaviour: Behaviour::default(),
            store_art: true,
            animation: true,
            language: Language::En,
            video_language: VideoLanguage::En,
            games: vec![
                Game::manual("b".into(), "Второй".into()),
                Game::manual("a".into(), "Первый".into()),
            ],
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.games[0].id, "b");
        assert_eq!(back.games[1].id, "a");
    }

    const V2_SAMPLE: &str = r#"{
      "version": 2,
      "hubUrl": null,
      "lastPlayed": "genshin",
      "games": [
        {
          "id": "genshin",
          "title": "Genshin Impact",
          "contentId": "genshin",
          "launch": { "kind": "epic", "namespace": "n", "catalogItemId": "c", "appName": "a" },
          "installPath": "C:\\Games\\Genshin",
          "exePath": "C:\\Games\\Genshin\\launcher.exe",
          "args": "",
          "background": null
        },
        {
          "id": "wuthering",
          "title": "Wuthering Waves",
          "contentId": "wuthering",
          "launch": { "kind": "steam", "appid": 3513350 },
          "installPath": "D:\\Steam\\WW",
          "exePath": null,
          "args": "-window",
          "background": "C:\\my\\art.png"
        }
      ]
    }"#;

    #[test]
    fn migration_keeps_every_game_untouched() {
        // Это самая важная проверка переноса: у человека настроенные игры с
        // вручную выверенными путями, и потерять их нельзя.
        let raw: serde_json::Value = serde_json::from_str(V2_SAMPLE).unwrap();
        let cfg = migrate_v2(&raw).expect("миграция не должна проваливаться");

        assert_eq!(cfg.version, 3);
        assert_eq!(cfg.games.len(), 2);

        let g = &cfg.games[0];
        assert_eq!(g.id, "genshin");
        assert_eq!(g.title, "Genshin Impact");
        assert_eq!(g.content_id.as_deref(), Some("genshin"));
        assert_eq!(g.exe_path, Some(std::path::PathBuf::from(r"C:\Games\Genshin\launcher.exe")));
        assert_eq!(g.install_path, Some(std::path::PathBuf::from(r"C:\Games\Genshin")));

        let w = &cfg.games[1];
        assert_eq!(w.launch, Launch::Steam { appid: 3513350 });
        assert_eq!(w.args, "-window");
        assert_eq!(w.background, Some(std::path::PathBuf::from(r"C:\my\art.png")));
        assert_eq!(w.install_path, Some(std::path::PathBuf::from(r"D:\Steam\WW")));
    }

    #[test]
    fn migration_marks_an_existing_config_as_already_seeded() {
        // У человека уже есть игры — первый запуск для него состоялся.
        // Показать ему экран с галочками после обновления было бы враньём.
        let raw: serde_json::Value = serde_json::from_str(V2_SAMPLE).unwrap();
        let cfg = migrate_v2(&raw).unwrap();
        assert!(cfg.seeded);
    }

    #[test]
    fn migration_gives_a_v2_config_the_current_behaviour_defaults() {
        // В конфиге второй версии блока поведения нет, и перенос ставит
        // нынешние умолчания: крестик прячет окно в трей, а после запуска
        // игры окно остаётся. Вторая версия публично не выходила, так что
        // чужих настроек это не меняет.
        let raw: serde_json::Value = serde_json::from_str(V2_SAMPLE).unwrap();
        let cfg = migrate_v2(&raw).unwrap();
        assert!(cfg.behaviour.close_to_tray);
        assert!(!cfg.behaviour.tray_on_launch);
    }

    #[test]
    fn a_fresh_install_keeps_the_window_after_launching_a_game() {
        // Свежая установка: после «Играть» окно остаётся, и другую игру можно
        // запустить сразу, не доставая окно из трея. Крестик по-прежнему
        // прячет окно в трей.
        let cfg = AppConfig::default();
        assert!(cfg.behaviour.close_to_tray);
        assert!(!cfg.behaviour.tray_on_launch);
    }

    #[test]
    fn migration_preserves_last_played_and_hub_url() {
        let raw: serde_json::Value = serde_json::from_str(V2_SAMPLE).unwrap();
        let cfg = migrate_v2(&raw).unwrap();
        assert_eq!(cfg.last_played.as_deref(), Some("genshin"));
        assert_eq!(cfg.hub_url, None);
    }

    #[test]
    fn migration_v2_drops_a_broken_game_but_keeps_the_rest() {
        // Одна испорченная запись не имеет права унести с собой остальные:
        // дальше по цепочке пустой список молча перезапишет файл человека.
        let json = r#"{
          "version": 2,
          "games": [
            {"id":"a","title":"A","launch":{"kind":"exe"},"args":"","background":null},
            {"это":"не игра"},
            {"id":"b","title":"B","launch":{"kind":"exe"},"args":"","background":null}
          ]
        }"#;
        let raw: serde_json::Value = serde_json::from_str(json).unwrap();
        let cfg = migrate_v2(&raw).expect("миграция не должна проваливаться целиком");
        let ids: Vec<&str> = cfg.games.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn migration_refuses_a_file_whose_games_are_not_a_list() {
        let raw: serde_json::Value = serde_json::from_str(r#"{"version":2,"games":42}"#).unwrap();
        assert!(migrate_v2(&raw).is_none());
    }

    #[test]
    fn a_v3_config_round_trips_without_loss() {
        let cfg = AppConfig {
            version: 3,
            hub_url: Some("https://example.test/hub.json".into()),
            last_played: Some("zzz".into()),
            seeded: true,
            behaviour: Behaviour { close_to_tray: false, tray_on_launch: true },
            store_art: true,
            animation: true,
            language: Language::En,
            video_language: VideoLanguage::En,
            games: vec![],
        };
        let text = serde_json::to_string(&cfg).unwrap();
        let back: AppConfig = serde_json::from_str(&text).unwrap();
        assert_eq!(back.version, 3);
        assert!(!back.behaviour.close_to_tray);
        assert!(back.behaviour.tray_on_launch);
        assert!(back.seeded);
    }

    #[test]
    fn a_config_missing_the_new_fields_still_loads() {
        // Файл, записанный до появления полей, не должен ронять разбор.
        let json = r#"{"version":3,"games":[]}"#;
        let cfg: AppConfig = serde_json::from_str(json).unwrap();
        assert!(!cfg.seeded);
        assert!(cfg.behaviour.close_to_tray);
        assert!(!cfg.behaviour.tray_on_launch);
    }

    #[test]
    fn a_config_without_the_icon_field_still_loads() {
        // Поле необязательное, и версия конфига ради него не поднимается:
        // старые файлы должны читаться без миграции.
        let json = r#"{"version":3,"games":[
          {"id":"a","title":"A","launch":{"kind":"exe"},"args":"","background":null}
        ]}"#;
        let cfg: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.games[0].icon, None);
    }

    #[test]
    fn an_icon_path_survives_a_save_round_trip() {
        let mut cfg = AppConfig::default();
        let mut g = Game::manual("a".into(), "A".into());
        g.icon = Some(std::path::PathBuf::from(r"C:\my\icon.png"));
        cfg.games.push(g);
        let text = serde_json::to_string(&cfg).unwrap();
        let back: AppConfig = serde_json::from_str(&text).unwrap();
        assert_eq!(back.games[0].icon, Some(std::path::PathBuf::from(r"C:\my\icon.png")));
    }

    #[test]
    fn a_config_saved_with_the_old_colour_setting_keeps_its_games() {
        // Прежняя версия приложения сохраняла блок `look` с настройкой цвета.
        // Настройку убрали, но файлы с этим блоком уже лежат у людей, и в них
        // выверенные списки игр. Такой файл обязан читаться целиком, а сам
        // блок — просто не записываться обратно.
        let raw = serde_json::json!({
            "version": 3,
            "seeded": true,
            "behaviour": { "closeToTray": false, "trayOnLaunch": true },
            "look": { "accentHue": 162, "adaptFromArt": true },
            "games": []
        });
        let games = vec![Game::manual("genshin".into(), "Genshin Impact".into())];
        let cfg = assemble_current(&raw, 3, games);
        assert_eq!(cfg.games.len(), 1);
        assert_eq!(cfg.games[0].id, "genshin");
        assert!(cfg.seeded);
        assert!(!cfg.behaviour.close_to_tray);

        let text = serde_json::to_string(&cfg).unwrap();
        assert!(!text.contains("look"), "блок цвета не должен записываться обратно: {text}");
    }

    // Тесты ниже проверяют `assemble_current` напрямую — путь, которым
    // `load` на самом деле читает файл текущей версии. Тесты через
    // `serde_json::from_str::<AppConfig>` идут через выведенную реализацию
    // `Deserialize` с её собственными умолчаниями и ничего не говорят о ручной
    // сборке структуры в `load`/`assemble_current`, где умолчание для
    // `behaviour` может быть подставлено безусловно по ошибке.

    #[test]
    fn assemble_current_keeps_a_saved_behaviour_block_instead_of_the_default() {
        // Оба сохранённых значения — не умолчания: иначе тест не отличил бы
        // сохранённый блок от подставленного. Сохранённое «уходить в трей»
        // остаётся включённым и после смены умолчания.
        let raw = serde_json::json!({
            "version": 3,
            "games": [],
            "behaviour": { "closeToTray": false, "trayOnLaunch": true }
        });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert!(!cfg.behaviour.close_to_tray);
        assert!(cfg.behaviour.tray_on_launch);
    }

    #[test]
    fn assemble_current_gives_the_current_defaults_when_the_behaviour_block_is_absent() {
        let raw = serde_json::json!({ "version": 3, "games": [] });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert!(cfg.behaviour.close_to_tray);
        assert!(!cfg.behaviour.tray_on_launch);
    }

    #[test]
    fn assemble_current_reads_hub_url_and_last_played_when_present() {
        let raw = serde_json::json!({
            "version": 3,
            "games": [],
            "hubUrl": "https://example.test/hub.json",
            "lastPlayed": "genshin"
        });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert_eq!(cfg.hub_url.as_deref(), Some("https://example.test/hub.json"));
        assert_eq!(cfg.last_played.as_deref(), Some("genshin"));
    }

    #[test]
    fn assemble_current_leaves_hub_url_and_last_played_empty_when_absent() {
        let raw = serde_json::json!({ "version": 3, "games": [] });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert_eq!(cfg.hub_url, None);
        assert_eq!(cfg.last_played, None);
    }

    #[test]
    fn assemble_current_keeps_seeded_true_with_an_empty_game_list() {
        // Человек, у которого настройка давно пройдена, но список игр он
        // осознанно очистил: на диске `seeded: true` при пустом `games`.
        // `recover_seeded` тут ничего не восстанавливает (флаг и так уже
        // `true`) — этот тест проверяет именно то, что `assemble_current`
        // доносит сохранённое значение до собранного конфига, а не теряет
        // его по пути от `raw`. Пять тестов выше на этот путь пустой список
        // передают вместе с отсутствующим/ложным `seeded`, поэтому жёсткое
        // `seeded: false` их не ловит.
        let raw = serde_json::json!({
            "version": 3,
            "games": [],
            "seeded": true
        });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert!(cfg.seeded);
    }

    #[test]
    fn assemble_current_keeps_a_saved_store_art_false() {
        let raw = serde_json::json!({ "version": 3, "games": [], "storeArt": false });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert!(
            !cfg.store_art,
            "выключенная галочка магазинов не должна включаться сама при чтении"
        );
    }

    #[test]
    fn assemble_current_turns_store_art_on_when_the_key_is_absent() {
        let raw = serde_json::json!({ "version": 3, "games": [] });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert!(cfg.store_art);
    }

    #[test]
    fn migrations_turn_store_art_on() {
        let v2 = serde_json::json!({ "version": 2, "games": [] });
        assert!(migrate_v2(&v2).expect("v2 переносится").store_art);
        let v1 = serde_json::json!({ "version": 1, "games": {} });
        assert!(migrate_v1(&v1).expect("v1 переносится").store_art);
    }

    #[test]
    fn assemble_current_keeps_a_saved_animation_false() {
        let raw = serde_json::json!({ "version": 3, "games": [], "animation": false });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert!(
            !cfg.animation,
            "выключенный тумблер анимации не должен включаться сам при чтении"
        );
    }

    #[test]
    fn assemble_current_turns_animation_on_when_the_key_is_absent() {
        let raw = serde_json::json!({ "version": 3, "games": [] });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert!(cfg.animation);
    }

    #[test]
    fn migrations_turn_animation_on() {
        let v2 = serde_json::json!({ "version": 2, "games": [] });
        assert!(migrate_v2(&v2).expect("v2 переносится").animation);
        let v1 = serde_json::json!({ "version": 1, "games": {} });
        assert!(migrate_v1(&v1).expect("v1 переносится").animation);
    }

    #[test]
    fn assemble_current_keeps_saved_languages() {
        let raw = serde_json::json!({ "version": 3, "games": [], "language": "ru", "videoLanguage": "ja" });
        let cfg = assemble_current(&raw, 3, Vec::new());
        assert_eq!(cfg.language, Language::Ru);
        assert_eq!(cfg.video_language, VideoLanguage::Ja);
    }

    #[test]
    fn assemble_current_uses_english_when_languages_are_absent_or_unknown() {
        let absent = assemble_current(&serde_json::json!({ "version": 3, "games": [] }), 3, Vec::new());
        assert_eq!((absent.language, absent.video_language), (Language::En, VideoLanguage::En));
        let odd = assemble_current(&serde_json::json!({ "version": 3, "games": [], "language": "fr", "videoLanguage": 7 }), 3, Vec::new());
        assert_eq!((odd.language, odd.video_language), (Language::En, VideoLanguage::En));
    }

    #[test]
    fn languages_serialize_as_short_codes() {
        let cfg = AppConfig { language: Language::Ru, video_language: VideoLanguage::Ja, ..AppConfig::default() };
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["language"], "ru");
        assert_eq!(json["videoLanguage"], "ja");
        assert_eq!(cfg.version, CURRENT_VERSION);
    }

    /// Отдельная папка на тег теста: тесты идут в одном процессе параллельно.
    fn temp_config(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gh-config-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("config.json")
    }

    #[test]
    fn concurrent_updates_lose_nothing() {
        // Команды асинхронные и идут одновременно: запуск из трея и правка
        // настроек вплотную друг к другу. Каждая читает файл, меняет своё поле
        // и пишет целиком — без общего замка одна запись затирала бы другую.
        const ROUNDS: u32 = 40;
        let path = temp_config("concurrent");
        let games = {
            let path = path.clone();
            std::thread::spawn(move || {
                for i in 0..ROUNDS {
                    update_at(&path, |cfg| {
                        cfg.games.push(Game::manual(format!("g{i}"), format!("G{i}")));
                        Ok::<_, String>(())
                    })
                    .unwrap();
                }
            })
        };
        let counter = {
            let path = path.clone();
            std::thread::spawn(move || {
                for _ in 0..ROUNDS {
                    update_at(&path, |cfg| {
                        let n: u32 = cfg.hub_url.as_deref().map_or(0, |s| s.parse().unwrap());
                        cfg.hub_url = Some((n + 1).to_string());
                        Ok::<_, String>(())
                    })
                    .unwrap();
                }
            })
        };
        games.join().expect("поток игр не должен падать");
        counter.join().expect("поток счётчика не должен падать");

        let cfg = load_from(&path);
        assert_eq!(cfg.games.len(), ROUNDS as usize, "потерялись добавленные игры");
        assert_eq!(cfg.hub_url, Some(ROUNDS.to_string()), "потерялись приращения счётчика");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    #[cfg(debug_assertions)]
    #[should_panic(expected = "замок конфига уже взят этим потоком")]
    fn reading_the_config_inside_an_update_fails_loudly() {
        // Замок не повторный: такой вызов в сборке без проверки ждал бы сам
        // себя вечно. Здесь он должен упасть сразу и с понятной причиной.
        let path = temp_config("reentry");
        let _ = update_at(&path, |_| update_at(&path, |_| Ok::<_, String>(())));
    }

    #[test]
    fn an_update_that_fails_leaves_the_file_alone() {
        let path = temp_config("update-err");
        update_at(&path, |cfg| {
            cfg.seeded = true;
            Ok::<_, String>(())
        })
        .unwrap();
        let err = update_at(&path, |cfg| {
            cfg.seeded = false;
            Err::<(), _>("нет такой игры".to_string())
        });
        assert_eq!(err, Err("нет такой игры".to_string()));
        assert!(load_from(&path).seeded);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn an_update_that_changes_nothing_does_not_write() {
        let path = temp_config("update-noop");
        update_at(&path, |cfg| {
            cfg.seeded = true;
            Ok::<_, String>(())
        })
        .unwrap();
        let written = fs::metadata(&path).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let id = update_at(&path, |_| Ok::<_, String>(7)).unwrap();
        assert_eq!(id, 7);
        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), written);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_game_saved_before_the_unlink_flag_loads_with_it_off() {
        // Поле необязательное, и версия конфига ради него не поднимается.
        let raw = serde_json::json!({
            "version": 3,
            "games": [
                {"id":"a","title":"A","contentId":null,"launch":{"kind":"exe"},"args":""}
            ]
        });
        let path = temp_config("unlink-old");
        fs::write(&path, raw.to_string()).unwrap();
        let cfg = load_from(&path);
        assert_eq!(cfg.games.len(), 1);
        assert!(!cfg.games[0].content_unlinked);

        let migrated = migrate_v2(&serde_json::from_str(V2_SAMPLE).unwrap()).unwrap();
        assert!(migrated.games.iter().all(|g| !g.content_unlinked));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn the_unlink_flag_survives_a_save_round_trip() {
        let mut cfg = AppConfig::default();
        let mut g = Game::manual("a".into(), "A".into());
        g.content_unlinked = true;
        cfg.games.push(g);
        let path = temp_config("unlink-round-trip");
        save_to(&path, &cfg).unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("\"contentUnlinked\": true"));
        assert!(load_from(&path).games[0].content_unlinked);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_video_path_and_the_store_switch_survive_a_save_round_trip() {
        let mut cfg = AppConfig::default();
        let mut g = Game::manual("a".into(), "A".into());
        g.video = Some(std::path::PathBuf::from(r"D:\walls\a.mp4"));
        cfg.games.push(g);
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(text.contains("\"storeArt\":true"), "поле должно писаться: {text}");
        let back: AppConfig = serde_json::from_str(&text).unwrap();
        assert_eq!(back.games[0].video, Some(std::path::PathBuf::from(r"D:\walls\a.mp4")));
    }
}
