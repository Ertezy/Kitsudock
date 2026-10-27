//! Кеш картинок: арт баннеров и превью роликов.
//!
//! Качает Rust, интерфейсу отдаётся путь к локальному файлу. Иначе пришлось бы
//! разрешить странице ходить в интернет, а политика содержимого это запрещает.
//!
//! Адреса приходят из файла хаба, то есть извне. Отсюда три правила, каждое
//! проверено тестом: имя файла выводится хешем, а не из адреса; схема
//! проверяется перед запросом; потолок размера соблюдается при чтении, а не по
//! заголовку.
//!
//! Скачивание общее: `fetch` кладёт картинки хаба в свою папку, а картинки
//! Epic идут через `fetch_into` в папку фонов со своим потолком (`art.rs`).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

use crate::hub::is_safe_https;

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// Самая медленная скорость, с которой ещё ждём большой файл: 256 КиБ/с.
/// Тридцатимегабайтное видео при ней качается две минуты, а не обрывается.
const MIN_RATE: u64 = 256 * 1024;

/// Срок на запрос вместе с чтением тела (ureq считает их одним сроком).
///
/// Картинки с потолком до `MAX_IMAGE_BYTES` укладываются в `FETCH_TIMEOUT`,
/// как раньше. Для большего потолка срок растёт вместе с ним: десять секунд на
/// ролик в 15 МБ требуют 1,5 МБ/с, и на обычном канале он не скачивался бы
/// никогда, а адрес до перезапуска попадал бы в список опробованных.
fn deadline_for(max_bytes: u64) -> Duration {
    if max_bytes <= MAX_IMAGE_BYTES {
        return FETCH_TIMEOUT;
    }
    Duration::from_secs(max_bytes / MIN_RATE).max(FETCH_TIMEOUT)
}

/// Пять мегабайт: уменьшенный арт весит десятки килобайт, всё крупнее —
/// либо ошибка сборщика, либо попытка занять нам диск.
pub const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

/// Правда, если прочитанное тело не влезло в потолок размера.
///
/// Вынесена отдельно от `fetch`, потому что именно в этой границе легко
/// ошибиться на один байт: `fetch` читает `max + 1` байт и проверяет
/// результат этой функции, а не наоборот. Сетевой части `fetch` тест не
/// нужен — граница проверяется здесь напрямую, без сервера.
fn exceeds_ceiling(len: usize, max: u64) -> bool {
    len as u64 > max
}

/// Картинка, к которой не обращались столько, удаляется при следующем запуске.
/// Баннеры меняются каждые три недели, ролики каждый день; без уборки папка
/// за год превращается в свалку.
pub const MAX_AGE: Duration = Duration::from_secs(30 * 86400);

/// Расширение по типу содержимого, а не по адресу: адрес недоверенный, и
/// `.png` в конце ничего не доказывает. Неизвестный тип получает `bin`,
/// чтобы в кеше не оказалось ничего, что оболочка сочтёт исполняемым.
fn ext_for(content_type: &str) -> &'static str {
    let base = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match base.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/webm" => "webm",
        "video/mp4" => "mp4",
        _ => "bin",
    }
}

/// Расширение из адреса, если сервер не назвал тип: только знакомые.
fn ext_from_url(url: &str) -> Option<&'static str> {
    let path = url.split(['?', '#']).next()?;
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    ["png", "jpg", "webp", "gif", "webm", "mp4"]
        .into_iter()
        .find(|known| *known == ext)
        .or((ext == "jpeg").then_some("jpg"))
}

/// Имя файла в кеше: шестнадцатеричный хеш адреса плюс расширение.
///
/// Из адреса не берётся ни один символ. Это единственное, что защищает от
/// адреса вроде `https://ho.st/../../../evil.png`: собери мы имя из пути,
/// такой адрес записал бы файл за пределы папки кеша.
pub(crate) fn file_name_for(url: &str, ext: &str) -> String {
    // FNV-1a, 64 бита. Криптостойкость тут не нужна: задача не в защите от
    // подбора, а в том, чтобы имя не содержало ничего из адреса.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in url.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{h:016x}.{ext}")
}

/// Основа имени файла в кеше — хеш адреса без расширения. По ней узнаётся,
/// чей это файл, при уборке устаревших (launcher_art.rs).
pub(crate) fn cache_stem(url: &str) -> String {
    let name = file_name_for(url, "");
    name.trim_end_matches('.').to_string()
}

