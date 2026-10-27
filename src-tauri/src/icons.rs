//! Откуда взять иконку игры и где её хранить.
//!
//! Знает про игры и про файловую систему, но не знает, как устроен
//! исполняемый файл: этим занимается `pe`. Размер файла здесь тоже не важен —
//! `pe` читает с диска только заголовки и секцию с ресурсами, так что и
//! 444-мегабайтный `GenshinImpact.exe` даёт иконку так же, как маленький
//! лаунчер.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::config::Game;

/// Исполняемый файл, из которого берём иконку.
///
/// Источник картинки и способ запуска — вещи независимые, и это важно: игры из
/// Steam запускаются по номеру приложения и пути к файлу не имеют вовсе. Для
/// них картинка ищется в папке установки.
pub fn source_exe(game: &Game) -> Option<PathBuf> {
    if let Some(exe) = &game.exe_path {
        return Some(exe.clone());
    }
    let dir = game.install_path.as_deref()?;
    exe_in_root(dir, &game.title)
}

/// Файл в корне папки установки. **Только в корне, не вглубь**:
/// поиск вглубь находит игровой бинарник на сотни мегабайт, установщик античита
/// и служебные программы стороннего набора.
fn exe_in_root(dir: &Path, title: &str) -> Option<PathBuf> {
    let wanted = crate::catalog::normalize(title);
    let mut biggest: Option<(u64, PathBuf)> = None;

    for entry in std::fs::read_dir(dir).ok()? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
            != Some("exe".to_string())
        {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        if crate::catalog::normalize(stem) == wanted {
            return Some(path);
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if biggest.as_ref().is_none_or(|(b, _)| size > *b) {
            biggest = Some((size, path));
        }
    }
    biggest.map(|(_, p)| p)
}

/// Папка кеша иконок.
///
/// **Отдельно от кеша картинок хаба намеренно.** Тот чистится по возрасту при
/// каждом запуске (`images::evict`), и иконки оттуда постоянно вылетали бы и
/// добывались заново. Иконка не устаревает сама по себе — она устаревает
/// только вместе с файлом игры.
pub fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("нет папки кеша: {e}"))?
        .join("icons");
    std::fs::create_dir_all(&dir).map_err(|e| format!("не создать папку кеша иконок: {e}"))?;
    drop_cache_from_an_older_rule(&dir);
    Ok(dir)
}

/// Номер правила выбора картинки. Меняется вместе с самим правилом.
///
/// 3: исполняемые файлы крупнее 100 МБ раньше пропускались, и для них в кеше
/// остались метки «иконки нет» (`.miss`) — так было у Genshin Impact из
/// HoYoPlay (2026-10-02). Метка годна, пока файл игры не изменился, поэтому
/// без нового номера исправление до этих людей не дошло бы: иконки и метки,
/// сделанные при пропуске крупных файлов, нужно добыть заново, один раз.
const RULE: u32 = 3;

/// Выбрасывает иконки, добытые по прежнему правилу.
///
/// **Без этого исправление правила не дошло бы до человека.** Годность кеша
/// проверяется по дате исходного файла, а она у игры не менялась — значит
/// прежняя картинка считалась бы свежей вечно, и Wuthering Waves так и
/// показывала бы логотип движка. Метка с номером правила — признак того, что
/// лежащее в папке добыто тем же способом, каким добывали бы сейчас.
///
/// Своих картинок человека потеря не касается: они копии, и `own_icon`
/// положит их заново при первом же обращении.
fn drop_cache_from_an_older_rule(dir: &Path) {
    let marker = dir.join(format!("rule-{RULE}"));
    if marker.exists() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    if let Err(e) = std::fs::write(&marker, []) {
        log::warn!("[icons] не записать метку правила в кеш: {e}");
    }
}

/// Устойчивая свёртка пути. Пути содержат двоеточия и обратные косые, именем
/// файла они быть не могут.
fn hash_of(path: &Path) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash
}

/// Имя файла в кеше.
fn file_name_for(exe: &Path) -> String {
    format!("{:016x}.png", hash_of(exe))
}

