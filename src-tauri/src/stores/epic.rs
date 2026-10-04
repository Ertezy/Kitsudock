//! Epic Games Launcher ведёт по файлу `*.item` на каждую установленную вещь
//! в `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests`.
//!
//! Записи с пустым `LaunchExecutable` — это DLC, а не игры; их отбрасываем
//! молча, без лога: это ожидаемый случай, а не сбой. Настоящая ошибка
//! разбора — совсем другое дело, и только она попадает в `[epic]`-лог.
//! Три идентификатора из манифеста складываются в официальную ссылку запуска,
//! поэтому пользователю не нужно ничего вводить руками.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{read_manifest, InstalledGame, Launch, Source, MAX_MANIFEST_BYTES};

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Manifest {
    display_name: String,
    install_location: String,
    launch_executable: String,
    catalog_namespace: String,
    catalog_item_id: String,
    app_name: String,
}

/// Три исхода разбора одной записи `.item`: их нельзя схлопывать в один
/// `Option`, иначе вызывающий код не отличит нормальный пропуск DLC от
/// настоящей ошибки — а именно это и была исходная проблема.
#[derive(Debug)]
pub enum ManifestEntry {
    /// Настоящая игра, годная к запуску.
    Game(InstalledGame),
    /// DLC: `LaunchExecutable` пуст. Это норма, а не сбой — логировать не надо.
    Dlc,
    /// JSON не разобрался или не хватает полей — вот это уже стоит залогировать.
    Invalid,
    /// Запись разобралась, но один из идентификаторов запуска пуст или с
    /// посторонними знаками (см. `is_launch_id`). Внутри — имя поля из
    /// манифеста: в журнал идёт оно, а не значение.
    BadId(&'static str),
}

/// Годится ли идентификатор для ссылки запуска: непустой, только латинские
/// буквы и цифры, точка, подчёркивание и дефис (`^[A-Za-z0-9._-]+$`). Двоеточие,
/// `%`, `/`, `?`, `&`, `#`, пробел и перевод строки в нём изменили бы смысл
/// ссылки, а у настоящих записей Epic таких знаков нет.
fn is_launch_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// Имя в манифесте первого из трёх идентификаторов, который не годится для
/// ссылки запуска, — или `None`, если годятся все. Порядок полей постоянный:
/// в журнал и в ошибку идёт первое по порядку.
///
/// Эти три строки целиком попадают в ссылку запуска (`launch::epic_uri`),
/// поэтому годятся только простые. Проверка нужна дважды: при чтении манифеста,
/// который лежит в общей для всех папке, и перед запуском сохранённой игры —
/// конфиг мог быть изменён после того, как игра была найдена.
pub(crate) fn first_bad_launch_id(
    namespace: &str,
    catalog_item_id: &str,
    app_name: &str,
) -> Option<&'static str> {
    [
        ("CatalogNamespace", namespace),
        ("CatalogItemId", catalog_item_id),
        ("AppName", app_name),
    ]
    .into_iter()
    .find(|(_, id)| !is_launch_id(id))
    .map(|(field, _)| field)
}

/// Одна запись из содержимого файла `.item`.
pub fn game_from_manifest(json: &str) -> ManifestEntry {
    let Ok(m) = serde_json::from_str::<Manifest>(json) else {
        return ManifestEntry::Invalid;
    };
    if m.launch_executable.trim().is_empty() {
        return ManifestEntry::Dlc;
    }
    if let Some(field) = first_bad_launch_id(&m.catalog_namespace, &m.catalog_item_id, &m.app_name) {
        return ManifestEntry::BadId(field);
    }
    let install_path = PathBuf::from(&m.install_location);
    ManifestEntry::Game(InstalledGame {
        title: m.display_name,
        exe_path: Some(install_path.join(&m.launch_executable)),
        install_path,
        launch: Launch::Epic {
            namespace: m.catalog_namespace,
            catalog_item_id: m.catalog_item_id,
            app_name: m.app_name,
        },
        source: Source::Epic,
    })
}

fn manifests_dir() -> Option<PathBuf> {
    let program_data = std::env::var_os("PROGRAMDATA")?;
    Some(
        PathBuf::from(program_data)
            .join("Epic")
            .join("EpicGamesLauncher")
            .join("Data")
            .join("Manifests"),
    )
}

