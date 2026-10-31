//! Схема файла хаба, версия 2.
//!
//! Все моменты времени — unix-секунды числом, а не строкой с датой. Сроки
//! кодов и баннеров привязаны к серверам игр в разных поясах, а показываются
//! человеку в местном времени; строка «до 30 сентября» соврала бы на часы.
//!
//! Каждое поле — недоверенный ввод. Разбор обязан пережить неполный, лишний и
//! неожиданный набор полей: файл приходит извне, и падение на нём означало бы
//! пустую панель у человека.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};

/// Разбирает массив поэлементно, пропуская то, что не разобралось.
///
/// Без этого одна битая запись роняет разбор всего файла, и человек получает
/// пустую панель вместо одной пропавшей карточки. Файл приходит извне,
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
/// релиза.
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

/// Общая часть проверки ссылок из файла: во всей строке нет обратной косой
/// черты, пробелов и управляющих знаков, а в пути (`rest` — всё, что после
/// хоста или после проверенного начала) нет сегментов «.» и «..». Правило то
/// же, что у сборщика (`isPublicHttpsUrl`) и у окна (`isReleaseUrl` в
/// `src/lib/update.ts`); крейта `url` в приложении нет, поэтому разбор ручной.
///
/// JS-овское `\s` считает пробелом ещё и U+FEFF, а `char::is_whitespace` — нет,
/// поэтому он перечислен отдельно: иначе две проверки разошлись бы.
fn is_plain_url(url: &str, rest: &str) -> bool {
    if url
        .chars()
        .any(|c| c == '\\' || c == '\u{feff}' || c.is_whitespace() || c.is_control())
    {
        return false;
    }
    // Путь кончается на «?» или «#»: «..» в запросе и якоре ничего не сворачивает.
    let path = rest.split(['?', '#']).next().unwrap_or("");
    !path.split('/').any(is_dot_segment)
}

/// Ссылка на страницу релиза: строка начинается с `RELEASES_URL_PREFIX` и
/// проходит `is_plain_url`. У сборщика — `appUrlOk`.
fn is_release_url(url: &str) -> bool {
    url.strip_prefix(RELEASES_URL_PREFIX)
        .is_some_and(|tail| is_plain_url(url, tail))
}

/// Поле `app`, разобранное снисходительно: битое (не та форма, не три числа
/// через точку, ссылка не на страницу релизов этого приложения) становится
/// `None`, а остальной файл читается как обычно. Строки «Вышла версия» тогда
/// просто нет.
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

/// Текущий фон официального лаунчера игры: картинка и, если есть, видео.
/// Только ссылки.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GameBackground {
    pub image: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
}

/// Пометка `expiresDayOnly`: только `true` значит «да», любое другое значение —
/// «нет». Кривое значение не должно уносить с собой весь код.
fn lenient_true<'de, D>(d: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(serde_json::Value::deserialize(d)? == serde_json::Value::Bool(true))
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

/// Официальная соцсеть или сайт игры. Незнакомое слово в файле — запись
/// отбрасывается. Тот же список — в окне (`SOCIAL_KINDS` в
/// `src/lib/socials.ts`) и у сборщика.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SocialKind {
    Hoyolab,
    Site,
    Youtube,
    X,
    Discord,
    Reddit,
    Facebook,
    Instagram,
    Tiktok,
    Telegram,
    Vk,
}

impl SocialKind {
    /// Хосты, на которые может вести ссылка этого вида. Ссылка — кнопка,
    /// которая открывает адрес в браузере от имени приложения, поэтому значок
    /// сети не должен вести на чужой сайт.
    fn hosts(self) -> &'static [&'static str] {
        match self {
            Self::Hoyolab => &["www.hoyolab.com", "hoyolab.com"],
            Self::Site => &[
                "genshin.hoyoverse.com",
                "hsr.hoyoverse.com",
                "zenless.hoyoverse.com",
                "wutheringwaves.kurogames.com",
                "endfield.gryphline.com",
            ],
            Self::Youtube => &["www.youtube.com", "youtube.com"],
            Self::X => &["x.com", "twitter.com"],
            Self::Discord => &["discord.gg", "discord.com"],
            Self::Reddit => &["www.reddit.com"],
            Self::Facebook => &["www.facebook.com"],
            Self::Instagram => &["www.instagram.com"],
            Self::Tiktok => &["www.tiktok.com"],
            Self::Telegram => &["t.me"],
            Self::Vk => &["vk.com", "m.vk.com"],
        }
    }
}

