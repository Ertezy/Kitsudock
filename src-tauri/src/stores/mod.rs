//! Чтение списков установленного из собственных манифестов магазинов.
//!
//! Магазины сами ведут машинно-читаемый учёт того, что стоит на диске, —
//! это надёжнее, чем угадывать игру по имени папки.

pub mod epic;
pub mod launchers;
pub mod steam;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Потолок размера файла манифеста магазина (`.item` Epic, `.acf` и
/// `libraryfolders.vdf` Steam). Настоящие занимают единицы килобайт, а список
/// установленного читается при запуске, до появления окна: файл, подложенный
/// в общую папку, не должен заставлять приложение вычитывать его целиком.
pub(crate) const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// Текст файла манифеста, но не больше `MAX_MANIFEST_BYTES`. Файл крупнее
/// потолка — `Ok(None)`: вызывающий пропускает его и пишет об этом в журнал.
/// Нечитаемый или не UTF-8 файл — ошибка, как и у `read_to_string`.
pub(crate) fn read_manifest(path: &Path) -> std::io::Result<Option<String>> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Ok(None);
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

/// Чем именно запускается игра.
///
/// Живёт здесь, а не в `config.rs`, потому что источник этого знания —
/// манифест магазина. `config.rs` переэкспортирует тип, чтобы остальной код
/// обращался к нему как к `config::Launch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Launch {
    /// `steam://rungameid/<appid>`
    Steam { appid: u32 },
    /// `com.epicgames.launcher://apps/<ns>%3A<cid>%3A<app>?action=launch&silent=true`
    Epic {
        namespace: String,
        catalog_item_id: String,
        app_name: String,
    },
    /// Прямой запуск `exe_path`.
    Exe,
}

/// Откуда узнали про игру.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Steam,
    Epic,
    /// Игра из HoYoPlay (Genshin Impact, Honkai: Star Rail, Zenless Zone Zero).
    HoYoPlay,
    /// Игра из лаунчера Kuro Games (Wuthering Waves).
    Kuro,
    /// Игра из GRYPHLINK (Arknights: Endfield).
    Gryphlink,
}

/// Игра, найденная в манифесте магазина.
#[derive(Debug, Clone)]
pub struct InstalledGame {
    pub title: String,
    pub install_path: PathBuf,
    /// Известен для Epic (манифест прямо называет исполняемый файл) и для
    /// игр из собственных лаунчеров (см. `launchers`), у Steam — нет.
    pub exe_path: Option<PathBuf>,
    pub launch: Launch,
    /// Откуда найдена: по нему экран сканирования подписывает игры из
    /// собственных лаунчеров (`commands::found_kind`).
    pub source: Source,
}

/// Магазин, из которого установлена игра, и её номер там (спека этапа 5, §2.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreRef {
    Steam { appid: u32 },
    Epic { catalog_item_id: String },
}

fn store_ref(launch: &Launch) -> Option<StoreRef> {
    match launch {
        Launch::Steam { appid } => Some(StoreRef::Steam { appid: *appid }),
        Launch::Epic { catalog_item_id, .. } => Some(StoreRef::Epic {
            catalog_item_id: catalog_item_id.clone(),
        }),
        Launch::Exe => None,
    }
}

/// Лежит ли `child` внутри `parent` или совпадает с ним.
///
/// Сравнение по частям пути и без учёта регистра латиницы: на Windows
/// `C:\Games` и `c:\games` — одна папка, а строковое «начинается с» приняло бы
/// `D:\Game2` за содержимое `D:\Game`. Пустой `parent` не содержит ничего.
fn is_inside(child: &Path, parent: &Path) -> bool {
    if parent.as_os_str().is_empty() {
        return false;
    }
    let mut child_parts = child.components();
    parent.components().all(|p| {
        child_parts.next().is_some_and(|c| {
            c.as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case(&p.as_os_str().to_string_lossy())
        })
    })
}

/// Из какого магазина установлена игра.
///
/// Способ запуска говорит это прямо. Если игра запускается напрямую, её файл
/// ищется внутри папок, которые магазины записали в свои манифесты: у владельца
/// так записан Arknights: Endfield, установленный из Epic.
pub fn store_of(game: &crate::config::Game, installed: &[InstalledGame]) -> Option<StoreRef> {
    if let Some(found) = store_ref(&game.launch) {
        return Some(found);
    }
    let own = game.exe_path.as_deref().or(game.install_path.as_deref())?;
    installed
        .iter()
        .find(|i| is_inside(own, &i.install_path))
        .and_then(|i| store_ref(&i.launch))
}