/// Всё, что Epic считает установленным.
pub fn installed() -> Vec<InstalledGame> {
    match manifests_dir() {
        Some(dir) => installed_in(&dir),
        None => Vec::new(),
    }
}

/// То же по папке с манифестами. Файл крупнее `MAX_MANIFEST_BYTES` пропускается
/// с записью в журнал, не читаясь целиком.
fn installed_in(dir: &Path) -> Vec<InstalledGame> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut games = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_item = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("item"))
            .unwrap_or(false);
        if !is_item {
            continue;
        }
        let text = match read_manifest(&path) {
            Ok(Some(text)) => text,
            Ok(None) => {
                log::warn!(
                    "[epic] манифест {:?} больше потолка в {MAX_MANIFEST_BYTES} байт, пропущен",
                    path
                );
                continue;
            }
            Err(_) => {
                log::warn!("[epic] не могу прочитать манифест {:?}", path);
                continue;
            }
        };
        match game_from_manifest(&text) {
            ManifestEntry::Game(game) => games.push(game),
            ManifestEntry::Dlc => {}
            ManifestEntry::Invalid => {
                log::warn!("[epic] не могу разобрать манифест {:?}", path);
            }
            // Само значение в журнал не идёт: в нём могут быть любые знаки.
            ManifestEntry::BadId(field) => {
                log::warn!(
                    "[epic] в манифесте {:?} недопустимое значение поля {field}: игра пропущена",
                    path
                );
            }
        }
    }
    games
}

#[cfg(test)]
mod tests {
    use super::*;

