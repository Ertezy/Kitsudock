//! Steam: корень установки из реестра, список библиотек из
//! `steamapps/libraryfolders.vdf`, сами игры из `steamapps/appmanifest_*.acf`.

use std::path::{Path, PathBuf};

use super::{read_manifest, InstalledGame, Launch, Source, MAX_MANIFEST_BYTES};
use crate::vdf;

/// Корни установки самого Steam: сначала реестр (пользователь мог поставить
/// куда угодно), затем стандартные места.
pub fn install_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Valve\Steam") {
            if let Ok(path) = key.get_value::<String, _>("InstallPath") {
                if !path.trim().is_empty() {
                    roots.push(PathBuf::from(path));
                }
            }
        }

        // Пользовательская запись: не подвержена перенаправлению WOW64 и
        // остаётся на месте, когда машинной записи нет. Steam пишет сюда путь
        // через прямые слэши — PathBuf на Windows их понимает. Если оба
        // источника дали один и тот же каталог в разном написании, дубль стоит
        // одного лишнего чтения каталога: installed() всё равно отсеивает игры
        // по appid.
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
            if let Ok(path) = key.get_value::<String, _>("SteamPath") {
                if !path.trim().is_empty() {
                    roots.push(PathBuf::from(path));
                }
            }
        }
    }

    roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    roots.push(PathBuf::from(r"C:\Program Files\Steam"));

    let mut seen = std::collections::HashSet::new();
    roots.retain(|p| seen.insert(p.clone()));
    roots
}

/// Библиотеки Steam: сам корень плюс всё, что перечислено в
/// `libraryfolders.vdf`. Пустой или нечитаемый файл — остаётся один корень.
pub fn library_roots_from_vdf(vdf_text: &str, steam_root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![steam_root.to_path_buf()];
    for path in vdf::all(&vdf::pairs(vdf_text), "path") {
        roots.push(PathBuf::from(path));
    }
    let mut seen = std::collections::HashSet::new();
    roots.retain(|p| seen.insert(p.clone()));
    roots
}

/// Одна игра из содержимого `appmanifest_*.acf`.
/// `library` — корень библиотеки, то есть папка, содержащая `steamapps`.
pub fn game_from_manifest(acf_text: &str, library: &Path) -> Option<InstalledGame> {
    let pairs = vdf::pairs(acf_text);
    let appid: u32 = vdf::first(&pairs, "appid")?.parse().ok()?;
    let title = vdf::first(&pairs, "name")?.to_string();
    let install_dir = vdf::first(&pairs, "installdir")?;

    Some(InstalledGame {
        title,
        install_path: library.join("steamapps").join("common").join(install_dir),
        exe_path: None,
        launch: Launch::Steam { appid },
        source: Source::Steam,
    })
}

/// Всё, что Steam считает установленным, во всех библиотеках.
pub fn installed() -> Vec<InstalledGame> {
    installed_in(&install_roots())
}

