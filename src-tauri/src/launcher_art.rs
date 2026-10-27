//! Официальные фоны лаунчера HoYoPlay: своя папка кеша, докачка в отдельном
//! потоке и уборка файлов, адресов которых больше нет.
//!
//! Отдельная папка, а не общая папка фонов: адреса меняются с каждым патчем, и
//! уборка по списку текущих адресов не должна задевать свои картинки человека
//! и картинки магазинов.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::art::{claim, finish, forget, forget_tried, DownloadState};

/// Потолок веса официального видео фона: у HoYoPlay ролики около 15 МБ.
pub const MAX_VIDEO_BYTES: u64 = 60 * 1024 * 1024;

/// Папка кеша официальных фонов.
pub fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("нет папки кеша: {e}"))?
        .join("launcher-art");
    std::fs::create_dir_all(&dir).map_err(|e| format!("не создать папку кеша фонов лаунчера: {e}"))?;
    Ok(dir)
}

/// Видео ли это по адресу.
fn is_video_url(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
    path.ends_with(".webm") || path.ends_with(".mp4")
}

/// Потолок для файла по адресу: видео — свой, картинка — как у остальных картинок.
fn cap_for(url: &str) -> u64 {
    if is_video_url(url) {
        MAX_VIDEO_BYTES
    } else {
        crate::images::MAX_IMAGE_BYTES
    }
}

/// Сначала все картинки, потом все видео; внутри каждой группы порядок прежний.
/// Картинка весит единицы мегабайт и сразу делает фон настоящим, видео — десятки
/// мегабайт, и ждать его ради картинки следующей игры незачем.
fn pictures_first(urls: Vec<String>) -> Vec<String> {
    let (videos, mut pictures): (Vec<String>, Vec<String>) =
        urls.into_iter().partition(|url| is_video_url(url));
    pictures.extend(videos);
    pictures
}

/// Адреса, которых ещё нет в кеше.
pub fn pending(wanted: &[String], dir: &Path) -> Vec<String> {
    wanted
        .iter()
        .filter(|url| crate::images::cached(dir, url).is_none())
        .cloned()
        .collect()
}

