//! Соответствие «установленная игра → идентификатор контента».
//!
//! Каталог НЕ знает, как игру запускать: это говорят манифесты магазинов.
//! Он отвечает только на вопрос, показывать ли по этой игре коды, баннеры
//! и видео, и под каким идентификатором искать их в файле хаба.
//!
//! Таблица соответствий живёт в файле хаба, а не в коде: поддержка шестой
//! игры — правка файла, а не выпуск новой версии приложения.

use crate::config::{Game, Launch};
use crate::hub::HubGame;
use crate::stores::InstalledGame;

/// Приводит название к виду, устойчивому к пунктуации, регистру и пробелам.
pub fn normalize(title: &str) -> String {
    title
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Идентификатор контента для найденной игры, если она есть в каталоге.
///
/// Steam appid приоритетнее названия: название в манифесте могут поменять,
/// appid — нет.
pub fn content_id_for(game: &InstalledGame, hub_games: &[HubGame]) -> Option<String> {
    if let Launch::Steam { appid } = game.launch {
        if let Some(g) = hub_games
            .iter()
            .find(|g| g.matching.steam_app_ids.contains(&appid))
        {
            return Some(g.id.clone());
        }
    }

    let title = normalize(&game.title);
    hub_games
        .iter()
        .find(|g| {
            normalize(&g.title) == title
                || g.matching
                    .folder_names
                    .iter()
                    .any(|n| normalize(n) == title)
        })
        .map(|g| g.id.clone())
}

/// Находит установленную игру, соответствующую записи пользователя: сперва
/// по идентификатору контента, если он есть, иначе — по нормализованному
/// названию.
fn find_installed<'a>(
    game: &Game,
    installed: &'a [InstalledGame],
    hub_games: &[HubGame],
) -> Option<&'a InstalledGame> {
    if let Some(cid) = game.content_id.as_deref() {
        if let Some(found) = installed
            .iter()
            .find(|ig| content_id_for(ig, hub_games).as_deref() == Some(cid))
        {
            return Some(found);
        }
    }
    let normalized = normalize(&game.title);
    installed
        .iter()
        .find(|ig| normalize(&ig.title) == normalized)
}

/// Есть ли в конфиге пользователя запись, уже соответствующая этой найденной
/// игре — по тому же сравнению, что и `find_installed` (сначала по
/// идентификатору содержимого, потом по нормализованному названию).
///
/// `scan_installed` раньше сравнивал только `exePath`, а у игр Steam он
/// всегда `None` (см. `stores::steam`) — совпадение никогда не находилось,
/// и нажатие «Найти установленные игры» заводило вторую запись для уже
/// настроенной игры Steam. Два независимых сравнения «это та же игра»
/// расходятся быстро, поэтому здесь переиспользуется то же самое сравнение,
/// а не пишется второе.
pub fn already_configured(found: &InstalledGame, games: &[Game], hub_games: &[HubGame]) -> bool {
    let found_alone = std::slice::from_ref(found);
    games
        .iter()
        .any(|g| find_installed(g, found_alone, hub_games).is_some())
}

