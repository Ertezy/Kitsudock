//! Схема файла хаба, версия 2.
//!
//! Все моменты времени — unix-секунды числом, а не строкой с датой. Сроки
//! кодов и баннеров привязаны к серверам игр в разных поясах, а показываются
//! человеку в местном времени; строка «до 30 сентября» соврала бы на часы.
//!
//! Каждое поле — недоверенный ввод (спека §8.1). Разбор обязан пережить
//! неполный, лишний и неожиданный набор полей: файл приходит извне, и падение
//! на нём означало бы пустую панель у человека.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};

/// Разбирает массив поэлементно, пропуская то, что не разобралось.
///
/// Без этого одна битая запись роняет разбор всего файла, и человек получает
/// пустую панель вместо одной пропавшей карточки. Файл приходит извне (§8.1),
/// и устойчивость тут важнее строгости: пропущенную карточку видно, а пустую
/// панель невозможно отличить от «сегодня ничего не раздают».
fn lenient_vec<'de, D, T>(d: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    // Разбираем в `Value`, а не сразу в `Vec<Value>`: при `"codes": null`
    // или `"codes": 42` разбор вектора вернул бы ошибку наружу и уронил
    // разбор ВСЕГО файла — ровно та пустая панель, которую эта функция и
    // должна предотвращать. `#[serde(default)]` тут не помогает: он
    // срабатывает на отсутствующее поле, а не на присутствующее с чужим типом.
    let raw = match serde_json::Value::deserialize(d)? {
        serde_json::Value::Array(items) => items,
        _ => return Ok(Vec::new()),
    };
    Ok(raw
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect())
}

/// Последняя опубликованная версия приложения: номер без «v» и страница
/// релиза (спека 2026-10-01 §2.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppRelease {
    pub version: String,
    pub url: String,
}

/// Страницы релизов этого приложения: только они годятся как ссылка «Вышла
/// версия». Та же строка — в `src/lib/update.ts` и у сборщика (`APP_URL_PREFIX`).
const RELEASES_URL_PREFIX: &str = "https://github.com/Ertezy/Kitsudock/releases/";

/// Сегмент пути «.» или «..», в том числе в записи `%2e` любого регистра
/// (`%2e%2e`, `.%2e`): разбор адреса такие сегменты сворачивает, и ссылка
/// приходит не туда, куда читается в строке.
fn is_dot_segment(segment: &str) -> bool {
    let mut rest = segment;
    let mut parts = 0;
    while !rest.is_empty() {
        if let Some(tail) = rest.strip_prefix('.') {
            rest = tail;
        } else if rest.as_bytes().get(..3).is_some_and(|h| h.eq_ignore_ascii_case(b"%2e")) {
            // Первые три байта — ASCII, так что срез по границе символа.
            rest = &rest[3..];
        } else {
            return false;
        }
        parts += 1;
        if parts > 2 {
            return false;
        }
    }
    parts > 0
}

/// Ссылка на страницу релиза: строка начинается с `RELEASES_URL_PREFIX`, в
/// пути нет сегментов «.» и «..», а во всей строке — обратной косой черты,
/// пробелов и управляющих знаков. Правило то же, что у сборщика
/// (`appUrlOk`) и у окна (`isReleaseUrl` в `src/lib/update.ts`); крейта `url`
/// в приложении нет, поэтому разбор ручной.
///
/// JS-овское `\s` считает пробелом ещё и U+FEFF, а `char::is_whitespace` — нет,
/// поэтому он перечислен отдельно: иначе две проверки разошлись бы.
fn is_release_url(url: &str) -> bool {
    let Some(tail) = url.strip_prefix(RELEASES_URL_PREFIX) else {
        return false;
    };
    if url
        .chars()
        .any(|c| c == '\\' || c == '\u{feff}' || c.is_whitespace() || c.is_control())
    {
        return false;
    }
    // Путь кончается на «?» или «#»: «..» в запросе и якоре ничего не сворачивает.
    let path = tail.split(['?', '#']).next().unwrap_or("");
    !path.split('/').any(is_dot_segment)
}

