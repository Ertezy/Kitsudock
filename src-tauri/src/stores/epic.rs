//! Epic Games Launcher ведёт по файлу `*.item` на каждую установленную вещь
//! в `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests`.
//!
//! Записи с пустым `LaunchExecutable` — это DLC, а не игры; их отбрасываем
//! молча, без лога: это ожидаемый случай, а не сбой. Настоящая ошибка
//! разбора — совсем другое дело, и только она попадает в `[epic]`-лог.
//! Три идентификатора из манифеста складываются в официальную ссылку запуска,
//! поэтому пользователю не нужно ничего вводить руками.

use std::path::PathBuf;

use serde::Deserialize;

use super::{InstalledGame, Launch, Source};

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
    /// JSON не разобрался, не хватает полей или идентификаторы запуска с
    /// посторонними знаками (см. `is_launch_id`) — вот это уже стоит
    /// залогировать.
    Invalid,
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

/// Одна запись из содержимого файла `.item`.
pub fn game_from_manifest(json: &str) -> ManifestEntry {
    let Ok(m) = serde_json::from_str::<Manifest>(json) else {
        return ManifestEntry::Invalid;
    };
    if m.launch_executable.trim().is_empty() {
        return ManifestEntry::Dlc;
    }
    // Эти три строки целиком попадают в ссылку запуска (`launch::epic_uri`),
    // поэтому годятся только простые: манифест лежит в общей для всех папке.
    if ![&m.catalog_namespace, &m.catalog_item_id, &m.app_name]
        .into_iter()
        .all(|id| is_launch_id(id))
    {
        return ManifestEntry::Invalid;
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
    let Some(dir) = manifests_dir() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
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
        let Ok(text) = std::fs::read_to_string(&path) else {
            log::warn!("[epic] не могу прочитать манифест {:?}", path);
            continue;
        };
        match game_from_manifest(&text) {
            ManifestEntry::Game(game) => games.push(game),
            ManifestEntry::Dlc => {}
            ManifestEntry::Invalid => {
                log::warn!("[epic] манифест {:?} не разобран или с недопустимыми идентификаторами", path);
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
                assert!(matches!(entry, ManifestEntry::Invalid), "{field}={id:?}");
            }
        }
    }

    /// DLC отбрасывается молча и раньше проверки идентификаторов: у него
    /// ожидаемо может быть что угодно, и лог он засорять не должен.
    #[test]
    fn dlc_stays_dlc_even_with_odd_identifiers() {
        let dlc = DLC.replace("KingletAztec", "king let/aztec");
        assert!(matches!(game_from_manifest(&dlc), ManifestEntry::Dlc));
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