/// Дополняет игры пользователя данными из манифестов магазинов.
/// Возвращает true, если что-то изменилось.
///
/// Пишет только то, что пусто: способ запуска и пути подставляются лишь для
/// записи, у которой ещё нет `exePath` (например, только что перенесённой из
/// v1, где эти данные взять было неоткуда). Если пользователь уже указал
/// свой exe — в том числе намеренно направив его в папку другой игры к
/// общему лаунчеру — это решение не трогаем.
///
/// Заодно дозаполняет ещё два поля, тем же правилом «пишем только в пустое»:
/// идентификатор контента, если он не был присвоен при первом запуске (см.
/// комментарий у соответствующей ветки ниже), и название — но только у
/// записи, перенесённой из v1, где `title` равен `id`, потому что ключ
/// словаря стал и тем, и другим.
pub fn enrich_from_stores(
    games: &mut [Game],
    installed: &[InstalledGame],
    hub_games: &[HubGame],
) -> bool {
    let mut changed = false;

    for game in games.iter_mut() {
        let Some(found) = find_installed(game, installed, hub_games) else {
            continue;
        };

        // Восстанавливаем идентификатор контента, если его нет.
        //
        // Он присваивается один раз, при первом запуске, и если каталог тогда
        // не прочитался — остаётся пустым навсегда: на последующих запусках
        // работает уже эта функция, а не посев. Панель для такой игры молча
        // пуста. Пишем только в пустое: заполненный идентификатор не трогаем.
        if game.content_id.is_none() {
            if let Some(found_id) = content_id_for(found, hub_games) {
                game.content_id = Some(found_id);
                changed = true;
            }
        }

        // Отпечаток записи, перенесённой из v1: title там равен id, потому
        // что ключ словаря стал и тем, и другим.
        if game.title == game.id && game.title != found.title {
            game.title = found.title.clone();
            changed = true;
        }

        if matches!(game.launch, Launch::Exe) && game.exe_path.is_none() {
            let install_path = Some(found.install_path.clone());
            if game.launch != found.launch
                || game.install_path != install_path
                || game.exe_path != found.exe_path
            {
                game.launch = found.launch.clone();
                game.install_path = install_path;
                game.exe_path = found.exe_path.clone();
                changed = true;
            }
        }
    }

    changed
}