/// Поле `app`, разобранное снисходительно: битое (не та форма, не три числа
/// через точку, ссылка не на страницу релизов этого приложения) становится
/// `None`, а остальной файл читается как обычно (спека 2026-10-01 §2.2).
/// Строки «Вышла версия» тогда просто нет.
fn lenient_app<'de, D>(d: D) -> Result<Option<AppRelease>, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(d)?;
    let Ok(release) = serde_json::from_value::<AppRelease>(raw) else {
        return Ok(None);
    };
    // То же правило («три числа») — в `src/lib/update.ts` (`parts`) и у сборщика
    // (`src/sources/appRelease.ts`, `VERSION`).
    let parts: Vec<&str> = release.version.split('.').collect();
    let three_numbers = parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    Ok((three_numbers && is_release_url(&release.url)).then_some(release))
}

/// Самая поздняя дата, которую умеет JS `Date` (в секундах); раньше эпохи
/// файл хаба появиться не мог. Время вне `0..=MAX_UPDATED_AT` окно показать
/// не сможет: `Intl` бросает на такой дате ошибку, и экран остаётся пустым.
const MAX_UPDATED_AT: i64 = 8_640_000_000_000;

/// `updatedAt` вне допустимого диапазона делает негодным весь файл: он
/// отбрасывается, как битый JSON, и вызывающий код берёт следующий источник
/// (кеш, затем файл из комплекта). Чинить число молча нельзя — по нему
/// считается свежесть данных.
fn bounded_updated_at<'de, D>(d: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    let secs = i64::deserialize(d)?;
    if (0..=MAX_UPDATED_AT).contains(&secs) {
        Ok(secs)
    } else {
        Err(serde::de::Error::custom(format!(
            "updatedAt {secs} вне диапазона 0..={MAX_UPDATED_AT}"
        )))
    }
}

/// Ролики живут только на ютубе, и только по адресам двух видов, которые
/// отдаёт сборщик: обычный ролик и короткий. Любая другая страница сайта или
/// другой сайт — это в панели кнопка, которая открывает адрес в браузере
/// человека от имени приложения.
const YOUTUBE_VIDEO_PREFIXES: [&str; 2] = [
    "https://www.youtube.com/watch?v=",
    "https://www.youtube.com/shorts/",
];

/// Массив видео: битые записи пропускаются, как у `lenient_vec`, а ролики с
/// адресом не на `YOUTUBE_VIDEO_PREFIXES` отбрасываются поодиночке.
fn lenient_videos<'de, D>(d: D) -> Result<Vec<Video>, D::Error>
where
    D: Deserializer<'de>,
{
    let mut videos: Vec<Video> = lenient_vec(d)?;
    videos.retain(|v| YOUTUBE_VIDEO_PREFIXES.iter().any(|p| v.url.starts_with(p)));
    Ok(videos)
}

/// Текущий фон официального лаунчера игры (спека 2026-10-02 §2): картинка и,
/// если есть, видео. Только ссылки.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GameBackground {
    pub image: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
}

/// Поле `background`, разобранное снисходительно: картинка не https — фона нет;
/// видео не https — остаётся одна картинка. Игра читается в любом случае.
fn lenient_background<'de, D>(d: D) -> Result<Option<GameBackground>, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(d)?;
    let Ok(mut bg) = serde_json::from_value::<GameBackground>(raw) else {
        return Ok(None);
    };
    if !bg.image.starts_with("https://") {
        return Ok(None);
    }
    if bg.video.as_deref().is_some_and(|v| !v.starts_with("https://")) {
        bg.video = None;
    }
    Ok(Some(bg))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubData {
    #[serde(default)]
    pub version: u32,
    /// Когда сборщик собрал файл. Основа правила протухания (спека §6).
    /// Вне `0..=MAX_UPDATED_AT` файл не разбирается вовсе.
    #[serde(default, deserialize_with = "bounded_updated_at")]
    pub updated_at: i64,
    #[serde(default, deserialize_with = "lenient_vec")]
    pub games: Vec<HubGame>,
    #[serde(default, deserialize_with = "lenient_vec")]
    pub codes: Vec<Code>,
    #[serde(default, deserialize_with = "lenient_vec")]
    pub banners: Vec<Banner>,
    #[serde(default, deserialize_with = "lenient_videos")]
    pub videos: Vec<Video>,
    /// Последняя опубликованная версия приложения. Нет поля — нет и строки
    /// «Вышла версия».
    #[serde(
        default,
        deserialize_with = "lenient_app",
        skip_serializing_if = "Option::is_none"
    )]
    pub app: Option<AppRelease>,
    /// Откуда приехали данные: "remote" | "override" | "cache" | "bundled".
    /// Проставляется при загрузке, в файле не лежит.
    #[serde(rename = "_source", default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubGame {
    pub id: String,
    #[serde(default)]
    pub title: String,
    /// Шаблон адреса погашения с подстановкой `{code}`. Отсутствует у игр
    /// без веб-погашения — у Вувы и Эндфилда его нет, коды вводятся в игре.
    #[serde(default)]
    pub redeem_url: Option<String>,
    /// `match` — ключевое слово Rust, поэтому поле названо иначе.
    #[serde(rename = "match", default)]
    pub matching: Match,
    /// Официальный фон игры; нет — фон берётся из магазина или градиент.
    #[serde(default, deserialize_with = "lenient_background", skip_serializing_if = "Option::is_none")]
    pub background: Option<GameBackground>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    #[serde(default)]
    pub steam_app_ids: Vec<u32>,
    #[serde(default)]
    pub epic_app_names: Vec<String>,
    #[serde(default)]
    pub folder_names: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Code {
    pub game_id: String,
    pub code: String,
    #[serde(default)]
    pub rewards: String,
    /// `None` — срок неизвестен или код бессрочный. Показывается «бессрочный».
    #[serde(default)]
    pub expires_at: Option<i64>,
    /// "all" или регион сервера. Носим, но не фильтруем до этапа 3.
    #[serde(default = "region_all")]
    pub region: String,
    #[serde(default)]
    pub source: Option<String>,
}