pub fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir: {e}"))?
        .join("images");
    fs::create_dir_all(&dir).map_err(|e| format!("не удалось создать папку кеша: {e}"))?;
    Ok(dir)
}

/// Путь к картинке в кеше хаба; скачивает, если её там нет.
pub fn fetch(app: &AppHandle, url: &str) -> Result<PathBuf, String> {
    fetch_into(&cache_dir(app)?, url, MAX_IMAGE_BYTES)
}

/// Уже скачанная картинка по этому адресу в папке `dir`, без обращения к сети.
pub fn cached(dir: &Path, url: &str) -> Option<PathBuf> {
    // Один адрес может прийти под разными типами содержимого (перенастройка
    // CDN, смена картинки на той стороне), и тогда в кеше окажутся файлы с
    // одним хешем и разными расширениями. Берём самый свежий, лишние удаляем:
    // фиксированный порядок списка отдавал бы устаревший файл до самой уборки.
    let mut found: Vec<(SystemTime, PathBuf)> = Vec::new();
    for ext in ["png", "jpg", "webp", "gif", "webm", "mp4", "bin"] {
        let candidate = dir.join(file_name_for(url, ext));
        if let Ok(meta) = fs::metadata(&candidate) {
            if meta.is_file() {
                found.push((meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), candidate));
            }
        }
    }
    if found.is_empty() {
        return None;
    }
    found.sort_by_key(|(t, _)| *t);
    let (_, newest) = found.pop().expect("проверено на непустоту");
    for (_, stale) in found {
        let _ = fs::remove_file(stale);
    }
    // Отодвигает файл в конец очереди на уборку.
    let _ = touch(&newest);
    Some(newest)
}

/// Скачивает картинку в папку `dir`, если её там ещё нет.
///
/// Общая для кеша картинок хаба и картинок магазина: два способа безопасно
/// качать неизбежно разошлись бы, и один из них однажды потерял бы проверку,
/// которую держит другой.
pub fn fetch_into(dir: &Path, url: &str, max_bytes: u64) -> Result<PathBuf, String> {
    if !is_safe_https(url) {
        return Err(format!("отказываюсь качать не-https адрес: {url}"));
    }
    if let Some(hit) = cached(dir, url) {
        return Ok(hit);
    }

    // Редиректов не больше двух и только внутри https.
    //
    // `.redirects(N)` пропускает N-1 переходов (ureq считает
    // `history.len() + 1 >= redirects`), поэтому для двух ставим 3.
    // `https_only` обязателен отдельно: без него сервер, до которого мы дошли
    // по https, уводит редиректом на http, и ureq послушно идёт — адрес
    // приходит из недоверенного файла, проверять его один раз мало.
    let resp = ureq::builder()
        .redirects(3)
        .https_only(true)
        .build()
        .get(url)
        .timeout(deadline_for(max_bytes))
        .call()
        .map_err(|e| format!("не удалось скачать {url}: {e}"))?;

    // Часть CDN отвечает `application/octet-stream`: тогда берём расширение из
    // адреса, но только знакомое, всё остальное по-прежнему становится `bin`.
    let ext = match ext_for(resp.header("Content-Type").unwrap_or("")) {
        "bin" => ext_from_url(url).unwrap_or("bin"),
        known => known,
    };

    // Читаем на байт больше потолка: если он прочитался, ответ не влез,
    // и записывать обрезок нельзя — он не раскодируется никогда, а цикл
    // повторного использования выше проверяет только наличие файла, так что
    // испорченный кеш сам не вылечится.
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("не удалось прочитать {url}: {e}"))?;
    if exceeds_ceiling(bytes.len(), max_bytes) {
        return Err(format!("картинка больше {max_bytes} байт: {url}"));
    }

    let path = dir.join(file_name_for(url, ext));
    // Проверка после сборки пути, а не до: убеждаемся в свойстве результата.
    if !path.starts_with(&dir) {
        return Err("путь вышел за пределы кеша".to_string());
    }
    write_atomic(&path, &bytes)?;
    Ok(path)
}

/// Записывает файл целиком или не записывает вовсе.
///
/// `cached` считает любой файл под итоговым именем готовым и повторно его не
/// качает. Запись прямо в него оставила бы обрывок (сбой, закрытое окно,
/// список игр, построенный посреди докачки ролика) в роли скачанного файла
/// навсегда. Поэтому пишем рядом в `<имя>.part` и переименовываем: итоговое
/// имя появляется, только когда файл целый. Неудавшийся `.part` убирается.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut part = path.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let written = fs::write(&part, bytes)
        .map_err(|e| format!("не удалось записать {}: {e}", part.display()))
        .and_then(|()| {
            fs::rename(&part, path)
                .map_err(|e| format!("не удалось положить {} на место: {e}", path.display()))
        });
    if written.is_err() {
        let _ = fs::remove_file(&part);
    }
    written
}