/// Дописывает к находкам магазинов находки собственных лаунчеров.
///
/// Магазин — источник истины (§6 общей спеки): если Steam или Epic уже нашли
/// игру с таким названием, находка лаунчера отбрасывается, иначе одна и та же
/// игра попала бы в список дважды. Названия сравниваются так же, как везде при
/// сопоставлении игр (`catalog::normalize`: без учёта регистра и пунктуации).
/// Среди самих находок лаунчеров остаётся первая с данным названием — так
/// глобальная и китайская установки одной игры не задваиваются.
///
/// Находка пишется в журнал (info) здесь, один раз и только когда остаётся в
/// списке: искатели лаунчеров пишут в журнал одни промахи (debug), иначе
/// отброшенная находка значилась бы «найденной».
fn merge_finds(stores: Vec<InstalledGame>, launchers: Vec<InstalledGame>) -> Vec<InstalledGame> {
    let mut all = stores;
    for found in launchers {
        let title = crate::catalog::normalize(&found.title);
        if all.iter().any(|g| crate::catalog::normalize(&g.title) == title) {
            log::debug!(
                "[launchers] {:?} уже найдена магазином или другим лаунчером, пропускаю {:?}",
                found.title,
                found.exe_path
            );
            continue;
        }
        log::info!(
            "[launchers] {}: найдена через {}, {}",
            found.title,
            launchers::label(found.source),
            found.exe_path.as_deref().unwrap_or(&found.install_path).display()
        );
        all.push(found);
    }
    all
}