/// Короткие ссылки HoYoverse годятся для любого вида: сборщик узнал вид по
/// адресу, куда ссылка ведёт, а хранит её как есть.
const SOCIAL_SHORT_LINK_HOST: &str = "hoyo.link";
/// Столько записей в списке на язык, не больше; лишние отбрасываются с конца.
const MAX_SOCIALS: usize = 10;
/// Самый длинный адрес соцсети — в знаках UTF-16, как `length` у сборщика.
const MAX_SOCIAL_URL: usize = 512;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Social {
    pub kind: SocialKind,
    pub url: String,
}

/// Соцсети игры по языкам интерфейса, в порядке показа. Пустой список в файл
/// не пишется: «нет списка для языка — нет ключа».
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GameSocials {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ru: Vec<Social>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub en: Vec<Social>,
}

impl GameSocials {
    fn is_empty(&self) -> bool {
        self.ru.is_empty() && self.en.is_empty()
    }
}

/// Простой https-адрес на хост своего вида или на `hoyo.link`: без логина и
/// порта (хост сравнивается со списком целиком, так что «@» и «:» его не
/// пройдут), не длиннее `MAX_SOCIAL_URL` и проходит `is_plain_url`. Хост
/// сравнивается буквально: сборщик пишет его строчными.
fn is_social_url(kind: SocialKind, url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    url.encode_utf16().count() <= MAX_SOCIAL_URL
        && (host == SOCIAL_SHORT_LINK_HOST || kind.hosts().contains(&host))
        && is_plain_url(url, &rest[host.len()..])
}

/// Список соцсетей одного языка: битые записи и чужие адреса пропускаются
/// поодиночке, повторы адреса — тоже, сверх `MAX_SOCIALS` — обрезаются.
fn lenient_social_list(raw: Option<&serde_json::Value>) -> Vec<Social> {
    let Some(items) = raw.and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    let mut list: Vec<Social> = Vec::new();
    for item in items {
        let Ok(social) = serde_json::from_value::<Social>(item.clone()) else {
            continue;
        };
        if is_social_url(social.kind, &social.url) && !list.iter().any(|s| s.url == social.url) {
            list.push(social);
            if list.len() == MAX_SOCIALS {
                break;
            }
        }
    }
    list
}

