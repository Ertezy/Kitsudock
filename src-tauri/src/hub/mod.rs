//! Данные хаба: где их взять и в каком порядке.
//!
//! Источники по убыванию приоритета:
//!   1. удалённый файл по `hubUrl`, а если поле пустое — по адресу сборщика
//!      (только https, 5 с, редиректы запрещены); результат кешируется в
//!      `%APPDATA%\<id>\hub_cache.json`, метка версии — в `hub_cache.meta.json`;
//!   2. `%APPDATA%\<id>\hub.json` — ручная подмена без пересборки;
//!   3. `%APPDATA%\<id>\hub_cache.json` — последняя удачная загрузка;
//!   4. `resources/hub.json` из комплекта.
//!
//! Схема живёт в `schema.rs`; здесь только доставка.

pub mod schema;

// Плоский реэкспорт — только то, что называют по имени за пределами модуля
// (не считая тестов, которым виден весь крейт и которые обращаются к
// остальным типам схемы через полный путь `hub::schema::…`): `HubData`
// возвращает команда `get_hub`, `HubGame` собирает `catalog` при
// сопоставлении установленного с каталогом хаба.
pub use schema::{HubData, HubGame};

use std::fs;
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Manager};

const REMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Не больше двух мегабайт: файл хаба — текст, всё крупнее либо ошибка,
/// либо попытка занять нам память.
const MAX_HUB_BYTES: usize = 2 * 1024 * 1024;

/// Файл, который выкладывает сборщик (спека сборщика §9). Пустое поле адреса
/// в настройках означает именно его; вписанный адрес побеждает.
pub const DEFAULT_HUB_URL: &str = "https://ertezy.github.io/Kitsudock-data/hub.json";

pub fn effective_url(hub_url: Option<&str>) -> &str {
    match hub_url {
        Some(url) if !url.trim().is_empty() => url,
        _ => DEFAULT_HUB_URL,
    }
}

/// Формат кеша: меняется при любой правке `HubData`/`Video`, из-за которой
/// уже записанный кеш перестаёт годиться как есть. Сборка, не знавшая об этом
/// поле (до появления `lang` у видео), пишет метку без него — при разборе оно
/// читается как 0 и не совпадает с текущим значением, поэтому `etag_for`
/// такую метку отдаёт как несуществующую.
///
/// 3 — у `HubGame` появилось поле `background` (официальные фоны лаунчера,
/// 2026-10-02). Версия 0.1.0 записала в кеш новый файл хаба без этого поля вместе
/// с его ETag, и ответ 304 оставил бы урезанную копию навсегда, поэтому кеш
/// нужно один раз скачать заново.
const CACHE_FORMAT: u32 = 3;

/// Метка версии последнего удачного ответа и адрес, для которого она получена.
#[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct CacheMeta {
    url: String,
    etag: Option<String>,
    /// Отсутствует в файле — читается как 0, что не равно `CACHE_FORMAT`.
    #[serde(default)]
    format: u32,
}

fn read_meta(path: &Path) -> Option<CacheMeta> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn write_meta(path: &Path, meta: &CacheMeta) {
    if let Ok(json) = serde_json::to_string(meta) {
        let _ = fs::write(path, json);
    }
}

/// Метка отправляется только тому адресу, от которого пришла, и только если
/// кеш записан текущим форматом: после смены адреса в настройках чужая метка
/// дала бы ложное «не изменилось», а метка от старого формата означает кеш
/// без полей, которые умеет читать нынешняя сборка (например, без `lang` у
/// видео) — его нельзя молча выдавать за актуальный.
fn etag_for<'a>(meta: Option<&'a CacheMeta>, url: &str) -> Option<&'a str> {
    meta.filter(|m| m.url == url && m.format == CACHE_FORMAT)
        .and_then(|m| m.etag.as_deref())
}