/// То же по готовому списку корней Steam. Файл крупнее `MAX_MANIFEST_BYTES`
/// (манифест игры или `libraryfolders.vdf`) пропускается с записью в журнал,
/// не читаясь целиком: без списка библиотек остаётся один корень.
fn installed_in(steam_roots: &[PathBuf]) -> Vec<InstalledGame> {
    let mut games = Vec::new();
    let mut seen_appids = std::collections::HashSet::new();

    for steam_root in steam_roots {
        let steamapps = steam_root.join("steamapps");
        if !steamapps.is_dir() {
            continue;
        }
        let vdf_path = steamapps.join("libraryfolders.vdf");
        let vdf_text = match read_manifest(&vdf_path) {
            Ok(Some(text)) => text,
            Ok(None) => {
                log::warn!(
                    "[steam] {:?} больше потолка в {MAX_MANIFEST_BYTES} байт, читаю только корень",
                    vdf_path
                );
                String::new()
            }
            Err(_) => String::new(),
        };

        for library in library_roots_from_vdf(&vdf_text, steam_root) {
            let dir = library.join("steamapps");
            let Ok(entries) = std::fs::read_dir(&dir) else {
                log::warn!("[steam] не могу прочитать библиотеку {:?}", dir);
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let is_manifest = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("appmanifest_") && n.ends_with(".acf"))
                    .unwrap_or(false);
                if !is_manifest {
                    continue;
                }
                let text = match read_manifest(&path) {
                    Ok(Some(text)) => text,
                    Ok(None) => {
                        log::warn!(
                            "[steam] манифест {:?} больше потолка в {MAX_MANIFEST_BYTES} байт, пропущен",
                            path
                        );
                        continue;
                    }
                    Err(_) => {
                        log::warn!("[steam] не могу прочитать манифест {:?}", path);
                        continue;
                    }
                };
                if let Some(game) = game_from_manifest(&text, &library) {
                    if let Launch::Steam { appid } = game.launch {
                        if seen_appids.insert(appid) {
                            games.push(game);
                        }
                    }
                } else {
                    log::warn!("[steam] не могу разобрать манифест {:?}", path);
                }
            }
        }
    }
    games
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_real_app_manifest() {
        let acf = r#""AppState"
{
	"appid"		"3513350"
	"name"		"Wuthering Waves"
	"installdir"		"Wuthering Waves"
}"#;
        let library = Path::new(r"C:\Program Files (x86)\Steam");
        let game = game_from_manifest(acf, library).expect("должен разобраться");

        assert_eq!(game.title, "Wuthering Waves");
        assert_eq!(
            game.install_path,
            Path::new(r"C:\Program Files (x86)\Steam\steamapps\common\Wuthering Waves")
        );
        assert!(matches!(game.launch, Launch::Steam { appid: 3513350 }));
        assert!(matches!(game.source, Source::Steam));
    }

    #[test]
    fn rejects_manifest_without_appid() {
        let acf = "\"AppState\"\n{\n\t\"name\"\t\t\"Broken\"\n}";
        assert!(game_from_manifest(acf, Path::new(r"C:\Steam")).is_none());
    }

    #[test]
    fn rejects_manifest_with_non_numeric_appid() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"abc\"\n\t\"name\"\t\t\"X\"\n\t\"installdir\"\t\t\"X\"\n}";
        assert!(game_from_manifest(acf, Path::new(r"C:\Steam")).is_none());
    }

    #[test]
    fn finds_every_library_including_other_drives() {
        let vdf_text = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        let roots = library_roots_from_vdf(vdf_text, Path::new(r"C:\Program Files (x86)\Steam"));
        assert_eq!(
            roots,
            vec![
                PathBuf::from(r"C:\Program Files (x86)\Steam"),
                PathBuf::from(r"D:\SteamLibrary"),
            ]
        );
    }

    fn appids(games: &[InstalledGame]) -> Vec<u32> {
        let mut ids: Vec<u32> = games
            .iter()
            .filter_map(|g| match g.launch {
                Launch::Steam { appid } => Some(appid),
                _ => None,
            })
            .collect();
        ids.sort_unstable();
        ids
    }

    /// Манифест игры; `padding` знаков в лишнем поле раздувают файл.
    fn acf(appid: u32, padding: usize) -> String {
        let junk = "x".repeat(padding);
        format!(
            "\"AppState\"\n{{\n\t\"appid\"\t\t\"{appid}\"\n\t\"name\"\t\t\"G{appid}\"\n\t\"installdir\"\t\t\"G{appid}\"\n\t\"junk\"\t\t\"{junk}\"\n}}"
        )
    }

    /// `libraryfolders.vdf` с одной дополнительной библиотекой.
    fn library_list(library: &Path, padding: usize) -> String {
        let path = library.display().to_string().replace('\\', "\\\\");
        let junk = "x".repeat(padding);
        format!(
            "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{path}\"\n\t}}\n\t\"junk\"\t\t\"{junk}\"\n}}"
        )
    }

    #[test]
    fn oversized_steam_files_are_skipped_and_the_rest_are_still_read() {
        let base = std::env::temp_dir().join(format!("gh-steam-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("steam");
        let other = base.join("lib2");
        let big = MAX_MANIFEST_BYTES as usize;
        std::fs::create_dir_all(root.join("steamapps")).unwrap();
        std::fs::create_dir_all(other.join("steamapps")).unwrap();
        std::fs::write(root.join("steamapps").join("appmanifest_1.acf"), acf(1, 0)).unwrap();
        std::fs::write(root.join("steamapps").join("appmanifest_2.acf"), acf(2, big)).unwrap();
        std::fs::write(other.join("steamapps").join("appmanifest_3.acf"), acf(3, 0)).unwrap();
        let vdf_path = root.join("steamapps").join("libraryfolders.vdf");
        let roots = [root.clone()];

        // Список библиотек крупнее потолка не читается: остаётся один корень.
        // Манифест игры 2 крупнее потолка пропущен в любом случае.
        std::fs::write(&vdf_path, library_list(&other, big)).unwrap();
        assert_eq!(appids(&installed_in(&roots)), [1]);

        // Тот же список обычного размера: вторая библиотека находится.
        std::fs::write(&vdf_path, library_list(&other, 0)).unwrap();
        assert_eq!(appids(&installed_in(&roots)), [1, 3]);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn falls_back_to_the_steam_root_when_vdf_is_unreadable() {
        let roots = library_roots_from_vdf("", Path::new(r"C:\Steam"));
        assert_eq!(roots, vec![PathBuf::from(r"C:\Steam")]);
    }
}