fn region_all() -> String {
    "all".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Banner {
    pub game_id: String,
    #[serde(default)]
    pub title: String,
    /// Имена персонажей на баннере.
    #[serde(default)]
    pub featured: Vec<String>,
    #[serde(default)]
    pub rarity: Option<u8>,
    /// Уже уменьшенный адрес — уменьшает сборщик, не приложение.
    /// `None` у ХСР: вики называет файл, но не хранит его (спека §4.2).
    #[serde(default)]
    pub image: Option<String>,
    pub starts_at: i64,
    pub ends_at: i64,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub game_id: String,
    /// Язык видео: "en" или "ja" (спека этапа 6 §3.2). У файлов до этапа 6
    /// поля нет — страница считает такое видео английским. Без поля здесь
    /// serde выбросил бы метку по дороге к странице.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    #[serde(default)]
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub thumb: Option<String>,
    pub published_at: i64,
    /// Секунды. Лента RSS ютуба длительности не даёт, поэтому обычно `None`.
    #[serde(default)]
    pub duration: Option<u32>,
    #[serde(default)]
    pub premiere: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "version": 2,
      "updatedAt": 1788091200,
      "games": [{
        "id": "zzz",
        "title": "Zenless Zone Zero",
        "icon": "https://example.test/zzz.png",
        "redeemUrl": "https://zenless.hoyoverse.com/redemption?code={code}",
        "match": { "steamAppIds": [], "epicAppNames": ["nap"], "folderNames": ["ZenlessZoneZero"] }
      }],
      "codes": [{
        "gameId": "zzz", "code": "FLINTWORKS", "rewards": "300 полихромов",
        "expiresAt": 1788105599, "region": "all", "source": "https://example.test"
      }],
      "banners": [{
        "gameId": "genshin", "title": "Ледяная тень лебедя",
        "featured": ["Одетт"], "rarity": 5,
        "image": "https://example.test/art.png",
        "startsAt": 1786489200, "endsAt": 1788256740,
        "url": "https://example.test/news"
      }],
      "videos": [{
        "gameId": "genshin", "title": "Local Legend",
        "url": "https://www.youtube.com/watch?v=abc",
        "thumb": "https://i3.ytimg.com/vi/abc/hqdefault.jpg",
        "publishedAt": 1787738439, "duration": null, "premiere": false
      }]
    }"#;

    #[test]
    fn parses_a_complete_file() {
        let d: HubData = serde_json::from_str(SAMPLE).unwrap();
        assert_eq!(d.version, 2);
        assert_eq!(d.updated_at, 1788091200);
        assert_eq!(d.games[0].id, "zzz");
        assert_eq!(d.games[0].matching.epic_app_names, vec!["nap"]);
        assert_eq!(d.codes[0].expires_at, Some(1788105599));
        assert_eq!(d.banners[0].starts_at, 1786489200);
        assert_eq!(d.videos[0].duration, None);
    }

    #[test]
    fn a_code_without_an_expiry_is_open_ended() {
        let json = r#"{"gameId":"zzz","code":"X","rewards":"","expiresAt":null,"region":"all"}"#;
        let c: Code = serde_json::from_str(json).unwrap();
        assert_eq!(c.expires_at, None);
    }

    #[test]
    fn missing_optional_fields_do_not_fail_the_parse() {
        // Сборщик может не заполнить необязательное. Разбор обязан выжить:
        // файл приходит извне, и падение на нём означало бы пустую панель.
        let json = r#"{"gameId":"gi","code":"Y","rewards":"","region":"all"}"#;
        let c: Code = serde_json::from_str(json).unwrap();
        assert_eq!(c.expires_at, None);
        assert_eq!(c.source, None);
    }

    #[test]
    fn an_empty_object_parses_into_empty_lists() {
        let d: HubData = serde_json::from_str("{}").unwrap();
        assert_eq!(d.version, 0);
        assert!(d.games.is_empty());
        assert!(d.codes.is_empty());
    }

    #[test]
    fn unknown_fields_are_ignored() {
        // Сборщик впереди приложения: он добавит поле раньше, чем мы его
        // научимся читать. Старая версия обязана пережить новый файл.
        let d: HubData = serde_json::from_str(r#"{"version":2,"guides":[{"x":1}]}"#).unwrap();
        assert_eq!(d.version, 2);
    }

    #[test]
    fn one_broken_entry_does_not_take_the_whole_file_down() {
        // Самое важное свойство разбора. Без него одна битая запись у
        // сборщика оставляет каждого пользователя с пустой панелью вместо
        // одной пропавшей карточки.
        let json = r#"{
          "version": 2,
          "codes": [
            {"gameId":"zzz","code":"GOOD","rewards":"","region":"all"},
            {"code":"НЕТ ИГРЫ"},
            {"gameId":"gi","code":"ALSOGOOD","rewards":"","region":"all"}
          ]
        }"#;
        let d: HubData = serde_json::from_str(json).unwrap();
        assert_eq!(d.codes.len(), 2, "уцелеть должны обе целые записи");
        assert_eq!(d.codes[0].code, "GOOD");
        assert_eq!(d.codes[1].code, "ALSOGOOD");
    }

    #[test]
    fn entries_of_the_wrong_shape_are_skipped_not_fatal() {
        let d: HubData = serde_json::from_str(r#"{"version":2,"codes":[42,"строка",null]}"#).unwrap();
        assert!(d.codes.is_empty());
    }

    #[test]
    fn a_list_that_is_not_a_list_yields_nothing_rather_than_failing() {
        for json in [
            r#"{"version":2,"codes":null}"#,
            r#"{"version":2,"codes":42}"#,
            r#"{"version":2,"codes":{"a":1}}"#,
        ] {
            let d: HubData = serde_json::from_str(json)
                .unwrap_or_else(|e| panic!("разбор упал на {json}: {e}"));
            assert_eq!(d.version, 2);
            assert!(d.codes.is_empty());
        }
    }

    #[test]
    fn region_falls_back_to_all_when_absent() {
        // Прежний тест «отсутствующих полей» проставлял region явно,
        // поэтому ветка умолчания не исполнялась ни разу.
        let json = r#"{"gameId":"gi","code":"Z","rewards":""}"#;
        let c: Code = serde_json::from_str(json).unwrap();
        assert_eq!(c.region, "all");
    }

    #[test]
    fn a_video_keeps_its_language_and_an_old_one_has_none() {
        let with: Video = serde_json::from_value(serde_json::json!({
            "gameId": "hsr", "lang": "ja", "title": "T", "url": "https://www.youtube.com/watch?v=a",
            "thumb": null, "publishedAt": 1, "duration": null, "premiere": false
        })).unwrap();
        assert_eq!(with.lang.as_deref(), Some("ja"));
        assert_eq!(serde_json::to_value(&with).unwrap()["lang"], "ja");
        let old: Video = serde_json::from_value(serde_json::json!({
            "gameId": "hsr", "title": "T", "url": "https://www.youtube.com/watch?v=a",
            "thumb": null, "publishedAt": 1, "duration": null, "premiere": false
        })).unwrap();
        assert_eq!(old.lang, None);
        assert!(serde_json::to_value(&old).unwrap().get("lang").is_none());
    }

    #[test]
    fn reads_the_latest_app_release() {
        let d: HubData = serde_json::from_str(r#"{"version":2,"updatedAt":1,
            "app":{"version":"0.1.1","url":"https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1"}}"#).unwrap();
        assert_eq!(
            d.app,
            Some(AppRelease {
                version: "0.1.1".into(),
                url: "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1".into()
            })
        );
    }

    #[test]
    fn a_broken_app_field_is_dropped_and_the_file_still_reads() {
        for app in [
            r#"42"#,
            r#"{"version":"0.1","url":"https://x"}"#,
            r#"{"version":"0.1.1-beta","url":"https://x"}"#,
            r#"{"version":"0.1.1","url":"http://x"}"#,
            r#"{"version":"0.1.1"}"#,
            r#"null"#,
        ] {
            let text = format!(r#"{{"version":2,"updatedAt":7,"codes":[],"app":{app}}}"#);
            let d: HubData = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{app}: {e}"));
            assert_eq!(d.app, None, "{app}");
            assert_eq!(d.updated_at, 7, "{app}: остальной файл читается");
        }
    }

    const RELEASES: &str = "https://github.com/Ertezy/Kitsudock/releases/";

    fn app_of(url: &str) -> Option<AppRelease> {
        let text = serde_json::json!({"version": 2, "updatedAt": 7, "app": {"version": "0.1.1", "url": url}}).to_string();
        serde_json::from_str::<HubData>(&text).unwrap().app
    }

    #[test]
    fn only_release_pages_of_this_app_are_accepted_as_the_update_link() {
        for url in [
            "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1",
            "https://github.com/Ertezy/Kitsudock/releases/latest",
            "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1?from=app#notes",
            // Точки внутри сегмента и «..» в запросе пути не сворачивают.
            "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1.rc.2",
            "https://github.com/Ertezy/Kitsudock/releases/tag/...",
            "https://github.com/Ertezy/Kitsudock/releases/?back=../..",
        ] {
            assert_eq!(app_of(url).map(|a| a.url), Some(url.to_string()), "{url}");
        }
    }

    #[test]
    fn a_foreign_update_link_drops_the_app_field_and_the_file_still_reads() {
        for url in [
            "https://evil.test/Ertezy/Kitsudock/releases/tag/v0.1.1",
            "https://github.com/Someone/Kitsudock/releases/tag/v0.1.1",
            "https://github.com/Ertezy/Other/releases/tag/v0.1.1",
            "https://github.com/ertezy/kitsudock/releases/tag/v0.1.1",
            "https://github.com/Ertezy/Kitsudock",
            "https://github.com/Ertezy/Kitsudock/issues/1",
            "https://github.com/Ertezy/Kitsudock/releases",
            "http://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1",
            "https://github.com.evil.test/Ertezy/Kitsudock/releases/tag/v0.1.1",
            "https://github.com@evil.test/Ertezy/Kitsudock/releases/tag/v0.1.1",
        ] {
            let text = serde_json::json!({"version": 2, "updatedAt": 7, "app": {"version": "0.1.1", "url": url}}).to_string();
            let d: HubData = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{url}: {e}"));
            assert_eq!(d.app, None, "{url}");
            assert_eq!(d.updated_at, 7, "{url}: остальной файл читается");
        }
    }

    #[test]
    fn an_update_link_that_climbs_out_of_the_releases_path_is_dropped() {
        for tail in [
            "../../other/repo/releases/tag/v1",
            "tag/../../../other/repo/releases/tag/v1",
            "./tag/v1",
            "tag/./v1",
            "tag/..",
            "%2e%2e/%2e%2e/other/repo/releases/tag/v1",
            "%2E%2E/other",
            ".%2e/other",
            "%2e./other",
            "tag/%2e%2e/%2e%2e/x",
            "tag/%2e/v1",
            "tag/..?x=1",
            "tag/..#x",
        ] {
            let url = format!("{RELEASES}{tail}");
            assert_eq!(app_of(&url), None, "{url}");
        }
    }

    #[test]
    fn an_update_link_with_a_backslash_whitespace_or_control_character_is_dropped() {
        for tail in [
            r"tag\..\..\x",
            r"tag\v1",
            "tag/v1 ",
            "tag/ v1",
            "tag/v1\t",
            "tag/v1\n",
            "tag/v1\r",
            "tag/v\u{0}1",
            "tag/v1\u{7f}",
            "tag/v1\u{a0}",
            "tag/v1\u{2028}",
            // U+FEFF: JS `\s` его считает пробелом, а `char::is_whitespace` в
            // Rust нет — правило двух проверок должно совпадать.
            "tag/v1\u{feff}",
            "tag/\u{feff}v1",
            "tag/v1?x=a\u{feff}b",
            "tag/v1#\u{feff}",
            "tag/v1?x=a b",
        ] {
            let url = format!("{RELEASES}{tail}");
            assert_eq!(app_of(&url), None, "{url:?}");
        }
    }

    #[test]
    fn videos_off_youtube_are_dropped_and_the_rest_are_kept() {
        let video = |url: &str| {
            serde_json::json!({"gameId": "hsr", "title": "T", "url": url, "thumb": null,
                "publishedAt": 1, "duration": null, "premiere": false})
        };
        let hub = serde_json::json!({"version": 2, "updatedAt": 7, "videos": [
            video("https://www.youtube.com/watch?v=a"),
            video("https://youtu.be/b"),
            video("https://m.youtube.com/watch?v=c"),
            video("http://www.youtube.com/watch?v=d"),
            video("https://www.youtube.com.evil.test/watch?v=e"),
            video("https://evil.test/?u=https://www.youtube.com/watch?v=f"),
            video("https://www.youtube.com/watch?v=g"),
        ]});
        let d: HubData = serde_json::from_str(&hub.to_string()).unwrap();
        let urls: Vec<&str> = d.videos.iter().map(|v| v.url.as_str()).collect();
        assert_eq!(urls, ["https://www.youtube.com/watch?v=a", "https://www.youtube.com/watch?v=g"]);
        assert_eq!(d.updated_at, 7, "остальной файл читается");
    }

    #[test]
    fn only_watch_and_shorts_pages_of_youtube_are_kept() {
        let video = |url: &str| {
            serde_json::json!({"gameId": "hsr", "title": "T", "url": url, "thumb": null,
                "publishedAt": 1, "duration": null, "premiere": false})
        };
        let kept = [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/Q-ipLPGL8Qg",
        ];
        let dropped = [
            // Другие страницы того же сайта.
            "https://www.youtube.com/",
            "https://www.youtube.com/account",
            "https://www.youtube.com/redirect?q=https%3A%2F%2Fevil.test%2F",
            "https://www.youtube.com/playlist?list=PL1",
            "https://www.youtube.com/@channel",
            "https://www.youtube.com/live/abc",
            "https://www.youtube.com/embed/abc",
            "https://www.youtube.com/watch",
            "https://www.youtube.com/watch/abc",
            "https://www.youtube.com/watch?x=1&v=abc",
            "https://www.youtube.com/shorts",
            // Чужие приставки к тому же началу.
            "https://www.youtube.com.evil.test/watch?v=a",
            "https://www.youtube.com@evil.test/shorts/a",
            "http://www.youtube.com/shorts/a",
            "HTTPS://www.youtube.com/shorts/a",
            " https://www.youtube.com/watch?v=a",
        ];
        let all: Vec<_> = kept.iter().chain(dropped.iter()).map(|u| video(u)).collect();
        let hub = serde_json::json!({"version": 2, "updatedAt": 7, "videos": all});
        let d: HubData = serde_json::from_str(&hub.to_string()).unwrap();
        let urls: Vec<&str> = d.videos.iter().map(|v| v.url.as_str()).collect();
        assert_eq!(urls, kept);
    }

    #[test]
    fn a_time_the_window_cannot_show_rejects_the_whole_file() {
        // Предел — самая поздняя дата, которую умеет JS `Date`. Дальше окно
        // не отрисуется, поэтому такой файл — такой же негодный, как битый
        // JSON: вызывающий код берёт следующий источник.
        for bad in [
            "-1",
            "8640000000001",
            "-8640000000001",
            "9223372036854775807",
            "-9223372036854775808",
        ] {
            let text = format!(r#"{{"version":2,"updatedAt":{bad}}}"#);
            assert!(serde_json::from_str::<HubData>(&text).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_edges_of_the_allowed_time_range_are_accepted() {
        for (text, want) in [
            (r#"{"version":2,"updatedAt":0}"#, 0),
            (r#"{"version":2,"updatedAt":8640000000000}"#, 8_640_000_000_000),
            (r#"{"version":2}"#, 0),
        ] {
            let d: HubData = serde_json::from_str(text).unwrap_or_else(|e| panic!("{text}: {e}"));
            assert_eq!(d.updated_at, want, "{text}");
        }
    }

    #[test]
    fn the_app_field_survives_the_local_cache_round_trip() {
        // Так файл ложится в локальный кеш и читается обратно:
        // `store_fresh` пишет через serde, `read_json_file` читает.
        let release = AppRelease {
            version: "0.1.1".into(),
            url: "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1".into(),
        };
        let data = HubData {
            version: 2,
            updated_at: 1,
            app: Some(release.clone()),
            ..Default::default()
        };
        let text = serde_json::to_string(&data).unwrap();
        let back: HubData = serde_json::from_str(&text).unwrap();
        assert_eq!(back.app, Some(release));
    }

    #[test]
    fn no_app_field_is_not_written_back() {
        let d: HubData = serde_json::from_str(r#"{"version":2,"updatedAt":1}"#).unwrap();
        assert_eq!(d.app, None);
        assert!(serde_json::to_value(&d).unwrap().get("app").is_none());
    }

    #[test]
    fn reads_the_official_background_of_a_game() {
        let d: HubData = serde_json::from_str(r#"{"version":2,"updatedAt":1,"games":[
            {"id":"zzz","background":{"image":"https://x.test/a.webp","video":"https://x.test/a.webm"}},
            {"id":"hsr","background":{"image":"https://x.test/b.webp"}}]}"#).unwrap();
        assert_eq!(d.games[0].background, Some(GameBackground { image: "https://x.test/a.webp".into(), video: Some("https://x.test/a.webm".into()) }));
        assert_eq!(d.games[1].background, Some(GameBackground { image: "https://x.test/b.webp".into(), video: None }));
    }

    #[test]
    fn a_broken_background_is_dropped_and_the_game_still_reads() {
        for bg in [r#"42"#, r#"{"image":"http://x.test/a.webp"}"#, r#"{"video":"https://x.test/a.webm"}"#, r#"null"#] {
            let text = format!(r#"{{"version":2,"updatedAt":1,"games":[{{"id":"zzz","title":"Z","background":{bg}}}]}}"#);
            let d: HubData = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{bg}: {e}"));
            assert_eq!(d.games.len(), 1, "{bg}: игра читается");
            assert_eq!(d.games[0].background, None, "{bg}");
        }
        let d: HubData = serde_json::from_str(r#"{"version":2,"updatedAt":1,"games":[{"id":"zzz","background":{"image":"https://x.test/a.webp","video":"http://x.test/a.webm"}}]}"#).unwrap();
        assert_eq!(d.games[0].background.as_ref().unwrap().video, None, "видео не https — одна картинка");
    }

    #[test]
    fn the_bundled_snapshot_parses_and_is_not_a_demo() {
        let text = include_str!("../../resources/hub.json");
        let d: HubData = serde_json::from_str(text).expect("файл из комплекта не разобрался");
        assert_eq!(d.version, 2);
        assert_eq!(d.games.len(), 5, "в комплекте должны быть все пять игр");
        assert!(d.updated_at > 1_700_000_000, "updatedAt не заполнен");
        assert!(!d.codes.is_empty(), "снимок без кодов бесполезен");
        // Демо-данные из первого этапа не должны пережить замену.
        assert!(!text.contains("DEMO"), "в файле остались демо-данные");
        assert!(!text.contains("example.com"), "в файле остались заглушечные адреса");
    }

    #[test]
    fn the_bundled_snapshot_loses_nothing_to_the_address_and_date_checks() {
        // Настоящий файл проходит новые проверки целиком: ни одно видео не
        // отброшено, время не отвергнуто, `app` (если он есть) не пропал.
        let text = include_str!("../../resources/hub.json");
        let raw: serde_json::Value = serde_json::from_str(text).unwrap();
        let d: HubData = serde_json::from_str(text).expect("файл из комплекта не разобрался");
        assert_eq!(d.updated_at, raw["updatedAt"].as_i64().unwrap());
        assert_eq!(d.videos.len(), raw["videos"].as_array().unwrap().len(), "видео отброшено");
        assert_eq!(d.app.is_some(), raw.get("app").is_some_and(|a| !a.is_null()), "app пропал");
    }
}