/// Имя метки «иконки нет, и добывать заново незачем, пока файл не изменился».
///
/// Отдельное расширение, а не пустой `.png`: раздать интерфейсу путь к пустой
/// картинке значило бы показать сломанную картинку вместо буквы-заглушки —
/// `ensure` эту метку наружу не отдаёт, только проверяет её наличие.
fn miss_marker_for(exe: &Path) -> String {
    format!("{:016x}.miss", hash_of(exe))
}

/// Путь к иконке игры, добывая её при необходимости.
///
/// Своя картинка человека выигрывает у всего остального: это осознанный
/// выбор, и автоматика не имеет права его переписать. Только если её нет —
/// берём картинку из исполняемого файла.
///
/// **Возвращаемый путь всегда лежит в папке кеша, и это обязательно.** Окну
/// разрешено читать файлы только из перечисленных папок (`assetProtocol.scope`
/// в `tauri.conf.json`). Своя картинка человека лежит где угодно на диске, и
/// сослаться на неё напрямую нельзя — она просто не отобразилась бы, причём
/// молча. Поэтому её копия кладётся в кеш, а в конфиге хранится **исходный
/// путь**: он говорит, что человек выбрал, и переживает очистку кеша.
pub fn ensure(app: &AppHandle, game: &Game) -> Option<PathBuf> {
    let dir = cache_dir(app).ok()?;
    ensure_in(&dir, game)
}

/// Логика добычи без части, которой нужен `AppHandle`: готовая папка кеша
/// передаётся явным параметром — тот же приём, что у `own_icon` и `is_fresh`,
/// ради модульных тестов.
///
/// **Неудача тоже запоминается.** Без метки-«промаха» список игр читал бы
/// исполняемый файл заново при каждом обращении — при запуске, при возврате
/// из настроек, при каждой правке любой игры, — хотя ответ для того же файла
/// не изменится, пока он сам не изменится.
fn ensure_in(dir: &Path, game: &Game) -> Option<PathBuf> {
    if let Some(path) = own_icon(dir, game) {
        return Some(path);
    }

    let exe = source_exe(game)?;
    let cached = dir.join(file_name_for(&exe));
    let miss = dir.join(miss_marker_for(&exe));

    if is_fresh(&cached, &exe) {
        return Some(cached);
    }
    if is_fresh(&miss, &exe) {
        return None;
    }

    // Файл целиком не читается: `pe` берёт с диска заголовки и секцию с
    // ресурсами. Поэтому размер исполняемого файла не играет роли — раньше
    // файл крупнее потолка в 100 МБ отбрасывался, и у игры вроде Genshin
    // Impact (444 МБ, HoYoPlay) иконки не было вовсе.
    //
    // Картинки пробуются по очереди, начиная с самой крупной: первая, которую
    // удалось привести к PNG, и становится иконкой. Мелкие размеры лесенки
    // бывают в видах, которые `ico` не разбирает, и пропустить их — правильный
    // исход, а не отказ.
    let png = crate::pe::icon_candidates_in_file(&exe)
        .into_iter()
        .find_map(|picture| crate::ico::to_png(&picture));
    let Some(png) = png else {
        let _ = std::fs::write(&miss, []);
        return None;
    };
    if let Err(e) = std::fs::write(&cached, &png) {
        log::warn!("[icons] не записать иконку в кеш: {e}");
        return None;
    }
    Some(cached)
}

/// Своя картинка человека, скопированная в кеш — или `None`, если её нет,
/// файл на диске пропал, или копирование не удалось.
///
/// Имя копии в кеше зависит от **исходного пути**, а не от идентификатора
/// игры. Иначе смена картинки на файл старше уже лежащей копии заставила бы
/// проверку свежести посчитать копию свежей и молча отдать прежнюю
/// картинку — то самое, что этот выбор человека переписывать не имеет права.
/// Перенос общий с фонами (`localcopy`) — эта проверка уже когда-то
/// нарушалась именно здесь, и второй такой же перенос унаследовал бы ту же
/// ошибку.
fn own_icon(dir: &Path, game: &Game) -> Option<PathBuf> {
    let own = game.icon.as_ref()?;
    crate::localcopy::copy_into(dir, own, "custom-")
}