/// Удаляет файлы, адресов которых нет среди нужных. Пустой список — ничего не
/// трогает: хаб не прочитался или фоны выключены, и это не повод чистить кеш.
///
/// Недокачанный `хеш.расширение.part` относится к тому же адресу, что и его
/// итоговый файл. Остаток от ненужного адреса удаляется, а от нужного остаётся:
/// его пишет поток докачки, который мог работать, пока другой вызов
/// `start_downloads` убирал устаревшее. Сам поток пишет, переименовывает и только
/// потом зовёт `remove_stale`, так что собственный файл он не заденет. Остаток
/// от нужного адреса не опасен: `cached` его не видит, а следующая докачка
/// этого адреса перепишет его и переименует.
pub fn remove_stale(dir: &Path, wanted: &[String]) -> usize {
    if wanted.is_empty() {
        return 0;
    }
    let keep: std::collections::HashSet<String> =
        wanted.iter().map(|url| crate::images::cache_stem(url)).collect();
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        // У `хеш.webm.part` отбрасываем `.part`, дальше всё как у готового файла.
        let named = if path.extension().is_some_and(|e| e == "part") {
            path.with_extension("")
        } else {
            path.clone()
        };
        let stem = named.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if path.is_file() && !keep.contains(&stem) && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Состояние докачки, которое хранит Tauri (`manage`).
#[derive(Debug, Default)]
pub struct LauncherArtDownloads(pub Mutex<DownloadState>);

/// Докачивает недостающие официальные фоны в отдельном потоке и убирает
/// устаревшие. Окно не ждёт; скачалось что-то — список игр обновляется.
pub fn start_downloads(app: &AppHandle, wanted: Vec<String>) {
    let Ok(dir) = cache_dir(app) else { return };
    let todo = pending(&wanted, &dir);
    let claimed = {
        let state = app.state::<LauncherArtDownloads>();
        let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
        claim(&mut state, todo)
    };
    let Some(urls) = claimed else {
        // Качать нечего — устаревшее можно убрать сразу.
        remove_stale(&dir, &wanted);
        return;
    };
    let app = app.clone();
    let urls = pictures_first(urls);
    let picture_count = urls.iter().filter(|url| !is_video_url(url)).count();
    std::thread::spawn(move || {
        // Скачанное, о чём окно ещё не знает.
        let mut unannounced = 0;
        let announce = |app: &AppHandle| {
            if let Err(e) = app.emit("games-changed", ()) {
                log::warn!("[launcher-art] окно не узнало о новых фонах: {e}");
            }
        };
        for (index, url) in urls.iter().enumerate() {
            match crate::images::fetch_into(&dir, url, cap_for(url)) {
                Ok(_) => {
                    unannounced += 1;
                    // Удачный адрес больше не «опробованный»: закрытыми до следующего
                    // запуска остаются только неудачные.
                    let state = app.state::<LauncherArtDownloads>();
                    let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
                    forget(&mut state, url);
                }
                Err(e) => log::warn!("[launcher-art] фон лаунчера не скачался: {e}"),
            }
            // Картинки закончились, видео ещё качаются: окно узнаёт о картинках
            // сразу, а не после десятков мегабайт видео. Пока поток работает,
            // `claim` возвращает `None`, так что повторный запуск ничего не собьёт.
            if index + 1 == picture_count && unannounced > 0 {
                announce(&app);
                unannounced = 0;
            }
        }
        remove_stale(&dir, &wanted);
        {
            let state = app.state::<LauncherArtDownloads>();
            let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
            finish(&mut state);
        }
        if unannounced > 0 {
            announce(&app);
        }
    });
}

/// После очистки кеша фоны скачиваются заново, в том числе неудачные раньше.
pub fn forget_tried_downloads(app: &AppHandle) {
    let state = app.state::<LauncherArtDownloads>();
    let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
    forget_tried(&mut state);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("launcher-art-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const IMG: &str = "https://cdn.example.test/bg/g.webp";
    const VID: &str = "https://cdn.example.test/bg/g.webm";

    #[test]
    fn only_files_not_in_the_cache_are_pending() {
        let dir = scratch("pending");
        std::fs::write(dir.join(crate::images::file_name_for(IMG, "webp")), b"x").unwrap();
        assert_eq!(pending(&[IMG.to_string(), VID.to_string()], &dir), vec![VID.to_string()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stale_files_go_and_wanted_ones_stay() {
        let dir = scratch("stale");
        let keep = dir.join(crate::images::file_name_for(IMG, "webp"));
        let old = dir.join(crate::images::file_name_for("https://cdn.example.test/bg/old.webm", "webm"));
        std::fs::write(&keep, b"x").unwrap();
        std::fs::write(&old, b"x").unwrap();
        assert_eq!(remove_stale(&dir, &[IMG.to_string(), VID.to_string()]), 1);
        assert!(keep.is_file());
        assert!(!old.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_is_removed_when_nothing_is_wanted() {
        // Пустой список — хаб не прочитался или галочка выключена: кеш не трогаем.
        let dir = scratch("empty");
        let file = dir.join(crate::images::file_name_for(IMG, "webp"));
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(remove_stale(&dir, &[]), 0);
        assert!(file.is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_leftover_part_file_of_an_unwanted_address_is_removed() {
        let dir = scratch("part-old");
        let old = dir.join(format!(
            "{}.part",
            crate::images::file_name_for("https://cdn.example.test/bg/old.webm", "webm")
        ));
        std::fs::write(&old, b"half").unwrap();
        assert_eq!(remove_stale(&dir, &[IMG.to_string()]), 1);
        assert!(!old.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_part_file_of_a_wanted_address_stays_for_the_download_that_writes_it() {
        let dir = scratch("part-wanted");
        let part = dir.join(format!("{}.part", crate::images::file_name_for(VID, "webm")));
        std::fs::write(&part, b"half").unwrap();
        assert_eq!(remove_stale(&dir, &[IMG.to_string(), VID.to_string()]), 0);
        assert!(part.is_file());
        // Недокачанное готовым не считается: файл всё ещё в очереди на докачку.
        assert_eq!(pending(&[VID.to_string()], &dir), vec![VID.to_string()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn pictures_go_before_videos_and_keep_their_order() {
        let urls = vec![
            "https://cdn.example.test/bg/a.webm".to_string(),
            "https://cdn.example.test/bg/a.webp".to_string(),
            "https://cdn.example.test/bg/b.MP4?x=1".to_string(),
            "https://cdn.example.test/bg/b.webp".to_string(),
        ];
        assert_eq!(
            pictures_first(urls),
            vec![
                "https://cdn.example.test/bg/a.webp".to_string(),
                "https://cdn.example.test/bg/b.webp".to_string(),
                "https://cdn.example.test/bg/a.webm".to_string(),
                "https://cdn.example.test/bg/b.MP4?x=1".to_string(),
            ]
        );
    }

    #[test]
    fn pictures_first_leaves_a_single_kind_and_an_empty_list_alone() {
        assert!(pictures_first(Vec::new()).is_empty());
        let only_videos = vec![VID.to_string(), "https://cdn.example.test/bg/h.mp4".to_string()];
        assert_eq!(pictures_first(only_videos.clone()), only_videos);
    }

    #[test]
    fn videos_get_the_bigger_ceiling() {
        assert_eq!(cap_for(VID), MAX_VIDEO_BYTES);
        assert_eq!(cap_for("https://cdn.example.test/bg/g.MP4"), MAX_VIDEO_BYTES);
        assert_eq!(cap_for(IMG), crate::images::MAX_IMAGE_BYTES);
    }
}
