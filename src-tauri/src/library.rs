//! Правка списка игр: добавить, изменить, удалить, переставить.
//!
//! Все функции работают над `&mut AppConfig` и ничего не знают про Tauri.
//! Так их можно проверить обычными тестами, а команды остаются тонкой
//! обёрткой: прочитать конфиг, позвать сюда, записать обратно.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::config::{AppConfig, Game, Launch};
use crate::error::{code, AppError};

/// Что менять у игры. `None` означает «не трогать это поле».
///
/// У `content_id` два уровня: внешний `None` — не трогать, внутренний
/// `Some(None)` — стереть привязку. «Нет привязки» это осмысленный выбор
/// человека, а не отсутствие правки.
#[derive(Debug, Default)]
pub struct GamePatch {
    pub title: Option<String>,
    pub exe_path: Option<PathBuf>,
    /// Два уровня, как у `icon` и `content_id`: внешний `None` — не трогать,
    /// внутренний `None` — убрать свой фон и вернуться к сгенерированной
    /// заливке.
    pub background: Option<Option<PathBuf>>,
    /// Два уровня, как у `content_id`: внешний `None` — не трогать,
    /// внутренний `None` — убрать свою картинку и вернуться к добытой.
    pub icon: Option<Option<PathBuf>>,
    /// Два уровня, как у `background`: внешний `None` — не трогать,
    /// внутренний `None` — убрать своё видео.
    pub video: Option<Option<PathBuf>>,
    pub content_id: Option<Option<String>>,
    /// Аргументы запуска. Один уровень, как у `title`: внешний `None` — не
    /// трогать, `Some` — заменить целиком. Пустая строка здесь не признак
    /// «стереть», а такое же осмысленное значение, как и любое другое —
    /// «запускать без аргументов».
    pub args: Option<String>,
}

/// Проверяет, что названий игры не пусто. Пустым считается пустая строка
/// и строка из одних пробелов.
pub fn validate_title(title: &str) -> Result<(), AppError> {
    if title.trim().is_empty() {
        Err(AppError::new(code::EMPTY_TITLE))
    } else {
        Ok(())
    }
}

/// Идентификатор, которого ещё нет в конфиге.
///
/// Принимает готовую основу, а не название: у игры, добавленной вручную,
/// основа берётся из названия, а у найденной в магазине — из идентификатора
/// каталога. Обе дороги ведут сюда, чтобы правило разрешения совпадений
/// существовало в одном экземпляре.
pub(crate) fn free_id(cfg: &AppConfig, base: &str) -> String {
    let base = if base.is_empty() { "game" } else { base };
    let taken: HashSet<&str> = cfg.games.iter().map(|g| g.id.as_str()).collect();
    if !taken.contains(base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !taken.contains(candidate.as_str()) {
            return candidate;
        }
        n += 1;
    }
}

/// Добавляет игру, указанную человеком вручную. Возвращает её идентификатор.
pub fn add(cfg: &mut AppConfig, title: String, exe: PathBuf) -> String {
    let id = free_id(cfg, &crate::catalog::normalize(&title));
    cfg.games.push(Game {
        id: id.clone(),
        title,
        content_id: None,
        launch: Launch::Exe,
        install_path: exe.parent().map(PathBuf::from),
        exe_path: Some(exe),
        args: String::new(),
        background: None,
        icon: None,
        video: None,
    });
    id
}