/// Пишет свежий ответ в кеш и, только если это удалось, — метку версии рядом.
///
/// Порядок обязателен, а не для красоты: если кеш не записался (антивирус
/// на Windows временно держит файл, sharing violation), а метка всё равно
/// обновится, старое содержимое `hub_cache.json` останется лежать под НОВОЙ
/// меткой. Дальше сервер честно отвечает 304 на эту метку, и устаревший кеш
/// тихо выдаётся с источником `remote`, пока файл у сборщика не поменяется
/// снова — это может быть и через несколько дней. Не записали кеш — метку
/// не трогаем: старые кеш и метка остаются согласованной парой, а частично
/// записанный или отсутствующий кеш `read_json_file` прочитает как `None`,
/// что `decide` при следующем 304 превратит в повторный запрос без метки.
fn store_fresh(cache_path: &Path, meta_path: &Path, url: &str, data: &HubData, etag: Option<String>) {
    let Ok(json) = serde_json::to_string_pretty(data) else {
        return;
    };
    if fs::write(cache_path, json).is_err() {
        return;
    }
    write_meta(meta_path, &CacheMeta { url: url.to_string(), etag, format: CACHE_FORMAT });
}

enum Remote {
    // Данные в `Box`: без него вариант раздувает весь enum (clippy::large_enum_variant),
    // а `Remote` живёт ровно до `decide`, так что лишняя аллокация ничего не стоит.
    Fresh { data: Box<HubData>, etag: Option<String> },
    NotModified,
    Failed,
}

enum Outcome {
    UseFresh(HubData, Option<String>),
    UseCache(HubData),
    Refetch,
    Fallback,
}

/// Что делать с ответом сервера. Чистая функция: сеть и файлы — снаружи.
fn decide(remote: Remote, cached: Option<HubData>) -> Outcome {
    match remote {
        Remote::Fresh { data, etag } => Outcome::UseFresh(*data, etag),
        Remote::NotModified => match cached {
            Some(data) => Outcome::UseCache(data),
            None => Outcome::Refetch,
        },
        Remote::Failed => Outcome::Fallback,
    }
}

/// Годится ли адрес для запроса из приложения.
///
/// Проверяется на месте перед каждым запросом, а не подразумевается: адреса
/// приходят из недоверенного файла (спека §8.1), и `file://` прочитал бы
/// с диска человека всё, на что укажут.
pub fn is_safe_https(url: &str) -> bool {
    // Схема нечувствительна к регистру по RFC 3986, остальное — нет.
    // Ведущие пробелы не обрезаются: адрес с ними — уже подозрительный.
    //
    // Сравнение идёт по БАЙТАМ, а не срезом строки. `url[..8]` на строке,
    // где восьмой байт попадает внутрь многобайтового символа, не вернёт
    // false, а вызовет панику: «https:/日本» — опечатка в один слеш плюс
    // неASCII-хост — роняет приложение. Адреса приходят из недоверенного
    // файла, так что вход не гипотетический.
    let Some(head) = url.as_bytes().get(..8) else {
        return false;
    };
    if !head.eq_ignore_ascii_case(b"https://") {
        return false;
    }
    // После схемы обязан быть хотя бы один символ хоста: «https:///путь»
    // иначе проходит воротами насквозь.
    url.as_bytes().get(8).is_some_and(|c| *c != b'/')
}

/// Правда, если прочитанный текст не влез в потолок размера.
///
/// Вынесена отдельно, как и `images::exceeds_ceiling`: читаем `MAX_HUB_BYTES
/// + 1` байт и проверяем результат этой функции, а не наоборот — тогда
/// граница проверяется без файла размером в потолок на диске у теста.
fn exceeds_hub_ceiling(len: usize) -> bool {
    len as u64 > MAX_HUB_BYTES as u64
}

/// Читает текст файла хаба, но не больше потолка размера.
///
/// Потолок тот же, что и у сетевой загрузки: это те же данные, разница только
/// в источнике. Без потолка человек, подменивший `hub.json` огромным файлом
/// (случайно или нет), заставил бы приложение вычитывать его целиком в память
/// при каждом запуске; то же верно и для файла из комплекта.
fn read_capped(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let mut text = String::new();
    file.take(MAX_HUB_BYTES as u64 + 1)
        .read_to_string(&mut text)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if exceeds_hub_ceiling(text.len()) {
        log::error!(
            "[hub] {} больше потолка в {MAX_HUB_BYTES} байт, файл пропущен",
            path.display()
        );
        return Err(format!("{} больше потолка в {MAX_HUB_BYTES} байт", path.display()));
    }
    Ok(text)
}