/// Заново находит игру в манифестах магазинов и **перезаписывает** её путь.
///
/// Это единственное место, где заполненный путь перезаписывается, и оно
/// намеренно отличается от `enrich_from_stores`, которая пишет только в пустое.
///
/// Отличие безопасно, потому что вызов приходит от человека: он нажал «Найти
/// заново» на игре, у которой файл действительно пропал. Автоматика
/// по-прежнему не трогает заполненное; трогает человек, и он знает, что делает.
///
/// Название не меняется: человек мог переименовать игру, и возвращать ему
/// имя из манифеста — значит отменять его правку.
pub fn relocate(game: &mut Game, installed: &[InstalledGame], hub_games: &[HubGame]) -> bool {
    let Some(found) = find_installed(game, installed, hub_games) else {
        return false;
    };
    game.launch = found.launch.clone();
    game.install_path = Some(found.install_path.clone());
    game.exe_path = found.exe_path.clone();
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stores::{InstalledGame, Source};
    use std::path::PathBuf;

    fn game(title: &str, launch: Launch, source: Source) -> InstalledGame {
        InstalledGame {
            title: title.to_string(),
            install_path: PathBuf::from(r"C:\x"),
            exe_path: None,
            launch,
            source,
        }
    }

    #[test]
    fn normalizes_punctuation_and_case() {
        assert_eq!(normalize("Honkai: Star Rail"), "honkaistarrail");
        assert_eq!(normalize("Arknights: Endfield"), "arknightsendfield");
        assert_eq!(normalize("  ZENLESS  ZONE  ZERO "), "zenlesszonezero");
    }

    #[test]
    fn matches_a_known_game_by_title() {
        use crate::hub::HubGame;

        let hub_games = vec![HubGame {
            id: "hsr".into(),
            title: "Honkai: Star Rail".into(),
            redeem_url: None,
            matching: Default::default(),
            background: None,
        }];
        let g = game(
            "Honkai: Star Rail",
            Launch::Epic {
                namespace: "n".into(),
                catalog_item_id: "c".into(),
                app_name: "a".into(),
            },
            Source::Epic,
        );
        assert_eq!(content_id_for(&g, &hub_games).as_deref(), Some("hsr"));
    }

    #[test]
    fn matches_wuthering_waves_by_steam_appid_even_if_renamed() {
        let g = game("Wuthering  Waves", Launch::Steam { appid: 3513350 }, Source::Steam);
        assert_eq!(content_id_for(&g, &hub_games()).as_deref(), Some("wuthering"));
    }

    #[test]
    fn returns_none_for_a_game_we_know_nothing_about() {
        let g = game("Limbus Company", Launch::Steam { appid: 1973530 }, Source::Steam);
        assert_eq!(content_id_for(&g, &hub_games()), None);
    }

    #[test]
    fn enrich_fills_launch_and_paths_for_a_migrated_game_matched_by_content_id() {
        use crate::hub::HubGame;

        // «title == id» — отпечаток записи, перенесённой из v1: там ключ
        // словаря стал одновременно id и title.
        let hub_games = vec![HubGame {
            id: "hsr".into(),
            title: "Honkai: Star Rail".into(),
            redeem_url: None,
            matching: Default::default(),
            background: None,
        }];
        let mut games = vec![crate::config::Game {
            id: "hsr".into(),
            title: "hsr".into(),
            content_id: Some("hsr".into()),
            launch: Launch::Exe,
            install_path: None,
            exe_path: None,
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }];
        let installed = vec![InstalledGame {
            title: "Honkai: Star Rail".into(),
            install_path: PathBuf::from(r"C:\Games\HSR"),
            exe_path: Some(PathBuf::from(r"C:\Games\HSR\launcher_epic.exe")),
            launch: Launch::Epic {
                namespace: "n".into(),
                catalog_item_id: "c".into(),
                app_name: "a".into(),
            },
            source: Source::Epic,
        }];

        let changed = enrich_from_stores(&mut games, &installed, &hub_games);

        assert!(changed);
        assert_eq!(games[0].title, "Honkai: Star Rail");
        assert!(matches!(games[0].launch, Launch::Epic { .. }));
        assert_eq!(games[0].install_path, Some(PathBuf::from(r"C:\Games\HSR")));
        assert_eq!(
            games[0].exe_path,
            Some(PathBuf::from(r"C:\Games\HSR\launcher_epic.exe"))
        );
    }

    #[test]
    fn enrich_leaves_a_game_with_an_exe_path_already_set_untouched() {
        // Пользователь намеренно указал путь — возможно, на общий лаунчер
        // в папке другой игры. Перезаписывать это молча нельзя.
        let mut games = vec![crate::config::Game {
            id: "wuthering".into(),
            title: "Wuthering Waves".into(),
            content_id: Some("wuthering".into()),
            launch: Launch::Exe,
            install_path: Some(PathBuf::from(r"D:\Games\WutheringWaves")),
            exe_path: Some(PathBuf::from(r"D:\Games\WutheringWaves\launcher_epic.exe")),
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }];
        let installed = vec![InstalledGame {
            title: "Wuthering Waves".into(),
            install_path: PathBuf::from(r"C:\SteamLibrary\WutheringWaves"),
            exe_path: None,
            launch: Launch::Steam { appid: 3513350 },
            source: Source::Steam,
        }];

        let changed = enrich_from_stores(&mut games, &installed, &hub_games());

        assert!(!changed);
        assert!(matches!(games[0].launch, Launch::Exe));
        assert_eq!(
            games[0].install_path,
            Some(PathBuf::from(r"D:\Games\WutheringWaves"))
        );
        assert_eq!(
            games[0].exe_path,
            Some(PathBuf::from(r"D:\Games\WutheringWaves\launcher_epic.exe"))
        );
    }

    #[test]
    fn enrich_leaves_an_unmatched_game_completely_untouched() {
        let mut games = vec![crate::config::Game {
            id: "limbus".into(),
            title: "limbus".into(),
            content_id: Some("limbus".into()),
            launch: Launch::Exe,
            install_path: None,
            exe_path: None,
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }];
        let installed: Vec<InstalledGame> = Vec::new();

        let changed = enrich_from_stores(&mut games, &installed, &hub_games());

        assert!(!changed);
        assert_eq!(games[0].title, "limbus");
        assert!(matches!(games[0].launch, Launch::Exe));
        assert_eq!(games[0].exe_path, None);
    }

    #[test]
    fn enrich_returns_false_when_a_matched_game_needs_no_changes() {
        let mut games = vec![crate::config::Game {
            id: "wuthering".into(),
            title: "Wuthering Waves".into(),
            content_id: Some("wuthering".into()),
            launch: Launch::Steam { appid: 3513350 },
            install_path: Some(PathBuf::from(r"C:\SteamLibrary\WutheringWaves")),
            exe_path: None,
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }];
        let installed = vec![InstalledGame {
            title: "Wuthering Waves".into(),
            install_path: PathBuf::from(r"C:\SteamLibrary\WutheringWaves"),
            exe_path: None,
            launch: Launch::Steam { appid: 3513350 },
            source: Source::Steam,
        }];

        assert!(!enrich_from_stores(&mut games, &installed, &hub_games()));
    }

    #[test]
    fn enrich_restores_a_content_id_that_was_never_assigned() {
        // Первый запуск с непрочитанным каталогом оставляет content_id пустым.
        // Когда каталог появляется, он обязан дозаполниться, иначе панель для
        // этой игры пуста навсегда.
        let mut games = vec![Game {
            id: "wuthering".into(),
            title: "Wuthering Waves".into(),
            content_id: None,
            launch: Launch::Steam { appid: 3513350 },
            install_path: Some(std::path::PathBuf::from(r"C:\Games\WW")),
            exe_path: Some(std::path::PathBuf::from(r"C:\Games\WW\game.exe")),
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }];
        let found = vec![installed("Wuthering Waves", Launch::Steam { appid: 3513350 })];

        let changed = enrich_from_stores(&mut games, &found, &hub_games());

        assert!(changed);
        assert_eq!(games[0].content_id.as_deref(), Some("wuthering"));
    }

    #[test]
    fn enrich_never_overwrites_a_content_id_that_is_already_set() {
        // Заполненный идентификатор — свершившийся факт, как и выставленный
        // вручную путь. Перезапись сломала бы осознанный выбор человека.
        let mut games = vec![Game {
            id: "wuthering".into(),
            title: "Wuthering Waves".into(),
            content_id: Some("что-то-своё".into()),
            launch: Launch::Steam { appid: 3513350 },
            install_path: Some(std::path::PathBuf::from(r"C:\Games\WW")),
            exe_path: Some(std::path::PathBuf::from(r"C:\Games\WW\game.exe")),
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }];
        let found = vec![installed("Wuthering Waves", Launch::Steam { appid: 3513350 })];

        enrich_from_stores(&mut games, &found, &hub_games());

        assert_eq!(games[0].content_id.as_deref(), Some("что-то-своё"));
    }

    fn hub_games() -> Vec<crate::hub::HubGame> {
        use crate::hub::HubGame;
        use crate::hub::schema::Match;
        vec![
            HubGame {
                id: "wuthering".into(),
                title: "Wuthering Waves".into(),
                redeem_url: None,
                matching: Match {
                    steam_app_ids: vec![3513350],
                    epic_app_names: vec![],
                    folder_names: vec!["Wuthering Waves".into()],
                },
                background: None,
            },
            HubGame {
                id: "zzz".into(),
                title: "Zenless Zone Zero".into(),
                redeem_url: Some("https://zenless.hoyoverse.com/redemption?code={code}".into()),
                matching: Match {
                    steam_app_ids: vec![],
                    epic_app_names: vec![],
                    folder_names: vec!["ZenlessZoneZero".into()],
                },
                background: None,
            },
        ]
    }

    fn installed(title: &str, launch: Launch) -> InstalledGame {
        InstalledGame {
            title: title.into(),
            install_path: std::path::PathBuf::from(r"C:\Games\X"),
            exe_path: None,
            launch,
            source: crate::stores::Source::Steam,
        }
    }

    #[test]
    fn a_steam_appid_beats_the_title() {
        // Название в манифесте могут переименовать; appid — нет.
        let g = installed("Совершенно другое имя", Launch::Steam { appid: 3513350 });
        assert_eq!(content_id_for(&g, &hub_games()).as_deref(), Some("wuthering"));
    }

    #[test]
    fn a_title_matches_when_there_is_no_appid() {
        let g = installed("Zenless Zone Zero", Launch::Exe);
        assert_eq!(content_id_for(&g, &hub_games()).as_deref(), Some("zzz"));
    }

    #[test]
    fn title_matching_survives_punctuation_and_case() {
        let g = installed("zenless  zone-zero", Launch::Exe);
        assert_eq!(content_id_for(&g, &hub_games()).as_deref(), Some("zzz"));
    }

    #[test]
    fn an_unknown_game_matches_nothing() {
        // Игра не из каталога — не ошибка. Человек ставит что хочет,
        // лаунчер её запустит, просто контента по ней не будет.
        let g = installed("Factorio", Launch::Exe);
        assert_eq!(content_id_for(&g, &hub_games()), None);
    }

    #[test]
    fn an_empty_catalogue_matches_nothing_and_does_not_panic() {
        // Файл хаба может не приехать вовсе. Сопоставление обязано это пережить.
        let g = installed("Wuthering Waves", Launch::Steam { appid: 3513350 });
        assert_eq!(content_id_for(&g, &[]), None);
    }

    #[test]
    fn relocate_overwrites_a_path_that_went_stale() {
        // Это единственное место, где заполненный путь ПЕРЕЗАПИСЫВАЕТСЯ.
        // Оно вызывается только по прямому нажатию человека на «Найти заново»,
        // и только для одной игры.
        let mut game = Game {
            id: "wuthering".into(),
            title: "Wuthering Waves".into(),
            content_id: Some("wuthering".into()),
            launch: Launch::Exe,
            install_path: Some(std::path::PathBuf::from(r"C:\СТАРЫЙ\путь")),
            exe_path: Some(std::path::PathBuf::from(r"C:\СТАРЫЙ\путь\game.exe")),
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        };
        let found = vec![installed("Wuthering Waves", Launch::Steam { appid: 3513350 })];

        let ok = relocate(&mut game, &found, &hub_games());

        assert!(ok);
        assert_eq!(game.launch, Launch::Steam { appid: 3513350 });
        assert_eq!(game.install_path, Some(std::path::PathBuf::from(r"C:\Games\X")));
    }

    #[test]
    fn relocate_leaves_everything_alone_when_nothing_matches() {
        let mut game = Game {
            id: "самопал".into(),
            title: "Совершенно своя игра".into(),
            content_id: None,
            launch: Launch::Exe,
            install_path: Some(std::path::PathBuf::from(r"C:\своё")),
            exe_path: Some(std::path::PathBuf::from(r"C:\своё\game.exe")),
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        };
        let found = vec![installed("Wuthering Waves", Launch::Steam { appid: 3513350 })];

        let ok = relocate(&mut game, &found, &hub_games());

        assert!(!ok);
        assert_eq!(game.exe_path, Some(std::path::PathBuf::from(r"C:\своё\game.exe")));
    }

    #[test]
    fn relocate_does_not_touch_the_title_the_user_chose() {
        // Человек мог переименовать игру. Восстановление пути — не повод
        // возвращать название из манифеста.
        let mut game = Game {
            id: "ww".into(),
            title: "Моё название".into(),
            content_id: Some("wuthering".into()),
            launch: Launch::Exe,
            install_path: None,
            exe_path: Some(std::path::PathBuf::from(r"C:\старое\game.exe")),
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        };
        let found = vec![installed("Wuthering Waves", Launch::Steam { appid: 3513350 })];

        relocate(&mut game, &found, &hub_games());

        assert_eq!(game.title, "Моё название");
    }

    #[test]
    fn a_steam_game_already_in_the_config_is_marked_already_added() {
        // Это ровно тот баг, который чинит эта правка: раньше сравнение
        // в scan_installed шло по exePath, а у игр Steam он всегда None
        // (см. stores::steam), так что уже добавленная игра Steam никогда
        // не находилась, и кнопка «Найти установленные игры» завела бы
        // вторую запись для того же Wuthering Waves.
        let games = vec![Game {
            id: "wuthering".into(),
            title: "Wuthering Waves".into(),
            content_id: Some("wuthering".into()),
            launch: Launch::Steam { appid: 3513350 },
            install_path: Some(PathBuf::from(r"C:\SteamLibrary\WutheringWaves")),
            exe_path: None,
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }];
        let found = installed("Wuthering Waves", Launch::Steam { appid: 3513350 });

        assert!(already_configured(&found, &games, &hub_games()));
    }

    #[test]
    fn an_installed_game_not_in_the_config_is_not_marked_already_added() {
        let games: Vec<Game> = Vec::new();
        let found = installed("Wuthering Waves", Launch::Steam { appid: 3513350 });

        assert!(!already_configured(&found, &games, &hub_games()));
    }
}