/// Кеш годен, если он не старше исходного файла. Игра обновилась — файл
/// переписан, иконка добывается заново.
fn is_fresh(cached: &Path, exe: &Path) -> bool {
    let Ok(cached_time) = std::fs::metadata(cached).and_then(|m| m.modified()) else {
        return false;
    };
    let Ok(exe_time) = std::fs::metadata(exe).and_then(|m| m.modified()) else {
        return false;
    };
    cached_time >= exe_time
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Game, Launch};

    fn steam_game(install: Option<&str>) -> Game {
        Game {
            id: "wuthering".into(),
            title: "Wuthering Waves".into(),
            content_id: None,
            launch: Launch::Steam { appid: 3513350 },
            install_path: install.map(PathBuf::from),
            exe_path: None,
            args: String::new(),
            background: None,
            icon: None,
            video: None,
        }
    }

    #[test]
    fn a_game_with_its_own_exe_uses_that_exe() {
        let mut g = steam_game(None);
        g.exe_path = Some(PathBuf::from(r"C:\Games\Genshin\launcher.exe"));
        assert_eq!(source_exe(&g), Some(PathBuf::from(r"C:\Games\Genshin\launcher.exe")));
    }

    #[test]
    fn a_game_without_an_exe_and_without_a_folder_has_no_source() {
        assert_eq!(source_exe(&steam_game(None)), None);
    }

    #[test]
    fn a_matching_name_wins_over_a_bigger_file() {
        // В корне побеждает файл, чьё имя совпадает с названием игры, а не
        // самый крупный.
        let dir = tempdir("matching-name-wins");
        write(&dir, "Wuthering Waves.exe", 1_000);
        write(&dir, "Redist.exe", 50_000);
        let g = steam_game(Some(dir.to_str().unwrap()));
        assert_eq!(source_exe(&g), Some(dir.join("Wuthering Waves.exe")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn without_a_matching_name_the_biggest_file_wins() {
        let dir = tempdir("biggest-file-wins");
        write(&dir, "aaa.exe", 1_000);
        write(&dir, "bbb.exe", 50_000);
        let g = steam_game(Some(dir.to_str().unwrap()));
        assert_eq!(source_exe(&g), Some(dir.join("bbb.exe")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_search_does_not_go_deeper_than_the_root() {
        // Вглубь искать нельзя: в папке Wuthering Waves так находится
        // Client-Win64-Shipping.exe на 930 МБ, установщик античита и
        // служебные программы стороннего набора.
        let dir = tempdir("no-deeper-than-root");
        std::fs::create_dir_all(dir.join("Binaries")).unwrap();
        write(&dir.join("Binaries"), "Client-Win64-Shipping.exe", 900_000);
        let g = steam_game(Some(dir.to_str().unwrap()));
        assert_eq!(source_exe(&g), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_folder_without_executables_has_no_source() {
        let dir = tempdir("no-executables");
        write(&dir, "readme.txt", 10);
        let g = steam_game(Some(dir.to_str().unwrap()));
        assert_eq!(source_exe(&g), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_custom_icon_that_exists_is_copied_into_the_cache() {
        // Своя картинка человека выигрывает у всего остального, но окну
        // разрешено читать файлы только из папки кеша — сослаться на исходный
        // файл напрямую нельзя, поэтому путь должен указывать внутрь кеша, а не
        // совпадать с исходным.
        let cache = tempdir("custom-icon-cache");
        let own_dir = tempdir("custom-icon-own");
        write(&own_dir, "art.png", 42);
        let own = own_dir.join("art.png");

        let mut g = steam_game(None);
        g.icon = Some(own.clone());

        let result = own_icon(&cache, &g).expect("своя картинка должна победить");
        assert_ne!(result, own, "путь должен указывать в кеш, а не на исходный файл");
        assert!(result.starts_with(&cache));
        assert!(result.is_file());
        std::fs::remove_dir_all(&cache).ok();
        std::fs::remove_dir_all(&own_dir).ok();
    }

    #[test]
    fn a_missing_custom_icon_falls_back_to_none() {
        let cache = tempdir("missing-custom-icon");
        let mut g = steam_game(None);
        g.icon = Some(PathBuf::from(r"C:\nope\never\icon.png"));
        assert_eq!(own_icon(&cache, &g), None);
        std::fs::remove_dir_all(&cache).ok();
    }

    #[test]
    fn switching_the_custom_icon_to_an_older_file_still_gets_copied() {
        // Покрывает ветку "уже закешировано" — и именно там прячется дефект:
        // если копия кешируется по идентификатору игры, а не по исходному
        // пути, смена картинки на файл старше уже лежащей копии заставляет
        // is_fresh считать копию свежей и молча отдавать прежнюю картинку.
        // Обычный случай: человек возвращается к файлу, который скачал
        // давно, — и это ровно то, что "автоматика не имеет права
        // переписать".
        let cache = tempdir("switching-custom-icon-cache");
        let own_dir = tempdir("switching-custom-icon-own");

        // "b" старше "a": обычный случай — файл скачан раньше.
        write(&own_dir, "b.png", 2);
        let b = own_dir.join("b.png");
        let long_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        filetime::set_file_mtime(&b, filetime::FileTime::from_system_time(long_ago)).unwrap();

        write(&own_dir, "a.png", 1);
        let a = own_dir.join("a.png");

        let mut g = steam_game(None);
        g.icon = Some(a.clone());
        let first = own_icon(&cache, &g).expect("должно скопировать a");
        let first_len = std::fs::metadata(&first).unwrap().len();

        // Человек выбирает другой файл — b, который старше уже лежащей копии.
        g.icon = Some(b.clone());
        let second =
            own_icon(&cache, &g).expect("должно скопировать b, а не отдать старую копию a");
        let second_len = std::fs::metadata(&second).unwrap().len();

        assert_ne!(second_len, first_len, "должно вернуться содержимое b, а не кеш от a");
        std::fs::remove_dir_all(&cache).ok();
        std::fs::remove_dir_all(&own_dir).ok();
    }

    #[test]
    fn a_failed_extraction_leaves_a_marker_so_the_result_is_remembered() {
        // До этой правки неудача ничего не оставляла в кеше, и список игр
        // читал файл заново при каждом обращении — при запуске, при
        // возврате из настроек, при каждой правке любой игры.
        let cache = tempdir("miss-marker-cache");
        let exe_dir = tempdir("miss-marker-exe");
        write(&exe_dir, "game.exe", 16); // заведомо не PE-файл
        let exe = exe_dir.join("game.exe");

        let mut g = steam_game(None);
        g.exe_path = Some(exe.clone());

        assert_eq!(ensure_in(&cache, &g), None, "случайные байты — не PE, иконки нет");

        let left: Vec<_> = std::fs::read_dir(&cache).unwrap().flatten().collect();
        assert_eq!(
            left.len(),
            1,
            "неудача обязана оставить метку в кеше, а не ничего"
        );
        assert!(
            left[0].path().extension().and_then(|e| e.to_str()) == Some("miss"),
            "метка должна отличаться от файла иконки расширением"
        );

        // Тот же файл, тот же результат — метка не мешает повторному вызову
        // отвечать так же честно.
        assert_eq!(ensure_in(&cache, &g), None);

        std::fs::remove_dir_all(&cache).ok();
        std::fs::remove_dir_all(&exe_dir).ok();
    }

    fn tempdir(tag: &str) -> PathBuf {
        // Имя — от идентификатора процесса, а не от наносекундной метки
        // времени: так же, как в `images.rs` и `hub/mod.rs`. Один запуск
        // тестов — одна папка на тег, и она удаляется явно в конце каждого
        // теста (см. `remove_dir_all` выше), а не копится в системной
        // временной папке до следующей перезагрузки.
        let p = std::env::temp_dir().join(format!("gh-icons-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn write(dir: &Path, name: &str, size: usize) {
        std::fs::write(dir.join(name), vec![0u8; size]).unwrap();
    }
}