/// Добавляет игру, найденную сканированием магазинов, сохраняя способ запуска
/// и пути из манифеста как есть. Возвращает идентификатор новой записи.
///
/// Проверяет название и подбирает идентификатор теми же `validate_title` и
/// `free_id`, что и остальные дороги добавления игры — раньше
/// `commands::add_game_from_scan` вела собственный цикл подбора идентификатора
/// и вовсе не проверяла название. Из-за этого была достижима запись с пустым
/// названием и идентификатором: манифест Steam пишет пустое название, пока
/// игра ещё качается, а разбор манифестов такие пустые значения намеренно
/// сохраняет (см. `stores`).
///
/// Отдельная от `add`: у найденной игры уже известны способ запуска и пути из
/// манифеста, и сводить их к `Launch::Exe` нельзя — тогда игра из Steam
/// перестала бы запускаться через Steam.
///
/// Повторное добавление той же установки ничего не меняет и возвращает
/// идентификатор уже записанной игры (`configured_install`): экран первого
/// запуска после частичного провала повторяет весь список, и копии одной
/// игры в доке появляться не должны.
pub fn add_found(
    cfg: &mut AppConfig,
    title: String,
    content_id: Option<String>,
    launch: Launch,
    install_path: PathBuf,
    exe_path: Option<PathBuf>,
) -> Result<String, AppError> {
    validate_title(&title)?;
    if let Some(existing) = configured_install(cfg, &launch, &install_path, exe_path.as_deref()) {
        return Ok(existing.id.clone());
    }
    let base = content_id
        .clone()
        .unwrap_or_else(|| crate::catalog::normalize(&title));
    let id = free_id(cfg, &base);
    cfg.games.push(Game {
        id: id.clone(),
        title,
        content_id,
        launch,
        install_path: Some(install_path),
        exe_path,
        args: String::new(),
        background: None,
        icon: None,
        video: None,
    });
    Ok(id)
}

/// Игра конфига, которая уже указывает на эту установку: тот же appid Steam,
/// тот же AppName Epic, тот же exe или та же папка установки.
///
/// Название в сравнении не участвует: одна игра бывает установлена и в Steam,
/// и в Epic, и это две разные записи.
fn configured_install<'a>(
    cfg: &'a AppConfig,
    launch: &Launch,
    install_path: &Path,
    exe_path: Option<&Path>,
) -> Option<&'a Game> {
    use crate::stores::same_path;
    cfg.games.iter().find(|g| {
        let same_target = match (&g.launch, launch) {
            (Launch::Steam { appid: a }, Launch::Steam { appid: b }) => a == b,
            (Launch::Epic { app_name: a, .. }, Launch::Epic { app_name: b, .. }) => a == b,
            _ => g
                .exe_path
                .as_deref()
                .zip(exe_path)
                .is_some_and(|(a, b)| same_path(a, b)),
        };
        same_target
            || g.install_path
                .as_deref()
                .is_some_and(|p| same_path(p, install_path))
    })
}

/// Меняет названные поля одной игры. `false` — игры с таким идентификатором нет.
///
/// Указанный человеком `exe_path` переключает игру на `Launch::Exe`: раз он
/// сам назвал исполняемый файл, это и значит «запускать через него», а не
/// через прежний способ (Steam, Epic). Без этого переключения кнопка запуска
/// продолжала бы идти через старый магазин: у Steam-игры без установленного
/// клиента `steam://` тихо не срабатывает, а `install_path` и «файл нашёлся»
/// вводят в заблуждение, будто всё в порядке (см. `catalog::relocate`,
/// который переключает способ запуска по той же причине).
pub fn update(cfg: &mut AppConfig, id: &str, patch: GamePatch) -> bool {
    let Some(game) = cfg.games.iter_mut().find(|g| g.id == id) else {
        return false;
    };
    if let Some(title) = patch.title {
        game.title = title;
    }
    if let Some(exe) = patch.exe_path {
        game.install_path = exe.parent().map(PathBuf::from);
        game.exe_path = Some(exe);
        game.launch = Launch::Exe;
    }
    if let Some(bg) = patch.background {
        game.background = bg;
    }
    if let Some(icon) = patch.icon {
        game.icon = icon;
    }
    if let Some(video) = patch.video {
        game.video = video;
    }
    if let Some(content) = patch.content_id {
        game.content_id = content;
    }
    if let Some(args) = patch.args {
        game.args = args;
    }
    true
}