    const GENSHIN: &str = r#"{
      "DisplayName": "Genshin Impact",
      "InstallLocation": "D:\\Games\\GenshinImpact",
      "LaunchExecutable": "launcher_epic.exe",
      "CatalogNamespace": "879b0d8776ab46a59a129983ba78f0ce",
      "CatalogItemId": "7d690c122fde4c60bed85405f343ad10",
      "AppName": "41869934302e4b8cafac2d3c0e7c293d"
    }"#;

    const DLC: &str = r#"{
      "DisplayName": "Civilization VI : Aztec DLC",
      "InstallLocation": "C:\\Program Files\\Epic Games\\SidMeiersCivilizationVI",
      "LaunchExecutable": "",
      "CatalogNamespace": "cd14dcaa4f3443f19f7169a980559c62",
      "CatalogItemId": "cd9e44a9d1b14b8d84923bb985bc1636",
      "AppName": "KingletAztec"
    }"#;

    fn expect_game(entry: ManifestEntry) -> InstalledGame {
        match entry {
            ManifestEntry::Game(game) => game,
            other => panic!("ожидалась игра, получено {other:?}"),
        }
    }

    #[test]
    fn parses_a_real_manifest() {
        let game = expect_game(game_from_manifest(GENSHIN));
        assert_eq!(game.title, "Genshin Impact");
        assert_eq!(game.install_path, PathBuf::from(r"D:\Games\GenshinImpact"));
        assert_eq!(
            game.exe_path,
            Some(PathBuf::from(r"D:\Games\GenshinImpact\launcher_epic.exe"))
        );
        assert!(matches!(game.source, Source::Epic));
    }

    #[test]
    fn keeps_all_three_launch_identifiers() {
        let game = expect_game(game_from_manifest(GENSHIN));
        match game.launch {
            Launch::Epic {
                namespace,
                catalog_item_id,
                app_name,
            } => {
                assert_eq!(namespace, "879b0d8776ab46a59a129983ba78f0ce");
                assert_eq!(catalog_item_id, "7d690c122fde4c60bed85405f343ad10");
                assert_eq!(app_name, "41869934302e4b8cafac2d3c0e7c293d");
            }
            other => panic!("ожидался Epic, получено {other:?}"),
        }
    }

    #[test]
    fn skips_dlc_entries_that_have_no_executable() {
        assert!(matches!(game_from_manifest(DLC), ManifestEntry::Dlc));
    }

    #[test]
    fn skips_malformed_json() {
        assert!(matches!(
            game_from_manifest("{ not json"),
            ManifestEntry::Invalid
        ));
    }

    /// Манифест Genshin с одним подменённым полем.
    fn genshin_with(field: &str, value: &str) -> String {
        let original = GENSHIN
            .lines()
            .find(|line| line.contains(&format!("\"{field}\"")))
            .expect("в образце есть такое поле");
        let comma = if original.trim_end().ends_with(',') { "," } else { "" };
        let replaced = format!(
            "      \"{field}\": {}{comma}",
            serde_json::to_string(value).unwrap()
        );
        GENSHIN.replace(original, &replaced)
    }

    #[test]
    fn identifiers_with_ordinary_characters_are_accepted() {
        for id in ["879b0d87", "Fortnite", "a.b_c-d", "A", "0"] {
            for field in ["CatalogNamespace", "CatalogItemId", "AppName"] {
                let entry = game_from_manifest(&genshin_with(field, id));
                assert!(matches!(entry, ManifestEntry::Game(_)), "{field}={id:?}");
            }
        }
    }

    #[test]
    fn identifiers_with_other_characters_make_the_game_invalid() {
        let bad = [
            "",
            "a b",
            "a%3Ab",
            "a:b",
            "a/b",
            "a\\b",
            "a?b",
            "a&b",
            "a#b",
            "a\"b",
            "a\nb",
            "a\u{0}b",
            "игра",
            "a\u{ff21}",
            " ",
        ];
        for field in ["CatalogNamespace", "CatalogItemId", "AppName"] {
            for id in bad {
                let entry = game_from_manifest(&genshin_with(field, id));
                // Не просто «негодно», а с именем поля: оно попадает в журнал.
                assert!(
                    matches!(&entry, ManifestEntry::BadId(f) if *f == field),
                    "{field}={id:?}: {entry:?}"
                );
            }
        }
    }

    #[test]
    fn the_first_bad_identifier_in_manifest_order_is_the_one_named() {
        let both = genshin_with("AppName", "a b").replace("879b0d8776ab46a59a129983ba78f0ce", "a:b");
        assert!(matches!(
            game_from_manifest(&both),
            ManifestEntry::BadId("CatalogNamespace")
        ));
        let item_and_app = genshin_with("AppName", "a b").replace("7d690c122fde4c60bed85405f343ad10", "x/y");
        assert!(matches!(
            game_from_manifest(&item_and_app),
            ManifestEntry::BadId("CatalogItemId")
        ));
    }

    #[test]
    fn a_bad_identifier_is_not_the_same_outcome_as_unreadable_json() {
        let bad = game_from_manifest(&genshin_with("AppName", "a b"));
        assert!(matches!(bad, ManifestEntry::BadId(_)));
        assert!(!matches!(bad, ManifestEntry::Invalid));
        assert!(!matches!(game_from_manifest("{ not json"), ManifestEntry::BadId(_)));
    }

    /// DLC отбрасывается молча и раньше проверки идентификаторов: у него
    /// ожидаемо может быть что угодно, и лог он засорять не должен.
    #[test]
    fn dlc_stays_dlc_even_with_odd_identifiers() {
        let dlc = DLC.replace("KingletAztec", "king let/aztec");
        assert!(matches!(game_from_manifest(&dlc), ManifestEntry::Dlc));
    }

    #[test]
    fn an_oversized_manifest_is_skipped_and_the_others_are_still_read() {
        let dir = std::env::temp_dir().join(format!("gh-epic-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(dir.join("small.item"), GENSHIN).unwrap();
        // Годный JSON с настоящей игрой, но крупнее потолка: пропущен только
        // из-за размера.
        let big = genshin_with("DisplayName", "Huge").replacen(
            '{',
            &format!("{{ \"Padding\": \"{}\",", "x".repeat(MAX_MANIFEST_BYTES as usize)),
            1,
        );
        assert!(matches!(game_from_manifest(&big), ManifestEntry::Game(_)));
        std::fs::write(dir.join("big.item"), &big).unwrap();

        let titles: Vec<String> = installed_in(&dir).into_iter().map(|g| g.title).collect();
        assert_eq!(titles, ["Genshin Impact"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Закрепляет саму суть исправления: DLC и нечитаемая запись — это два
    /// разных исхода, а не один и тот же `None`. Раньше `installed()` не мог
    /// их различить и логировал оба как ошибку разбора.
    #[test]
    fn dlc_and_malformed_entries_are_distinguishable() {
        let dlc = game_from_manifest(DLC);
        let invalid = game_from_manifest("{ not json");

        assert!(matches!(dlc, ManifestEntry::Dlc));
        assert!(matches!(invalid, ManifestEntry::Invalid));
        assert!(!matches!(dlc, ManifestEntry::Invalid));
        assert!(!matches!(invalid, ManifestEntry::Dlc));
    }
}