/// Всё установленное во всех магазинах и собственных лаунчерах.
pub fn installed() -> Vec<InstalledGame> {
    let mut stores = steam::installed();
    stores.extend(epic::installed());
    merge_finds(stores, launchers::installed())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Game;

    /// Пустая папка под файлы теста.
    fn scratch(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("gh-stores-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn a_manifest_up_to_the_ceiling_is_read_and_one_byte_more_is_not() {
        let dir = scratch("cap");
        let at_cap = dir.join("at.item");
        std::fs::write(&at_cap, "a".repeat(MAX_MANIFEST_BYTES as usize)).unwrap();
        let text = read_manifest(&at_cap).unwrap().expect("на пределе файл читается");
        assert_eq!(text.len() as u64, MAX_MANIFEST_BYTES);

        let over = dir.join("over.item");
        std::fs::write(&over, "a".repeat(MAX_MANIFEST_BYTES as usize + 1)).unwrap();
        assert!(read_manifest(&over).unwrap().is_none(), "на байт больше — пропуск");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_oversized_manifest_is_skipped_not_reported_as_unreadable() {
        // Двухбайтовые знаки поперёк границы: чтение до потолка оборвало бы
        // знак посередине, но это всё равно «слишком велик», а не ошибка текста.
        let dir = scratch("cap-utf8");
        let path = dir.join("big.item");
        std::fs::write(&path, "я".repeat(MAX_MANIFEST_BYTES as usize)).unwrap();
        assert!(read_manifest(&path).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_or_non_text_manifest_is_an_error() {
        let dir = scratch("cap-err");
        assert!(read_manifest(&dir.join("nope.item")).is_err());
        let binary = dir.join("bin.item");
        std::fs::write(&binary, [0xFF, 0xFE, 0x00, 0xC3]).unwrap();
        assert_eq!(
            read_manifest(&binary).unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn exe_game(exe: &str) -> Game {
        let mut g = Game::manual("g".into(), "G".into());
        g.exe_path = Some(PathBuf::from(exe));
        g
    }

    fn installed_at(path: &str, launch: Launch) -> InstalledGame {
        InstalledGame {
            title: "X".into(),
            install_path: PathBuf::from(path),
            exe_path: None,
            launch,
            source: Source::Epic,
        }
    }

    fn epic(id: &str) -> Launch {
        Launch::Epic {
            namespace: "ns".into(),
            catalog_item_id: id.into(),
            app_name: "app".into(),
        }
    }

    #[test]
    fn the_launch_kind_names_the_store_directly() {
        let mut steam = Game::manual("s".into(), "S".into());
        steam.launch = Launch::Steam { appid: 3513350 };
        assert_eq!(store_of(&steam, &[]), Some(StoreRef::Steam { appid: 3513350 }));

        let mut from_epic = Game::manual("e".into(), "E".into());
        from_epic.launch = epic("7d690c122fde4c60bed85405f343ad10");
        assert_eq!(
            store_of(&from_epic, &[]),
            Some(StoreRef::Epic { catalog_item_id: "7d690c122fde4c60bed85405f343ad10".into() })
        );
    }

    #[test]
    fn a_direct_launch_inside_an_epic_install_is_from_epic() {
        // Случай владельца: Arknights: Endfield записан как прямой запуск, хотя
        // установлен из Epic (спека §2.2).
        let game = exe_game(r"C:\Program Files\Epic Games\ArknightsEndfieldgowoU\Launcher.exe");
        let installed = [installed_at(
            r"C:\Program Files\Epic Games\ArknightsEndfieldgowoU",
            epic("6838c695288a4fcea4486285edebcfdf"),
        )];
        assert_eq!(
            store_of(&game, &installed),
            Some(StoreRef::Epic { catalog_item_id: "6838c695288a4fcea4486285edebcfdf".into() })
        );
    }

    #[test]
    fn a_direct_launch_inside_a_steam_install_is_from_steam() {
        let game = exe_game(r"D:\SteamLibrary\steamapps\common\Some Game\game.exe");
        let installed = [installed_at(
            r"D:\SteamLibrary\steamapps\common\Some Game",
            Launch::Steam { appid: 42 },
        )];
        assert_eq!(store_of(&game, &installed), Some(StoreRef::Steam { appid: 42 }));
    }

    #[test]
    fn letter_case_in_the_path_does_not_matter() {
        let game = exe_game(r"c:\program files\epic games\zzz\launcher_epic.exe");
        let installed = [installed_at(r"C:\Program Files\Epic Games\ZZZ", epic("id"))];
        assert_eq!(
            store_of(&game, &installed),
            Some(StoreRef::Epic { catalog_item_id: "id".into() })
        );
    }

    #[test]
    fn a_folder_with_a_longer_name_is_not_inside() {
        // Строковое «начинается с» приняло бы Game2 за содержимое Game.
        let game = exe_game(r"D:\Games\Game2\run.exe");
        let installed = [installed_at(r"D:\Games\Game", Launch::Steam { appid: 1 })];
        assert_eq!(store_of(&game, &installed), None);
    }

    #[test]
    fn a_game_from_an_arbitrary_folder_has_no_store() {
        let game = exe_game(r"E:\Portable\thing.exe");
        let installed = [installed_at(r"D:\Games\Game", Launch::Steam { appid: 1 })];
        assert_eq!(store_of(&game, &installed), None);
    }

    fn find(title: &str, source: Source, exe: &str) -> InstalledGame {
        InstalledGame {
            title: title.into(),
            install_path: PathBuf::from(exe).parent().map(Path::to_path_buf).unwrap_or_default(),
            exe_path: Some(PathBuf::from(exe)),
            launch: Launch::Exe,
            source,
        }
    }

    #[test]
    fn a_launcher_find_is_dropped_when_a_store_has_the_same_title() {
        let stores = vec![find("Wuthering Waves", Source::Steam, r"D:\Steam\ww.exe")];
        let launchers = vec![
            find("Wuthering Waves", Source::Kuro, r"C:\Kuro\ww.exe"),
            find("Genshin Impact", Source::HoYoPlay, r"C:\HYP\GenshinImpact.exe"),
        ];

        let all = merge_finds(stores, launchers);

        let titles: Vec<&str> = all.iter().map(|g| g.title.as_str()).collect();
        assert_eq!(titles, ["Wuthering Waves", "Genshin Impact"]);
        assert_eq!(all[0].source, Source::Steam);
        assert_eq!(all[1].source, Source::HoYoPlay);
    }

    #[test]
    fn the_title_comparison_ignores_letter_case() {
        let stores = vec![find("arknights: endfield", Source::Epic, r"C:\Epic\Launcher.exe")];
        let launchers = vec![find("Arknights: Endfield", Source::Gryphlink, r"C:\Gryph\Launcher.exe")];

        let all = merge_finds(stores, launchers);

        assert_eq!(all.len(), 1);
        assert_eq!(all[0].source, Source::Epic);
    }

    #[test]
    fn the_first_launcher_find_wins_among_launchers() {
        let launchers = vec![
            find("Honkai: Star Rail", Source::HoYoPlay, r"C:\Global\StarRail.exe"),
            find("Honkai: Star Rail", Source::HoYoPlay, r"C:\Cn\StarRail.exe"),
        ];

        let all = merge_finds(Vec::new(), launchers);

        assert_eq!(all.len(), 1);
        assert_eq!(all[0].exe_path, Some(PathBuf::from(r"C:\Global\StarRail.exe")));
    }

    #[test]
    fn store_finds_keep_their_order_and_come_first() {
        let stores = vec![
            find("B", Source::Steam, r"D:\b.exe"),
            find("A", Source::Epic, r"D:\a.exe"),
        ];
        let launchers = vec![find("C", Source::Kuro, r"D:\c.exe")];

        let all = merge_finds(stores, launchers);

        let titles: Vec<&str> = all.iter().map(|g| g.title.as_str()).collect();
        assert_eq!(titles, ["B", "A", "C"]);
    }

    #[test]
    fn no_launcher_finds_leave_the_stores_untouched() {
        let stores = vec![find("A", Source::Steam, r"D:\a.exe")];
        assert_eq!(merge_finds(stores, Vec::new()).len(), 1);
    }

    #[test]
    fn an_empty_install_path_matches_nothing() {
        // Пустой путь не имеет частей, и без отдельной проверки «лежит внутри»
        // было бы правдой для любого файла на диске.
        let game = exe_game(r"D:\Games\Any\run.exe");
        let installed = [installed_at("", Launch::Steam { appid: 1 })];
        assert_eq!(store_of(&game, &installed), None);
    }
}