/// Поле `socials`, разобранное снисходительно: не объект — соцсетей нет,
/// незнакомые ключи языков не читаются. Игра читается в любом случае.
fn lenient_socials<'de, D>(d: D) -> Result<GameSocials, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(d)?;
    Ok(GameSocials {
        ru: lenient_social_list(raw.get("ru")),
        en: lenient_social_list(raw.get("en")),
    })
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubData {
    #[serde(default)]
    pub version: u32,
    /// Когда сборщик собрал файл. Основа правила протухания.
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
    /// Официальные соцсети игры; нет поля — столбика соцсетей нет.
    #[serde(default, deserialize_with = "lenient_socials", skip_serializing_if = "GameSocials::is_empty")]
    pub socials: GameSocials,
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
    /// Срок на странице источника был одной датой, без часа: `expires_at` —
    /// оценка конца дня, и окно показывает день, а не часы и минуты.
    #[serde(default, deserialize_with = "lenient_true", skip_serializing_if = "std::ops::Not::not")]
    pub expires_day_only: bool,
    /// "all" или регион сервера. Носим, но пока не фильтруем.
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
    /// `None` у ХСР: вики называет файл, но не хранит его.
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
    /// Язык видео: "en" или "ja". У старых файлов поля нет — страница считает
    /// такое видео английским. Без поля здесь serde выбросил бы метку по дороге
    /// к странице.
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
    fn a_code_remembers_that_its_expiry_was_only_a_date() {
        let json = r#"{"gameId":"hsr","code":"X","rewards":"","expiresAt":1793469599,"expiresDayOnly":true,"region":"all"}"#;
        let c: Code = serde_json::from_str(json).unwrap();
        assert!(c.expires_day_only);
        // Пометка доходит до окна и до кеша под тем же именем.
        assert_eq!(serde_json::to_value(&c).unwrap()["expiresDayOnly"], true);

        // Нет поля или в нём не true — срок точный; кривое значение не роняет код.
        for json in [
            r#"{"gameId":"hsr","code":"X","rewards":"","expiresAt":1793469599,"region":"all"}"#,
            r#"{"gameId":"hsr","code":"X","rewards":"","expiresAt":1793469599,"expiresDayOnly":"yes","region":"all"}"#,
        ] {
            let c: Code = serde_json::from_str(json).unwrap();
            assert!(!c.expires_day_only, "{json}");
            assert!(serde_json::to_value(&c).unwrap().get("expiresDayOnly").is_none());
        }
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
        // Демо-данные ранних сборок не должны пережить замену.
        assert!(!text.contains("DEMO"), "в файле остались демо-данные");
        assert!(!text.contains("example.com"), "в файле остались заглушечные адреса");
    }

    /// Файл проходит проверки целиком: ни одно видео и ни одна соцсеть не
    /// отброшены, время не отвергнуто, `app` (если он есть) не пропал.
    fn assert_loses_nothing(text: &str) {
        let raw: serde_json::Value = serde_json::from_str(text).unwrap();
        let d: HubData = serde_json::from_str(text).expect("файл не разобрался");
        assert_eq!(d.updated_at, raw["updatedAt"].as_i64().unwrap());
        assert_eq!(d.videos.len(), raw["videos"].as_array().unwrap().len(), "видео отброшено");
        assert_eq!(d.app.is_some(), raw.get("app").is_some_and(|a| !a.is_null()), "app пропал");
        let raw_games = raw["games"].as_array().unwrap();
        assert_eq!(d.games.len(), raw_games.len(), "игра отброшена");
        for (game, raw_game) in d.games.iter().zip(raw_games) {
            for (lang, kept) in [("ru", &game.socials.ru), ("en", &game.socials.en)] {
                let sent = raw_game["socials"][lang].as_array().map_or(0, Vec::len);
                assert_eq!(kept.len(), sent, "{} {lang}: соцсеть отброшена", game.id);
            }
        }
    }

    #[test]
    fn the_bundled_snapshot_loses_nothing_to_the_address_and_date_checks() {
        assert_loses_nothing(include_str!("../../resources/hub.json"));
    }

    #[test]
    fn a_fresh_file_with_socials_loses_nothing_either() {
        // Снимок из комплекта собран до появления соцсетей; свежий файл
        // сборщика их уже несёт и обязан пройти проверки так же целиком.
        let mut raw: serde_json::Value = serde_json::from_str(include_str!("../../resources/hub.json")).unwrap();
        let socials = serde_json::json!({
            "ru": [
                {"kind": "hoyolab", "url": "https://hoyo.link/aBcD1234"},
                {"kind": "vk", "url": "https://hoyo.link/eev1BdAd"},
                {"kind": "telegram", "url": "https://t.me/AKEndfieldRU"},
                {"kind": "site", "url": "https://hsr.hoyoverse.com/ru-ru/"}
            ],
            "en": [
                {"kind": "x", "url": "https://twitter.com/Wuthering_Waves"},
                {"kind": "youtube", "url": "https://www.youtube.com/@WutheringWaves"},
                {"kind": "discord", "url": "https://discord.com/invite/wutheringwaves"},
                {"kind": "reddit", "url": "https://www.reddit.com/r/WutheringWaves/"},
                {"kind": "facebook", "url": "https://www.facebook.com/WutheringWaves.Official"},
                {"kind": "instagram", "url": "https://www.instagram.com/wuthering_waves/"},
                {"kind": "tiktok", "url": "https://www.tiktok.com/@wutheringwaves_official"}
            ]
        });
        for game in raw["games"].as_array_mut().unwrap() {
            game["socials"] = socials.clone();
        }
        assert_loses_nothing(&raw.to_string());
    }

    fn socials_of(socials: serde_json::Value) -> GameSocials {
        let text = serde_json::json!({"version": 2, "updatedAt": 7,
            "games": [{"id": "zzz", "title": "Z", "socials": socials}]})
        .to_string();
        let d: HubData = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{text}: {e}"));
        assert_eq!(d.updated_at, 7, "остальной файл читается");
        assert_eq!(d.games.len(), 1, "игра читается");
        d.games[0].socials.clone()
    }

    fn en_urls(socials: serde_json::Value) -> Vec<String> {
        socials_of(serde_json::json!({ "en": socials })).en.into_iter().map(|s| s.url).collect()
    }

    fn social(kind: &str, url: &str) -> serde_json::Value {
        serde_json::json!({"kind": kind, "url": url})
    }

    #[test]
    fn reads_the_official_socials_of_a_game_in_their_order() {
        let s = socials_of(serde_json::json!({
            "ru": [social("vk", "https://vk.com/zenlesszonezero"), social("telegram", "https://t.me/zzz_ru")],
            "en": [social("x", "https://x.com/ZZZ_EN"), social("hoyolab", "https://www.hoyolab.com/circles/8")]
        }));
        assert_eq!(
            s.ru,
            vec![
                Social { kind: SocialKind::Vk, url: "https://vk.com/zenlesszonezero".into() },
                Social { kind: SocialKind::Telegram, url: "https://t.me/zzz_ru".into() },
            ]
        );
        assert_eq!(
            s.en,
            vec![
                Social { kind: SocialKind::X, url: "https://x.com/ZZZ_EN".into() },
                Social { kind: SocialKind::Hoyolab, url: "https://www.hoyolab.com/circles/8".into() },
            ]
        );
    }

    #[test]
    fn every_kind_takes_each_of_its_own_hosts() {
        for (kind, hosts) in [
            ("hoyolab", &["www.hoyolab.com", "hoyolab.com"][..]),
            (
                "site",
                &[
                    "genshin.hoyoverse.com",
                    "hsr.hoyoverse.com",
                    "zenless.hoyoverse.com",
                    "wutheringwaves.kurogames.com",
                    "endfield.gryphline.com",
                ][..],
            ),
            ("youtube", &["www.youtube.com", "youtube.com"][..]),
            ("x", &["x.com", "twitter.com"][..]),
            ("discord", &["discord.gg", "discord.com"][..]),
            ("reddit", &["www.reddit.com"][..]),
            ("facebook", &["www.facebook.com"][..]),
            ("instagram", &["www.instagram.com"][..]),
            ("tiktok", &["www.tiktok.com"][..]),
            ("telegram", &["t.me"][..]),
            ("vk", &["vk.com", "m.vk.com"][..]),
        ] {
            for host in hosts {
                for url in [format!("https://{host}"), format!("https://{host}/"), format!("https://{host}/a/b?c=d#e")] {
                    assert_eq!(en_urls(serde_json::json!([social(kind, &url)])), vec![url.clone()], "{kind}: {url}");
                }
            }
        }
    }

    #[test]
    fn a_hoyo_link_short_link_fits_any_kind() {
        // Короткие ссылки HoYoverse: kind сборщик узнал по адресу, куда она ведёт.
        let kinds = [
            "hoyolab", "site", "youtube", "x", "discord", "reddit", "facebook", "instagram", "tiktok", "telegram", "vk",
        ];
        let list: Vec<_> = kinds.iter().enumerate().map(|(i, k)| social(k, &format!("https://hoyo.link/s{i}"))).collect();
        let s = socials_of(serde_json::json!({ "en": list[..10], "ru": list[10..] }));
        assert_eq!(s.en.len(), 10);
        assert_eq!(s.ru, vec![Social { kind: SocialKind::Vk, url: "https://hoyo.link/s10".into() }]);
    }

    #[test]
    fn a_social_of_an_unknown_kind_is_dropped_and_the_rest_are_kept() {
        let urls = en_urls(serde_json::json!([
            social("whatsapp", "https://hoyo.link/w"),
            social("messenger", "https://hoyo.link/m"),
            social("YouTube", "https://www.youtube.com/@a"),
            social("", "https://hoyo.link/e"),
            {"kind": 3, "url": "https://hoyo.link/n"},
            {"url": "https://hoyo.link/no-kind"},
            {"kind": "x"},
            {"kind": "x", "url": 5},
            42,
            null,
            social("discord", "https://discord.gg/ok"),
        ]));
        assert_eq!(urls, ["https://discord.gg/ok"]);
    }

    #[test]
    fn a_social_on_a_host_that_does_not_fit_its_kind_is_dropped() {
        for (kind, url) in [
            ("youtube", "https://x.com/a"),
            ("x", "https://www.youtube.com/@a"),
            ("site", "https://www.hoyoverse.com/"),
            ("site", "https://evil.test/"),
            ("hoyolab", "https://m.hoyolab.com/"),
            ("reddit", "https://reddit.com/r/a"),
            ("facebook", "https://facebook.com/a"),
            ("telegram", "https://telegram.me/a"),
            ("vk", "https://www.vk.com/a"),
            // Чужой хост, похожий на свой.
            ("x", "https://x.com.evil.test/a"),
            ("x", "https://evil.test/x.com"),
            ("x", "https://evilx.com/a"),
            ("x", "https://x.com./a"),
            ("vk", "https://hoyo.link.evil.test/a"),
            // Адрес, который разбор прочёл бы с другим хостом или портом.
            ("x", "https://x.com@evil.test/a"),
            ("x", "https://evil.test@x.com/a"),
            ("x", "https://x.com:443/a"),
            ("x", "https://x.com:/a"),
            ("x", "https://X.COM/a"),
        ] {
            assert!(en_urls(serde_json::json!([social(kind, url)])).is_empty(), "{kind}: {url}");
        }
    }

    #[test]
    fn a_social_url_that_is_not_plain_https_is_dropped() {
        for url in [
            "http://x.com/a",
            "HTTPS://x.com/a",
            " https://x.com/a",
            "https:///x.com/a",
            "https://",
            "x.com/a",
            "javascript:alert(1)",
            r"https://x.com\a",
            r"https://evil.test\x.com/a",
            "https://x.com/a b",
            "https://x.com/a\t",
            "https://x.com/a\n",
            "https://x.com/\u{0}",
            "https://x.com/a\u{7f}",
            "https://x.com/a\u{a0}",
            "https://x.com/a\u{2028}",
            "https://x.com/a\u{feff}",
            // Сегменты «.» и «..» разбор сворачивает: ссылка ушла бы не туда.
            "https://x.com/../a",
            "https://x.com/a/./b",
            "https://x.com/a/..",
            "https://x.com/%2e%2e/a",
            "https://x.com/.%2E/a",
            "https://x.com/a/..?x=1",
        ] {
            assert!(en_urls(serde_json::json!([social("x", url)])).is_empty(), "{url:?}");
        }
        // В запросе и якоре «..» ничего не сворачивает, точки внутри сегмента — тоже.
        for url in ["https://x.com/a?back=../..", "https://x.com/a#../b", "https://x.com/a.b/...", "https://x.com/日本"] {
            assert_eq!(en_urls(serde_json::json!([social("x", url)])), [url], "{url}");
        }
    }

    #[test]
    fn a_social_url_longer_than_512_characters_is_dropped() {
        let head = "https://x.com/";
        let fits = format!("{head}{}", "a".repeat(512 - head.len()));
        let over = format!("{head}{}", "a".repeat(513 - head.len()));
        assert_eq!(en_urls(serde_json::json!([social("x", &fits)])), vec![fits.clone()]);
        assert!(en_urls(serde_json::json!([social("x", &over)])).is_empty());
        // Предел — в знаках, как у сборщика, а не в байтах: кириллица в пути
        // занимает два байта на знак.
        let wide = format!("{head}{}", "ж".repeat(512 - head.len()));
        assert_eq!(en_urls(serde_json::json!([social("x", &wide)])), vec![wide.clone()]);
    }

    #[test]
    fn more_than_ten_socials_are_cut_to_the_first_ten() {
        let list: Vec<_> = (0..13).map(|i| social("x", &format!("https://x.com/{i}"))).collect();
        let urls = en_urls(serde_json::Value::Array(list));
        let want: Vec<String> = (0..10).map(|i| format!("https://x.com/{i}")).collect();
        assert_eq!(urls, want);
    }

    #[test]
    fn a_repeated_social_url_is_kept_once_and_does_not_count_towards_ten() {
        let mut list = vec![social("x", "https://x.com/0"), social("youtube", "https://hoyo.link/r")];
        list.extend((0..10).map(|i| social("x", &format!("https://x.com/{i}"))));
        list.push(social("vk", "https://hoyo.link/r"));
        let urls = en_urls(serde_json::Value::Array(list));
        let mut want = vec!["https://x.com/0".to_string(), "https://hoyo.link/r".to_string()];
        want.extend((1..9).map(|i| format!("https://x.com/{i}")));
        assert_eq!(urls, want);
        // Повторы ищутся внутри одного списка: русский и английский живут порознь.
        let s = socials_of(serde_json::json!({
            "ru": [social("discord", "https://discord.gg/a")],
            "en": [social("discord", "https://discord.gg/a")]
        }));
        assert_eq!((s.ru.len(), s.en.len()), (1, 1));
    }

    #[test]
    fn a_broken_socials_field_is_empty_and_the_game_still_reads() {
        for socials in [
            serde_json::json!(42),
            serde_json::json!(null),
            serde_json::json!("vk"),
            serde_json::json!([social("x", "https://x.com/a")]),
            serde_json::json!({}),
            serde_json::json!({"ru": 5, "en": {"kind": "x", "url": "https://x.com/a"}}),
            serde_json::json!({"de": [social("x", "https://x.com/a")], "RU": [social("x", "https://x.com/a")]}),
        ] {
            assert_eq!(socials_of(socials.clone()), GameSocials::default(), "{socials}");
        }
    }

    #[test]
    fn an_old_file_without_socials_reads_with_none_and_writes_none_back() {
        let d: HubData = serde_json::from_str(r#"{"version":2,"updatedAt":1,"games":[{"id":"zzz","title":"Z"}]}"#).unwrap();
        assert_eq!(d.games[0].socials, GameSocials::default());
        assert!(serde_json::to_value(&d).unwrap()["games"][0].get("socials").is_none());
    }

    #[test]
    fn socials_survive_the_local_cache_round_trip_without_an_empty_language() {
        let d: HubData = serde_json::from_str(
            r#"{"version":2,"updatedAt":1,"games":[{"id":"hsr","socials":{"en":[{"kind":"site","url":"https://hsr.hoyoverse.com/en-us/"}]}}]}"#,
        )
        .unwrap();
        let written = serde_json::to_value(&d).unwrap();
        assert_eq!(
            written["games"][0]["socials"],
            serde_json::json!({"en": [{"kind": "site", "url": "https://hsr.hoyoverse.com/en-us/"}]})
        );
        let back: HubData = serde_json::from_value(written).unwrap();
        assert_eq!(back.games[0].socials, d.games[0].socials);
    }
}