/// Отодвигает метку изменения файла на «сейчас».
///
/// Используется именно метка изменения, а не доступа: на Windows обновление
/// времени доступа отключено по умолчанию (`NtfsDisableLastAccessUpdate`),
/// поэтому чтение файла его метку не двигает, и уборка удаляла бы картинки,
/// которые человек видит каждый день. Метку изменения мы ставим сами при
/// каждом попадании в кеш, и она надёжна на любой машине.
fn touch(path: &Path) -> std::io::Result<()> {
    let f = fs::OpenOptions::new().write(true).open(path)?;
    f.set_times(fs::FileTimes::new().set_modified(SystemTime::now()))?;
    Ok(())
}

/// Удаляет из папки файлы, к которым не обращались дольше `max_age`.
/// Возвращает количество удалённых.
pub fn evict(dir: &Path, max_age: Duration) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let now = SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Ok(stamp) = meta.modified() else { continue };
        if now.duration_since(stamp).unwrap_or_default() > max_age
            && fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("gh-images-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn a_cached_picture_is_returned_without_the_network() {
        // Адрес на несуществующем домене: если бы функция пошла в сеть, тест
        // упал бы по таймауту или ошибке, а не вернул файл.
        let dir = scratch("hit");
        let url = "https://example.invalid/art.jpg";
        let file = dir.join(file_name_for(url, "jpg"));
        std::fs::write(&file, b"jpg").unwrap();
        assert_eq!(fetch_into(&dir, url, MAX_IMAGE_BYTES), Ok(file));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_non_https_address_is_refused_even_when_a_file_is_cached() {
        let dir = scratch("http");
        let url = "http://example.invalid/art.jpg";
        std::fs::write(dir.join(file_name_for(url, "jpg")), b"jpg").unwrap();
        assert!(fetch_into(&dir, url, MAX_IMAGE_BYTES).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_cached_means_none() {
        let dir = scratch("miss");
        assert_eq!(cached(&dir, "https://example.invalid/none.jpg"), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_same_url_always_gets_the_same_name() {
        let a = file_name_for("https://example.test/art.png", "png");
        let b = file_name_for("https://example.test/art.png", "png");
        assert_eq!(a, b);
    }

    #[test]
    fn different_urls_get_different_names() {
        let a = file_name_for("https://example.test/a.png", "png");
        let b = file_name_for("https://example.test/b.png", "png");
        assert_ne!(a, b);
    }

    #[test]
    fn the_name_never_carries_anything_from_the_url_path() {
        // Имя выводится хешем, а не из адреса: адрес приходит из недоверенного
        // файла, и подготовленная строка записала бы файл за пределы кеша.
        let name = file_name_for("https://example.test/../../../../Windows/evil.png", "png");
        assert!(!name.contains(".."), "имя не должно содержать переход вверх: {name}");
        assert!(!name.contains('/'), "имя не должно содержать разделитель: {name}");
        assert!(!name.contains('\\'), "имя не должно содержать разделитель: {name}");
        assert!(!name.contains("Windows"), "имя не должно нести путь: {name}");
        assert!(name.ends_with(".png"));
    }

    #[test]
    fn the_name_is_hex_plus_extension() {
        let name = file_name_for("https://example.test/a.png", "png");
        let stem = name.strip_suffix(".png").unwrap();
        assert!(stem.chars().all(|c| c.is_ascii_hexdigit()), "не шестнадцатеричное: {stem}");
        assert!(!stem.is_empty());
    }

    #[test]
    fn extension_comes_from_the_content_type_not_the_url() {
        assert_eq!(ext_for("image/png"), "png");
        assert_eq!(ext_for("image/jpeg"), "jpg");
        assert_eq!(ext_for("image/webp"), "webp");
        assert_eq!(ext_for("image/png; charset=binary"), "png");
        assert_eq!(ext_for("IMAGE/PNG"), "png");
    }

    #[test]
    fn an_unknown_content_type_is_not_cached_as_something_executable() {
        assert_eq!(ext_for("text/html"), "bin");
        assert_eq!(ext_for("application/octet-stream"), "bin");
        assert_eq!(ext_for(""), "bin");
    }

    #[test]
    fn the_built_path_stays_inside_the_cache_directory() {
        let dir = std::path::Path::new(r"C:\cache");
        let p = dir.join(file_name_for("https://example.test/../../evil.png", "png"));
        assert!(p.starts_with(dir), "путь ушёл из кеша: {}", p.display());
    }

    #[test]
    fn a_body_exactly_at_the_ceiling_is_accepted() {
        // Проверяет ровно ту границу, на которой легко ошибиться на один
        // байт: `fetch` читает `MAX_IMAGE_BYTES + 1` байт и передаёт длину
        // сюда, а не наоборот. Тело точно в потолок обязано пройти.
        assert!(!exceeds_ceiling(MAX_IMAGE_BYTES as usize, MAX_IMAGE_BYTES));
    }

    #[test]
    fn a_body_one_byte_over_the_ceiling_is_rejected() {
        // Ответ длиннее потолка ровно на один байт — то самое значение,
        // которое получилось бы прочитать `.take(MAX_IMAGE_BYTES + 1)`,
        // если сервер прислал больше положенного.
        assert!(exceeds_ceiling(MAX_IMAGE_BYTES as usize + 1, MAX_IMAGE_BYTES));
    }

    #[test]
    fn eviction_removes_only_what_is_older_than_the_limit() {
        let dir = std::env::temp_dir().join(format!("gh-evict-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.png");
        let fresh = dir.join("fresh.png");
        std::fs::write(&old, b"x").unwrap();
        std::fs::write(&fresh, b"y").unwrap();

        // Метка у старого отодвигается на 40 дней назад.
        let long_ago = std::time::SystemTime::now() - Duration::from_secs(40 * 86400);
        filetime::set_file_mtime(&old, filetime::FileTime::from_system_time(long_ago)).unwrap();

        let removed = evict(&dir, Duration::from_secs(30 * 86400));
        assert_eq!(removed, 1);
        assert!(!old.exists());
        assert!(fresh.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn video_types_get_their_own_extension() {
        assert_eq!(ext_for("video/webm"), "webm");
        assert_eq!(ext_for("video/mp4; codecs=avc1"), "mp4");
    }

    #[test]
    fn a_cached_video_is_found_like_a_picture() {
        let dir = std::env::temp_dir().join(format!("images-video-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let url = "https://cdn.example.test/bg/a.webm";
        let file = dir.join(file_name_for(url, "webm"));
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(cached(&dir, url), Some(file));
        assert_eq!(cache_stem(url), file_name_for(url, "webm").trim_end_matches(".webm"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_small_ceiling_keeps_the_short_deadline() {
        assert_eq!(deadline_for(MAX_IMAGE_BYTES), Duration::from_secs(10));
        assert_eq!(deadline_for(1024), Duration::from_secs(10));
    }

    #[test]
    fn a_big_ceiling_gets_a_deadline_that_fits_the_slowest_rate() {
        // 60 МиБ при 256 КиБ/с — 240 секунд.
        assert_eq!(deadline_for(60 * 1024 * 1024), Duration::from_secs(240));
        assert!(deadline_for(MAX_IMAGE_BYTES + 1) >= FETCH_TIMEOUT);
    }

    #[test]
    fn an_atomic_write_leaves_the_file_and_no_part_file() {
        let dir = scratch("atomic");
        let path = dir.join("a.webm");
        write_atomic(&path, b"video").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"video");
        assert!(!dir.join("a.webm.part").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_failed_atomic_write_leaves_no_part_file() {
        let dir = scratch("atomic-fail");
        // На месте итогового файла каталог: переименование в него не удастся.
        let path = dir.join("a.webm");
        std::fs::create_dir_all(&path).unwrap();
        assert!(write_atomic(&path, b"video").is_err());
        assert!(!dir.join("a.webm.part").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unfinished_part_file_is_not_a_cached_picture() {
        let dir = scratch("part");
        let url = "https://cdn.example.test/bg/a.webm";
        std::fs::write(dir.join(format!("{}.part", file_name_for(url, "webm"))), b"half").unwrap();
        assert_eq!(cached(&dir, url), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_extension_is_taken_from_the_address_only_when_it_is_a_known_one() {
        assert_eq!(ext_from_url("https://x.test/a.WEBM?x=1"), Some("webm"));
        assert_eq!(ext_from_url("https://x.test/a.jpeg"), Some("jpg"));
        assert_eq!(ext_from_url("https://x.test/a"), None);
    }
}