/// Удаляет игру. `false` — такой игры не было.
pub fn remove(cfg: &mut AppConfig, id: &str) -> bool {
    let before = cfg.games.len();
    cfg.games.retain(|g| g.id != id);
    if cfg.games.len() == before {
        return false;
    }
    // Указатель на последнюю запущенную обязан перестать указывать в пустоту:
    // иначе следующий запуск попробует открыть удалённую игру.
    if cfg.last_played.as_deref() == Some(id) {
        cfg.last_played = None;
    }
    true
}

/// Переставляет игры в порядке `ids`.
///
/// Отказывает, если список не совпадает с содержимым конфига по составу:
/// пропущенный, лишний или повторённый идентификатор означает рассинхрон
/// между экраном и конфигом, а молча потерять игру нельзя.
pub fn reorder(cfg: &mut AppConfig, ids: &[String]) -> bool {
    if ids.len() != cfg.games.len() {
        return false;
    }
    let wanted: HashSet<&str> = ids.iter().map(String::as_str).collect();
    if wanted.len() != ids.len() {
        return false;
    }
    let have: HashSet<&str> = cfg.games.iter().map(|g| g.id.as_str()).collect();
    if wanted != have {
        return false;
    }

    let mut ordered = Vec::with_capacity(cfg.games.len());
    for id in ids {
        let pos = cfg
            .games
            .iter()
            .position(|g| &g.id == id)
            .expect("состав уже сверен выше");
        ordered.push(cfg.games.remove(pos));
    }
    cfg.games = ordered;
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppConfig, Behaviour, Game, Language, Launch, VideoLanguage};

    fn cfg_with(ids: &[&str]) -> AppConfig {
        AppConfig {
            version: 3,
            hub_url: None,
            last_played: None,
            seeded: true,
            behaviour: Behaviour::default(),
            store_art: true,
            animation: true,
            language: Language::En,
            video_language: VideoLanguage::En,
            games: ids
                .iter()
                .map(|id| Game {
                    id: (*id).into(),
                    title: (*id).into(),
                    content_id: None,
                    launch: Launch::Exe,
                    install_path: None,
                    exe_path: Some(PathBuf::from(format!(r"C:\g\{id}.exe"))),
                    args: String::new(),
                    background: None,
                    icon: None,
                    video: None,
                })
                .collect(),
        }
    }

    #[test]
    fn add_appends_a_game_and_returns_its_id() {
        let mut cfg = cfg_with(&["a"]);
        let id = add(&mut cfg, "Моя игра".into(), PathBuf::from(r"C:\x\game.exe"));
        assert_eq!(cfg.games.len(), 2);
        assert_eq!(cfg.games[1].id, id);
        assert_eq!(cfg.games[1].title, "Моя игра");
        assert_eq!(cfg.games[1].launch, Launch::Exe);
        assert_eq!(cfg.games[1].content_id, None);
    }

    #[test]
    fn add_never_collides_with_an_existing_id() {
        // Два «Моя игра» подряд должны получить разные идентификаторы,
        // иначе вторая перезапишет первую при любой правке.
        let mut cfg = cfg_with(&[]);
        let first = add(&mut cfg, "Моя игра".into(), PathBuf::from(r"C:\1.exe"));
        let second = add(&mut cfg, "Моя игра".into(), PathBuf::from(r"C:\2.exe"));
        assert_ne!(first, second);
        assert_eq!(cfg.games.len(), 2);
    }

    #[test]
    fn add_found_keeps_the_launch_and_paths_from_the_manifest() {
        // В отличие от `add`, найденная игра не должна свестись к
        // Launch::Exe — иначе игра из Steam перестала бы запускаться через
        // Steam.
        let mut cfg = cfg_with(&[]);
        let id = add_found(
            &mut cfg,
            "Wuthering Waves".into(),
            Some("wuthering".into()),
            Launch::Steam { appid: 3513350 },
            PathBuf::from(r"C:\SteamLibrary\WutheringWaves"),
            None,
        )
        .expect("должно пройти");
        assert_eq!(cfg.games.len(), 1);
        assert_eq!(cfg.games[0].id, id);
        assert_eq!(cfg.games[0].launch, Launch::Steam { appid: 3513350 });
        assert_eq!(
            cfg.games[0].install_path,
            Some(PathBuf::from(r"C:\SteamLibrary\WutheringWaves"))
        );
        assert_eq!(cfg.games[0].content_id.as_deref(), Some("wuthering"));
    }

    #[test]
    fn add_found_rejects_an_empty_title() {
        // Это ровно тот баг, который чинит эта правка: манифест Steam пишет
        // пустое название, пока игра ещё качается, разбор манифестов такие
        // значения намеренно сохраняет, а собственный цикл подбора
        // идентификатора, который раньше вела эта дорога, эту проверку не
        // делал вовсе.
        let mut cfg = cfg_with(&[]);
        let err = add_found(
            &mut cfg,
            "   ".into(),
            None,
            Launch::Steam { appid: 3513350 },
            PathBuf::from(r"C:\SteamLibrary\Unknown"),
            None,
        )
        .expect_err("пустое название обязано отклоняться");
        assert_eq!(err, AppError::new(code::EMPTY_TITLE));
        assert!(cfg.games.is_empty(), "запись не должна попасть в конфиг");
    }

    #[test]
    fn add_found_never_collides_with_an_existing_id() {
        // Та же гарантия, что и у `add`: подбор идентификатора идёт через
        // общий `free_id`, а не собственный цикл.
        let mut cfg = cfg_with(&["wuthering"]);
        let id = add_found(
            &mut cfg,
            "Wuthering Waves".into(),
            Some("wuthering".into()),
            Launch::Steam { appid: 3513350 },
            PathBuf::from(r"C:\SteamLibrary\WutheringWaves"),
            None,
        )
        .expect("должно пройти");
        assert_ne!(id, "wuthering");
        assert_eq!(cfg.games.len(), 2);
    }

    fn add_ww(cfg: &mut AppConfig, launch: Launch, install: &str) -> String {
        add_found(
            cfg,
            "Wuthering Waves".into(),
            Some("wuthering".into()),
            launch,
            PathBuf::from(install),
            None,
        )
        .expect("должно пройти")
    }

    #[test]
    fn adding_the_same_install_twice_returns_the_existing_game() {
        // Повтор после частичного провала на экране первого запуска: первая
        // игра уже записана, и вторая попытка не должна завести её копию.
        let mut cfg = cfg_with(&[]);
        let steam = Launch::Steam { appid: 3513350 };
        let first = add_ww(&mut cfg, steam.clone(), r"C:\SteamLibrary\WutheringWaves");
        let again = add_ww(&mut cfg, steam, r"C:\SteamLibrary\WutheringWaves");
        assert_eq!(again, first);
        assert_eq!(cfg.games.len(), 1);
    }

    #[test]
    fn a_found_game_in_an_already_configured_folder_is_not_added_again() {
        // Игру уже добавили руками: путь к exe в той же папке, что нашёл
        // лаунчер. Регистр букв в путях Windows не важен.
        let mut cfg = cfg_with(&[]);
        let manual = add(
            &mut cfg,
            "WW".into(),
            PathBuf::from(r"D:\Games\Wuthering Waves\launcher.exe"),
        );
        let found = add_ww(&mut cfg, Launch::Exe, r"d:\games\wuthering waves");
        assert_eq!(found, manual);
        assert_eq!(cfg.games.len(), 1);
    }

    #[test]
    fn the_same_title_from_another_store_is_a_separate_game() {
        let mut cfg = cfg_with(&[]);
        let steam = add_ww(&mut cfg, Launch::Steam { appid: 3513350 }, r"C:\Steam\WW");
        let epic = add_ww(
            &mut cfg,
            Launch::Epic {
                namespace: "ns".into(),
                catalog_item_id: "cid".into(),
                app_name: "ww".into(),
            },
            r"C:\Epic\WW",
        );
        assert_ne!(steam, epic);
        assert_eq!(cfg.games.len(), 2);
    }

    #[test]
    fn update_changes_only_the_named_fields() {
        let mut cfg = cfg_with(&["a", "b"]);
        let ok = update(
            &mut cfg,
            "a",
            GamePatch {
                title: Some("Новое имя".into()),
                exe_path: None,
                background: None,
                icon: None,
                video: None,
                content_id: None,
                args: None,
            },
        );
        assert!(ok);
        assert_eq!(cfg.games[0].title, "Новое имя");
        // Путь не назывался — значит не тронут.
        assert_eq!(cfg.games[0].exe_path, Some(PathBuf::from(r"C:\g\a.exe")));
        // Соседняя игра не тронута вовсе.
        assert_eq!(cfg.games[1].title, "b");
    }

    #[test]
    fn update_can_set_launch_arguments() {
        // Пустая строка в фикстуре — не «не трогать», а «нет аргументов»:
        // `Some(String::new())` обязана записаться так же, как и непустая.
        let mut cfg = cfg_with(&["a"]);
        let ok = update(
            &mut cfg,
            "a",
            GamePatch { args: Some("-window -dx12".into()), ..Default::default() },
        );
        assert!(ok);
        assert_eq!(cfg.games[0].args, "-window -dx12");
    }

    #[test]
    fn update_switches_a_steam_game_to_direct_launch_when_an_exe_is_given() {
        // Человек нажал «Выбрать…» на игре из Steam, у которой пропал файл
        // (её снесли из Steam и поставили заново на другой диск). Раньше
        // `update` записывал только exe_path/install_path, а `launch`
        // оставался Launch::Steam — кнопка запуска продолжала бы дергать
        // steam://, «успешно» ничего не запуская. Указанный человеком exe
        // обязан переключить игру на прямой запуск.
        let mut cfg = cfg_with(&["a"]);
        cfg.games[0].launch = Launch::Steam { appid: 3513350 };
        let new_exe = PathBuf::from(r"D:\Games\WutheringWaves\Wuthering Waves.exe");
        let ok = update(
            &mut cfg,
            "a",
            GamePatch {
                title: None,
                exe_path: Some(new_exe.clone()),
                background: None,
                icon: None,
                video: None,
                content_id: None,
                args: None,
            },
        );
        assert!(ok);
        assert_eq!(cfg.games[0].launch, Launch::Exe);
        assert_eq!(cfg.games[0].exe_path, Some(new_exe));
        assert_eq!(
            cfg.games[0].install_path,
            Some(PathBuf::from(r"D:\Games\WutheringWaves"))
        );
    }

    #[test]
    fn update_can_clear_the_content_binding() {
        // «Нет привязки» — осмысленное значение, а не отсутствие правки.
        let mut cfg = cfg_with(&["a"]);
        cfg.games[0].content_id = Some("genshin".into());
        update(
            &mut cfg,
            "a",
            GamePatch { content_id: Some(None), ..Default::default() },
        );
        assert_eq!(cfg.games[0].content_id, None);
    }

    #[test]
    fn update_can_clear_a_custom_icon() {
        let mut cfg = AppConfig::default();
        let mut g = Game::manual("a".into(), "A".into());
        g.icon = Some(PathBuf::from(r"C:\my\icon.png"));
        cfg.games.push(g);
        let patch = GamePatch { icon: Some(None), ..Default::default() };
        assert!(update(&mut cfg, "a", patch));
        assert_eq!(cfg.games[0].icon, None);
    }

    #[test]
    fn update_can_set_a_custom_background() {
        let mut cfg = AppConfig::default();
        cfg.games.push(Game::manual("a".into(), "A".into()));
        let patch = GamePatch {
            background: Some(Some(PathBuf::from(r"C:\my\art.png"))),
            ..Default::default()
        };
        assert!(update(&mut cfg, "a", patch));
        assert_eq!(cfg.games[0].background, Some(PathBuf::from(r"C:\my\art.png")));
    }

    #[test]
    fn update_can_clear_a_custom_background() {
        // Тот же второй уровень необязательности, что и у иконки: без
        // сброса выбранный фон было бы нечем убрать, кроме правки файла
        // настроек руками.
        let mut cfg = AppConfig::default();
        let mut g = Game::manual("a".into(), "A".into());
        g.background = Some(PathBuf::from(r"C:\my\art.png"));
        cfg.games.push(g);
        let patch = GamePatch { background: Some(None), ..Default::default() };
        assert!(update(&mut cfg, "a", patch));
        assert_eq!(cfg.games[0].background, None);
    }

    #[test]
    fn update_reports_false_for_an_unknown_game() {
        let mut cfg = cfg_with(&["a"]);
        let ok = update(
            &mut cfg,
            "нет-такой",
            GamePatch { title: Some("x".into()), ..Default::default() },
        );
        assert!(!ok);
    }

    #[test]
    fn remove_deletes_only_that_game() {
        let mut cfg = cfg_with(&["a", "b", "c"]);
        assert!(remove(&mut cfg, "b"));
        let ids: Vec<&str> = cfg.games.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "c"]);
    }

    #[test]
    fn removing_the_last_played_game_clears_the_pointer() {
        // Иначе при следующем запуске приложение попробует открыть игру,
        // которой больше нет.
        let mut cfg = cfg_with(&["a", "b"]);
        cfg.last_played = Some("a".into());
        remove(&mut cfg, "a");
        assert_eq!(cfg.last_played, None);
    }

    #[test]
    fn reorder_rearranges_by_the_given_order() {
        let mut cfg = cfg_with(&["a", "b", "c"]);
        assert!(reorder(&mut cfg, &["c".into(), "a".into(), "b".into()]));
        let ids: Vec<&str> = cfg.games.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, vec!["c", "a", "b"]);
    }

    #[test]
    fn reorder_refuses_a_list_that_does_not_match_the_games() {
        // Пропущенный или лишний идентификатор означает рассинхрон между
        // экраном и конфигом. Молча потерять игру нельзя.
        let mut cfg = cfg_with(&["a", "b", "c"]);
        assert!(!reorder(&mut cfg, &["a".into(), "b".into()]));
        assert!(!reorder(&mut cfg, &["a".into(), "b".into(), "c".into(), "d".into()]));
        assert!(!reorder(&mut cfg, &["a".into(), "a".into(), "b".into()]));
        // Список остался прежним.
        let ids: Vec<&str> = cfg.games.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn validate_title_rejects_empty_and_whitespace() {
        // Пустое названий не должно попадать в конфиг — иначе в списке
        // будет пустая строка, которая рисуется без подписи.
        assert_eq!(validate_title(""), Err(AppError::new(code::EMPTY_TITLE)));
        assert!(validate_title("   ").is_err());
        assert!(validate_title("\t\n").is_err());
        // Названий с хоть каким-то текстом проходят.
        assert!(validate_title("Мой тест").is_ok());
        assert!(validate_title("  Полезная игра  ").is_ok());
    }

    #[test]
    fn update_sets_and_clears_the_video() {
        let mut cfg = cfg_with(&["a"]);
        let set = GamePatch {
            video: Some(Some(PathBuf::from(r"D:\v.mp4"))),
            ..GamePatch::default()
        };
        assert!(update(&mut cfg, "a", set));
        assert_eq!(cfg.games[0].video, Some(PathBuf::from(r"D:\v.mp4")));

        let clear = GamePatch { video: Some(None), ..GamePatch::default() };
        assert!(update(&mut cfg, "a", clear));
        assert_eq!(cfg.games[0].video, None);
    }
}