/// Читает и разбирает местный файл хаба (`hub.json`, `hub_cache.json`).
/// Файл, которого нет, не читается, слишком велик или не разбирается (в том
/// числе из-за времени вне диапазона), — `None`.
fn read_json_file(path: &Path) -> Option<HubData> {
    serde_json::from_str(&read_capped(path).ok()?).ok()
}

/// Блокирующая загрузка по https с коротким таймаутом и условным заголовком.
/// Редиректы запрещены: иначе ответ https-адреса мог бы увести нас на http.
/// ureq при `redirects(0)` отдаёт 3xx, в том числе 304, как обычный ответ.
fn fetch_remote(url: &str, etag: Option<&str>) -> Remote {
    if !is_safe_https(url) {
        return Remote::Failed;
    }
    let mut request = ureq::builder().redirects(0).build().get(url).timeout(REMOTE_TIMEOUT);
    if let Some(tag) = etag {
        request = request.set("If-None-Match", tag);
    }
    let Ok(resp) = request.call() else {
        return Remote::Failed;
    };
    if resp.status() == 304 {
        return Remote::NotModified;
    }
    if resp.status() != 200 {
        return Remote::Failed;
    }
    let tag = resp.header("etag").map(str::to_string);
    let mut body = String::new();
    // Потолок соблюдается при чтении: Content-Length пишет отправитель.
    if resp.into_reader().take(MAX_HUB_BYTES as u64).read_to_string(&mut body).is_err() {
        return Remote::Failed;
    }
    remote_from_body(&body, tag)
}

/// Скачанное тело ответа: годный файл — свежие данные, любой негодный
/// (не JSON, время вне диапазона) — `Failed`. Вынесена из `fetch_remote`,
/// чтобы это правило проверялось без сети.
fn remote_from_body(body: &str, etag: Option<String>) -> Remote {
    match serde_json::from_str(body) {
        Ok(data) => Remote::Fresh { data: Box::new(data), etag },
        Err(_) => Remote::Failed,
    }
}

/// Файл хаба из комплекта: тот же потолок размера и тот же разбор, что и у
/// скачанного. Путь параметром, чтобы проверять без `AppHandle`.
fn read_bundled(path: &Path) -> Result<HubData, String> {
    let text = read_capped(path)?;
    let mut data: HubData =
        serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))?;
    data.source = Some("bundled".to_string());
    Ok(data)
}

fn bundled(app: &AppHandle) -> Result<HubData, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?;
    read_bundled(&dir.join("resources/hub.json"))
}

/// Местная цепочка без сети: сначала `override_path` (ручная подмена),
/// затем `cache_path` (последняя удачная загрузка). `None` — ни один файл не
/// прочитался, и вызывающему коду пора переходить на встроенный запасной
/// вариант.
///
/// Не берёт `AppHandle` и не решает, что делать при `None` — вынесена именно
/// поэтому: обе стороны цепочки, зависящие от `AppHandle` (сборка путей,
/// встроенный файл из комплекта), проверить обычным тестом нельзя, а саму
/// логику выбора источника — можно, на временных файлах.
fn read_local_chain(override_path: &Path, cache_path: &Path) -> Option<HubData> {
    for (path, label) in [(override_path, "override"), (cache_path, "cache")] {
        if let Some(mut data) = read_json_file(path) {
            data.source = Some(label.to_string());
            return Some(data);
        }
    }
    None
}

/// Данные хаба без единого сетевого запроса.
///
/// Нужна в `setup()`: каталог для сопоставления игр лежит в этом же файле, а
/// `setup()` выполняется до появления окна. Сетевой запрос оттуда заставил бы
/// окно ждать сеть там, где сейчас оно не ждёт.
pub fn load_local(app: &AppHandle) -> HubData {
    if let Ok(cfg_dir) = app.path().app_config_dir() {
        let override_path = cfg_dir.join("hub.json");
        let cache_path = cfg_dir.join("hub_cache.json");
        if let Some(data) = read_local_chain(&override_path, &cache_path) {
            return data;
        }
    }
    match bundled(app) {
        Ok(data) => data,
        Err(e) => {
            // Именно этот отказ оставляет каталог пустым на первом запуске.
            // Поведение не меняем — setup() не имеет права провалиться, — но
            // причина обязана быть видна, иначе следующий такой случай снова
            // будет выглядеть как «панель почему-то пустая».
            log::error!("[hub] не удалось прочитать файл из комплекта: {e}");
            HubData::default()
        }
    }
}

/// Данные хаба по полной цепочке источников (см. описание модуля).
pub fn load(app: &AppHandle, hub_url: Option<&str>) -> Result<HubData, String> {
    let cfg_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir: {e}"))?;
    let cache_path = cfg_dir.join("hub_cache.json");
    let meta_path = cfg_dir.join("hub_cache.meta.json");
    let override_path = cfg_dir.join("hub.json");
    let url = effective_url(hub_url);

    if is_safe_https(url) {
        let meta = read_meta(&meta_path);
        let first = fetch_remote(url, etag_for(meta.as_ref(), url));
        let mut outcome = decide(first, read_json_file(&cache_path));
        if matches!(outcome, Outcome::Refetch) {
            outcome = decide(fetch_remote(url, None), None);
        }
        match outcome {
            Outcome::UseFresh(mut data, etag) => {
                store_fresh(&cache_path, &meta_path, url, &data, etag);
                data.source = Some("remote".to_string());
                return Ok(data);
            }
            Outcome::UseCache(mut data) => {
                data.source = Some("remote".to_string());
                return Ok(data);
            }
            Outcome::Refetch | Outcome::Fallback => {}
        }
    }
    if let Some(data) = read_local_chain(&override_path, &cache_path) {
        return Ok(data);
    }
    bundled(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_https() {
        assert!(is_safe_https("https://raw.githubusercontent.com/u/r/main/hub.json"));
    }

    #[test]
    fn rejects_http() {
        assert!(!is_safe_https("http://example.test/hub.json"));
    }

    #[test]
    fn rejects_local_files() {
        // Поле image приходит из недоверенного файла; file:// прочитал бы
        // с диска человека всё, на что укажут.
        assert!(!is_safe_https("file:///C:/Windows/win.ini"));
        assert!(!is_safe_https(r"C:\Windows\win.ini"));
    }

    #[test]
    fn rejects_schemeless_and_empty() {
        assert!(!is_safe_https("example.test/hub.json"));
        assert!(!is_safe_https(""));
    }

    #[test]
    fn the_scheme_is_case_insensitive_but_nothing_else_is() {
        assert!(is_safe_https("HTTPS://example.test/a.png"));
        assert!(!is_safe_https(" https://example.test/a.png"));
    }

    #[test]
    fn a_non_ascii_url_is_rejected_and_does_not_panic() {
        // Единственный способ этой функции сломаться: сравнение по срезу
        // строки паникует, когда восьмой байт попадает внутрь символа.
        assert!(!is_safe_https("https:/日本"));
        assert!(!is_safe_https("日日日x"));
        assert!(!is_safe_https("ааа€x"));
        // А правильный адрес с неASCII-хостом проходить обязан.
        assert!(is_safe_https("https://日本.test/арт.png"));
    }

    #[test]
    fn an_empty_host_is_rejected() {
        assert!(!is_safe_https("https:///etc/passwd"));
        assert!(!is_safe_https("https://"));
        assert!(is_safe_https("https://a"));
    }

    #[test]
    fn a_hub_file_exactly_at_the_ceiling_is_accepted() {
        // Проверяет ровно ту границу, на которой легко ошибиться на один
        // байт: `read_json_file` читает `MAX_HUB_BYTES + 1` байт и передаёт
        // длину сюда, а не наоборот. Ровно потолок обязан пройти.
        assert!(!exceeds_hub_ceiling(MAX_HUB_BYTES));
    }

    #[test]
    fn a_hub_file_one_byte_over_the_ceiling_is_rejected() {
        assert!(exceeds_hub_ceiling(MAX_HUB_BYTES + 1));
    }

    fn hub_json(version: u32) -> String {
        format!(r#"{{"version":{version}}}"#)
    }

    /// Отдельная временная папка на тест: тесты в этом файле пишут местные
    /// файлы на диск и выполняются в одном процессе параллельно, общий путь
    /// привёл бы к тому, что один тест читал бы файл, оставленный другим.
    fn temp_hub_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gh-hub-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_json_file_refuses_a_local_file_larger_than_the_ceiling() {
        // До этой правки потолок применялся только к сетевой загрузке:
        // `hub.json`/`hub_cache.json` читались целиком, без ограничения.
        let dir = temp_hub_dir("oversized");
        let path = dir.join("hub.json");
        std::fs::write(&path, "0".repeat(MAX_HUB_BYTES + 1)).unwrap();

        assert!(read_json_file(&path).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_json_file_accepts_a_local_file_within_the_ceiling() {
        let dir = temp_hub_dir("within-cap");
        let path = dir.join("hub.json");
        std::fs::write(&path, hub_json(7)).unwrap();

        let data = read_json_file(&path).expect("файл в пределах потолка обязан прочитаться");
        assert_eq!(data.version, 7);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_chain_prefers_the_override_file_over_the_cache() {
        let dir = temp_hub_dir("override-over-cache");
        let override_path = dir.join("hub.json");
        let cache_path = dir.join("hub_cache.json");
        std::fs::write(&override_path, hub_json(11)).unwrap();
        std::fs::write(&cache_path, hub_json(22)).unwrap();

        let data =
            read_local_chain(&override_path, &cache_path).expect("должен найтись override");
        assert_eq!(data.version, 11);
        assert_eq!(data.source.as_deref(), Some("override"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_chain_falls_back_to_the_cache_when_there_is_no_override() {
        let dir = temp_hub_dir("cache-fallback");
        let override_path = dir.join("hub.json");
        let cache_path = dir.join("hub_cache.json");
        std::fs::write(&cache_path, hub_json(22)).unwrap();

        let data = read_local_chain(&override_path, &cache_path).expect("должен найтись cache");
        assert_eq!(data.version, 22);
        assert_eq!(data.source.as_deref(), Some("cache"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_chain_skips_a_broken_override_and_falls_back_to_the_cache() {
        // Подмена может оказаться не JSON (человек редактировал руками и
        // ошибся) — это не повод остаться совсем без данных, пока рабочий
        // кеш есть.
        let dir = temp_hub_dir("broken-override");
        let override_path = dir.join("hub.json");
        let cache_path = dir.join("hub_cache.json");
        std::fs::write(&override_path, "это не json").unwrap();
        std::fs::write(&cache_path, hub_json(5)).unwrap();

        let data = read_local_chain(&override_path, &cache_path).expect("должен найтись cache");
        assert_eq!(data.version, 5);
        assert_eq!(data.source.as_deref(), Some("cache"));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Файл хаба с временем, которое окно показать не сможет.
    const IMPOSSIBLE_TIME: &str = r#"{"version":2,"updatedAt":-9000000000000}"#;

    #[test]
    fn a_local_file_with_an_impossible_time_is_read_as_a_broken_one() {
        let dir = temp_hub_dir("impossible-time");
        let path = dir.join("hub_cache.json");
        std::fs::write(&path, IMPOSSIBLE_TIME).unwrap();

        assert!(read_json_file(&path).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_chain_skips_an_override_with_an_impossible_time_for_the_cache() {
        let dir = temp_hub_dir("impossible-override");
        let override_path = dir.join("hub.json");
        let cache_path = dir.join("hub_cache.json");
        std::fs::write(&override_path, IMPOSSIBLE_TIME).unwrap();
        std::fs::write(&cache_path, hub_json(5)).unwrap();

        let data = read_local_chain(&override_path, &cache_path).expect("должен найтись cache");
        assert_eq!(data.version, 5);
        assert_eq!(data.source.as_deref(), Some("cache"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_downloaded_body_with_an_impossible_time_fails_like_a_broken_one() {
        // Сеть тут не нужна: разбор тела вынесен из `fetch_remote`. `Failed`
        // отправляет `decide` к местной цепочке, как и любой битый ответ.
        assert!(matches!(remote_from_body(IMPOSSIBLE_TIME, None), Remote::Failed));
        assert!(matches!(remote_from_body("это не json", None), Remote::Failed));
        match remote_from_body(r#"{"version":2,"updatedAt":1790786927}"#, Some("\"t\"".into())) {
            Remote::Fresh { data, etag } => {
                assert_eq!(data.updated_at, 1_790_786_927);
                assert_eq!(etag.as_deref(), Some("\"t\""));
            }
            _ => panic!("годный ответ обязан пройти"),
        }
    }

    #[test]
    fn the_bundled_file_is_read_through_the_same_ceiling_and_checks() {
        let dir = temp_hub_dir("bundled");
        let path = dir.join("hub.json");

        std::fs::write(&path, hub_json(2)).unwrap();
        assert_eq!(read_bundled(&path).expect("годный файл").version, 2);

        std::fs::write(&path, "0".repeat(MAX_HUB_BYTES + 1)).unwrap();
        assert!(read_bundled(&path).is_err(), "файл больше потолка не читается");

        std::fs::write(&path, IMPOSSIBLE_TIME).unwrap();
        assert!(read_bundled(&path).is_err(), "время вне диапазона — как битый файл");

        assert!(read_bundled(&dir.join("нет.json")).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_chain_is_none_when_neither_file_exists() {
        // `None` — сигнал вызывающему коду перейти на встроенный запасной
        // вариант из комплекта. Ни один местный файл не обязан существовать:
        // это обычное состояние на свежей установке.
        let dir = temp_hub_dir("neither-exists");
        let override_path = dir.join("hub.json");
        let cache_path = dir.join("hub_cache.json");

        assert!(read_local_chain(&override_path, &cache_path).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_hub_url_means_the_collector() {
        assert_eq!(effective_url(None), DEFAULT_HUB_URL);
        assert_eq!(effective_url(Some("")), DEFAULT_HUB_URL);
        assert_eq!(effective_url(Some("   ")), DEFAULT_HUB_URL);
        assert_eq!(effective_url(Some("https://example.test/hub.json")), "https://example.test/hub.json");
    }

    #[test]
    fn the_collector_address_is_https() {
        assert!(is_safe_https(DEFAULT_HUB_URL));
    }

    #[test]
    fn a_version_tag_is_sent_only_for_the_address_it_came_from() {
        let meta = CacheMeta { url: DEFAULT_HUB_URL.to_string(), etag: Some("\"v1\"".to_string()), format: CACHE_FORMAT };
        assert_eq!(etag_for(Some(&meta), DEFAULT_HUB_URL), Some("\"v1\""));
        assert_eq!(etag_for(Some(&meta), "https://example.test/hub.json"), None);
        assert_eq!(etag_for(None, DEFAULT_HUB_URL), None);
    }

    #[test]
    fn cache_meta_survives_a_round_trip_and_garbage_reads_as_none() {
        let dir = temp_hub_dir("meta");
        let path = dir.join("hub_cache.meta.json");
        let meta = CacheMeta { url: DEFAULT_HUB_URL.to_string(), etag: Some("\"v2\"".to_string()), format: CACHE_FORMAT };
        write_meta(&path, &meta);
        assert_eq!(read_meta(&path), Some(meta));
        std::fs::write(&path, "{broken").unwrap();
        assert_eq!(read_meta(&path), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_meta_without_a_format_field_gives_no_etag_even_for_the_same_url() {
        // Ровно та метка, что осталась бы на диске от сборки до этой правки:
        // поля format в ней никогда не было. serde читает его как 0, что не
        // совпадает с CACHE_FORMAT, — значит метка не уйдёт на сервер, и
        // первый запрос после обновления вернёт полный файл, а не 304 на
        // кеш без lang у видео.
        let json = format!(r#"{{"url":"{DEFAULT_HUB_URL}","etag":"\"old\""}}"#);
        let meta: CacheMeta = serde_json::from_str(&json).expect("это валидный JSON без format");
        assert_eq!(meta.format, 0);
        assert_eq!(etag_for(Some(&meta), DEFAULT_HUB_URL), None);
    }

    #[test]
    fn a_meta_written_by_store_fresh_gives_the_etag_back() {
        let dir = temp_hub_dir("format-roundtrip");
        let cache_path = dir.join("hub_cache.json");
        let meta_path = dir.join("hub_cache.meta.json");

        store_fresh(&cache_path, &meta_path, DEFAULT_HUB_URL, &data(4), Some("\"tag4\"".to_string()));

        let meta = read_meta(&meta_path).expect("метка обязана записаться");
        assert_eq!(meta.format, CACHE_FORMAT);
        assert_eq!(etag_for(Some(&meta), DEFAULT_HUB_URL), Some("\"tag4\""));
        std::fs::remove_dir_all(&dir).ok();
    }

    fn data(version: u32) -> HubData {
        HubData { version, ..HubData::default() }
    }

    #[test]
    fn a_failed_cache_write_leaves_the_meta_file_unchanged() {
        // Путь к кешу лежит в несуществующей подпапке — `fs::write` там
        // обязан провалиться, не создавая родителей. Этого достаточно,
        // чтобы проверить порядок в `store_fresh`, не поднимая `AppHandle`.
        let dir = temp_hub_dir("meta-guard");
        let cache_path = dir.join("nonexistent").join("hub_cache.json");
        let meta_path = dir.join("hub_cache.meta.json");
        let old_meta = CacheMeta { url: DEFAULT_HUB_URL.to_string(), etag: Some("\"old\"".to_string()), format: CACHE_FORMAT };
        write_meta(&meta_path, &old_meta);

        store_fresh(&cache_path, &meta_path, DEFAULT_HUB_URL, &data(3), Some("\"new\"".to_string()));

        assert_eq!(read_meta(&meta_path), Some(old_meta));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn store_fresh_writes_the_cache_and_a_matching_meta() {
        // Обратная сторона `a_failed_cache_write_leaves_the_meta_file_unchanged`:
        // на рабочих путях обязаны записаться оба файла, а не только не
        // сломаться порядок. Без этого теста пропавший вызов `write_meta`
        // внутри `store_fresh` не ловится ничем — остальные тесты его не видят.
        let dir = temp_hub_dir("store-fresh-success");
        let cache_path = dir.join("hub_cache.json");
        let meta_path = dir.join("hub_cache.meta.json");

        store_fresh(&cache_path, &meta_path, DEFAULT_HUB_URL, &data(9), Some("\"tag9\"".to_string()));

        let cached = read_json_file(&cache_path).expect("кеш обязан записаться");
        assert_eq!(cached.version, 9);

        let meta = read_meta(&meta_path).expect("метка обязана записаться");
        assert_eq!(meta.url, DEFAULT_HUB_URL);
        assert_eq!(meta.etag.as_deref(), Some("\"tag9\""));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_fresh_answer_is_used_with_its_tag() {
        match decide(Remote::Fresh { data: Box::new(data(2)), etag: Some("\"v3\"".into()) }, None) {
            Outcome::UseFresh(d, tag) => {
                assert_eq!(d.version, 2);
                assert_eq!(tag.as_deref(), Some("\"v3\""));
            }
            _ => panic!("ожидался свежий файл"),
        }
    }

    #[test]
    fn not_modified_uses_the_cache_or_refetches_without_one() {
        assert!(matches!(decide(Remote::NotModified, Some(data(2))), Outcome::UseCache(d) if d.version == 2));
        assert!(matches!(decide(Remote::NotModified, None), Outcome::Refetch));
    }

    #[test]
    fn a_failed_request_falls_back_to_the_local_chain() {
        assert!(matches!(decide(Remote::Failed, Some(data(2))), Outcome::Fallback));
    }
}
