//! Фоновая картинка игры.
//!
//! Отдельно от иконок, потому что это другая вещь с другим жизненным циклом,
//! и класть их в одну папку значило бы путать при чистке.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::config::Game;
use crate::error::{code, AppError};
use crate::stores::{InstalledGame, StoreRef};

/// Папка кеша фонов.
///
/// Отдельно от кеша картинок хаба: тот чистится по возрасту при каждом
/// запуске, и копия фона оттуда вылетала бы, а исходник человека мог к тому
/// времени уже переехать.
pub fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("нет папки кеша: {e}"))?
        .join("art");
    std::fs::create_dir_all(&dir).map_err(|e| format!("не создать папку кеша арта: {e}"))?;
    Ok(dir)
}

/// Откуда взят фон, который показывается первым.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtSource {
    Video,
    Picture,
    #[serde(rename = "hoyoplay")]
    HoYoPlay,
    Steam,
    Epic,
    Fill,
}

/// Решение о фоне игры.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chosen {
    pub source: ArtSource,
    /// Картинка: своя, официального лаунчера или магазина. Когда первым идёт
    /// видео, она остаётся его неподвижным кадром при «уменьшить движение».
    pub art_path: Option<PathBuf>,
    pub video_path: Option<PathBuf>,
}

/// Фон, который игра получает не от человека: официальный лаунчер или магазин.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provided {
    pub source: ArtSource,
    pub picture: Option<PathBuf>,
    pub video: Option<PathBuf>,
}

impl Provided {
    /// Одна картинка магазина.
    pub fn picture(source: ArtSource, path: PathBuf) -> Self {
        Self { source, picture: Some(path), video: None }
    }
}

/// Порядок источников одной чистой функцией: своё видео, своя картинка,
/// официальный фон или магазин, заливка. Своя картинка закрывает и
/// официальное видео; своё видео берёт неподвижным кадром свою картинку, а
/// если её нет — картинку источника.
pub fn choose(video: Option<PathBuf>, picture: Option<PathBuf>, provided: Option<Provided>) -> Chosen {
    let own_picture = picture.is_some();
    let (provided_source, provided_picture, provided_video) = match provided {
        Some(p) => (Some(p.source), p.picture, p.video),
        None => (None, None, None),
    };
    let source = if video.is_some() {
        ArtSource::Video
    } else if own_picture {
        ArtSource::Picture
    } else {
        provided_source.unwrap_or(ArtSource::Fill)
    };
    Chosen {
        source,
        art_path: picture.or(provided_picture),
        video_path: video.or(if own_picture { None } else { provided_video }),
    }
}

/// Всё, что нужно для картинок магазинов, читается один раз на список игр, а не
/// на каждую игру. Манифесты и каталог Epic читаются, только если без них не
/// обойтись.
pub struct ArtContext {
    store_art: bool,
    installed: Vec<InstalledGame>,
    steam_roots: Vec<PathBuf>,
    epic_catalog: Option<serde_json::Value>,
    /// Каталог Epic нужен был, но не прочитался (испорчен, отсутствует,
    /// превысил потолок размера).
    epic_catalog_unreadable: bool,
    /// Официальные фоны лаунчера по id игры хаба; пусто, если галочка выключена.
    launcher: std::collections::HashMap<String, crate::hub::schema::GameBackground>,
}

impl ArtContext {
    pub fn build(store_art: bool, games: &[Game], hub_games: &[crate::hub::schema::HubGame]) -> Self {
        let mut ctx = Self {
            store_art,
            installed: Vec::new(),
            steam_roots: Vec::new(),
            epic_catalog: None,
            epic_catalog_unreadable: false,
            launcher: launcher_map(store_art, hub_games),
        };
        if !store_art {
            return ctx;
        }
        // Манифесты нужны только для игр с прямым запуском.
        if games.iter().any(|g| matches!(g.launch, crate::config::Launch::Exe)) {
            ctx.installed = crate::stores::installed();
        }
        ctx.steam_roots = crate::stores::steam::install_roots();
        if games.iter().any(|g| matches!(ctx.store_of(g), Some(StoreRef::Epic { .. }))) {
            ctx.epic_catalog = crate::storeart::epic_catalog_path()
                .and_then(|path| crate::storeart::read_epic_catalog(&path));
            ctx.epic_catalog_unreadable = ctx.epic_catalog.is_none();
        }
        ctx
    }

    fn store_of(&self, game: &Game) -> Option<StoreRef> {
        crate::stores::store_of(game, &self.installed)
    }

    /// Каталог Epic был нужен для списка игр, но не прочитался.
    pub fn epic_catalog_unreadable(&self) -> bool {
        self.epic_catalog_unreadable
    }

    #[cfg(test)]
    pub fn for_test(
        store_art: bool,
        installed: Vec<InstalledGame>,
        epic_catalog: Option<serde_json::Value>,
    ) -> Self {
        Self {
            store_art,
            installed,
            steam_roots: Vec::new(),
            epic_catalog,
            epic_catalog_unreadable: false,
            launcher: Default::default(),
        }
    }

    #[cfg(test)]
    pub fn with_steam_roots(mut self, steam_roots: Vec<PathBuf>) -> Self {
        self.steam_roots = steam_roots;
        self
    }

    #[cfg(test)]
    pub fn with_launcher(mut self, hub_games: &[crate::hub::schema::HubGame]) -> Self {
        self.launcher = launcher_map(self.store_art, hub_games);
        self
    }

    /// Есть ли у игры официальный фон в файле хаба. Нет — кеш фонов лаунчера
    /// не открывается вовсе.
    pub fn has_launcher_art(&self, game: &Game) -> bool {
        game.content_id.as_ref().is_some_and(|id| self.launcher.contains_key(id))
    }

    /// Адреса официальных фонов для игр человека: картинка и видео, по порядку,
    /// без повторов. Галочка выключена — пусто.
    pub fn launcher_urls(&self, games: &[Game]) -> Vec<String> {
        let mut urls = Vec::new();
        for game in games {
            let Some(bg) = game.content_id.as_ref().and_then(|id| self.launcher.get(id)) else { continue };
            for url in std::iter::once(&bg.image).chain(bg.video.iter()) {
                if !urls.contains(url) {
                    urls.push(url.clone());
                }
            }
        }
        urls
    }
}

/// Официальные фоны из файла хаба по id игры. Галочка выключена — пусто.
fn launcher_map(
    store_art: bool,
    hub_games: &[crate::hub::schema::HubGame],
) -> std::collections::HashMap<String, crate::hub::schema::GameBackground> {
    if !store_art {
        return Default::default();
    }
    hub_games
        .iter()
        .filter_map(|g| g.background.clone().map(|bg| (g.id.clone(), bg)))
        .collect()
}

/// Адрес картинки Epic для игры — или `None`, если галочка выключена, игра не из
/// Epic или каталог её не знает.
pub fn epic_image_url(game: &Game, ctx: &ArtContext) -> Option<String> {
    if !ctx.store_art {
        return None;
    }
    let Some(StoreRef::Epic { catalog_item_id }) = ctx.store_of(game) else {
        return None;
    };
    crate::storeart::epic_key_image_url(ctx.epic_catalog.as_ref()?, &catalog_item_id)
}

/// Фон игры, готовый к показу в окне: своё видео, своя картинка, официальный
/// фон лаунчера или магазин, заливка.
pub fn resolve(app: &AppHandle, game: &Game, ctx: &ArtContext) -> Chosen {
    // Видео кеш не нужен: без папки кеша пропадают только картинки.
    let video = own_video(app, game);
    let dir = match cache_dir(app) {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("[art] фон без кеша: {e}");
            return choose(video, None, None);
        }
    };
    let picture = game
        .background
        .as_ref()
        .and_then(|own| crate::localcopy::copy_into(&dir, own, ""));
    // Своя картинка перекрывает всё остальное, и тогда ни лаунчер, ни магазин не трогаем.
    let provided = if picture.is_some() {
        None
    } else {
        // Папку кеша лаунчера открываем только для игры, у которой есть официальный фон.
        let official = if ctx.has_launcher_art(game) {
            match crate::launcher_art::cache_dir(app) {
                Ok(ldir) => launcher_backdrop(&ldir, game, ctx),
                Err(e) => {
                    log::warn!("[art] фон лаунчера без кеша: {e}");
                    None
                }
            }
        } else {
            None
        };
        with_still(official, || store_picture(&dir, game, ctx))
    };
    choose(video, picture, provided)
}

/// Склеивает официальный фон с магазином. Официальный с картинкой берётся как
/// есть, и магазин не спрашивается. Скачалось только видео (картинка не
/// скачалась или ещё в пути) — неподвижным кадром ему служит картинка магазина,
/// а источник остаётся официальным: видео-то официальное. Официального фона
/// нет — решает магазин.
fn with_still(
    official: Option<Provided>,
    store: impl FnOnce() -> Option<Provided>,
) -> Option<Provided> {
    match official {
        Some(mut official) if official.picture.is_none() => {
            official.picture = store().and_then(|s| s.picture);
            Some(official)
        }
        Some(official) => Some(official),
        None => store(),
    }
}

/// Официальный фон игры, уже лежащий в кеше фонов лаунчера. Не скачан ни один
/// файл — `None`, и показывается следующий источник.
fn launcher_backdrop(dir: &Path, game: &Game, ctx: &ArtContext) -> Option<Provided> {
    let bg = ctx.launcher.get(game.content_id.as_ref()?)?;
    let picture = crate::images::cached(dir, &bg.image);
    let video = bg
        .video
        .as_ref()
        .and_then(|url| crate::images::cached(dir, url))
        .filter(|path| is_video_file_name(path));
    if picture.is_none() && video.is_none() {
        return None;
    }
    Some(Provided { source: ArtSource::HoYoPlay, picture, video })
}

/// Ролик ли это по расширению. Окну выдаётся только mp4 и webm.
pub fn is_video_file_name(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("mp4") || e.eq_ignore_ascii_case("webm"))
}

/// Ролик подходящего формата, и файл на месте.
pub fn is_usable_video(path: &Path) -> bool {
    is_video_file_name(path) && path.is_file()
}

/// Потолок веса своего видео фона, подобранный живой проверкой. Длина ролика
/// не ограничена: он читается с диска кусками и крутится по кругу, поэтому
/// нагрузку даёт вес и разрешение кадра, а не то, сколько секунд он длится.
pub const MAX_VIDEO_BYTES: u64 = 300 * 1024 * 1024;

/// Правда, если файл тяжелее потолка. Вынесена отдельно от `video_file_problem`
/// ради границы: тест проверяет её напрямую, без файла на диске — тот же
/// приём, что у `exceeds_ceiling` в `images.rs`.
fn exceeds_video_limit(len: u64) -> bool {
    len > MAX_VIDEO_BYTES
}

/// Первая найденная проблема с файлом своего видео фона — ошибка для показа
/// человеку (фразу собирает страница), или `None`, если файл годится.
/// Проверяется и до выбора (окно зовёт `check_video`), и при записи в конфиг
/// (`update_game`): страница не единственная защита.
pub fn video_file_problem(path: &Path) -> Option<AppError> {
    if !is_video_file_name(path) {
        return Some(AppError::new(code::VIDEO_WRONG_FORMAT));
    }
    let Ok(meta) = std::fs::metadata(path) else {
        return Some(AppError::new(code::VIDEO_FILE_MISSING));
    };
    if !meta.is_file() {
        return Some(AppError::new(code::VIDEO_FILE_MISSING));
    }
    if exceeds_video_limit(meta.len()) {
        // Подробность — потолок в мегабайтах: число живёт здесь, в одном
        // месте, а не повторяется в словарях страницы.
        let limit_mb = MAX_VIDEO_BYTES / (1024 * 1024);
        return Some(AppError::with(code::VIDEO_TOO_LARGE, limit_mb.to_string()));
    }
    None
}

/// Своё видео, если файл на месте.
///
/// Ролик не копируется: окну разрешается читать ровно этот файл там, где он
/// лежит. Разрешение живёт до закрытия приложения, повторная
/// выдача того же разрешения безвредна.
fn own_video(app: &AppHandle, game: &Game) -> Option<PathBuf> {
    let video = game.video.as_ref()?;
    if !is_video_file_name(video) {
        log::warn!("[art] видео не mp4 и не webm, окну не выдаётся: {}", video.display());
        return None;
    }
    if !video.is_file() {
        return None;
    }
    if let Err(e) = app.asset_protocol_scope().allow_file(video) {
        log::warn!("[art] окну не разрешить видео: {e}");
        return None;
    }
    Some(video.clone())
}

/// Потолок размера картинки магазина. Тот же, что у картинок хаба, пока обмер
/// живых картинок магазинов не покажет, что его мало.
pub const MAX_STORE_ART_BYTES: u64 = crate::images::MAX_IMAGE_BYTES;

/// Адрес большой картинки Steam для игры — или `None`, если галочка выключена,
/// игра не из Steam или картинка библиотеки лежит в старой раскладке кеша.
fn steam_big_hero_url(game: &Game, ctx: &ArtContext) -> Option<String> {
    if !ctx.store_art {
        return None;
    }
    let Some(StoreRef::Steam { appid }) = ctx.store_of(game) else {
        return None;
    };
    let hero = crate::storeart::steam_hero(&ctx.steam_roots, appid)?;
    crate::storeart::steam_hero_2x_url(&hero, appid)
}

/// Адреса картинок магазинов, которых ещё нет в кеше фонов: картинки Epic и
/// большие картинки Steam. Без сети и без окна — ради тестов.
pub fn pending_store_downloads(games: &[Game], ctx: &ArtContext, dir: &Path) -> Vec<String> {
    let mut urls: Vec<String> = games
        .iter()
        .filter_map(|g| epic_image_url(g, ctx).or_else(|| steam_big_hero_url(g, ctx)))
        .filter(|url| crate::images::cached(dir, url).is_none())
        .collect();
    urls.sort();
    urls.dedup();
    urls
}

/// Докачка картинок магазинов за время работы приложения.
#[derive(Debug, Default)]
pub struct DownloadState {
    /// Поток докачки уже работает — второй не запускается.
    running: bool,
    /// Адреса, которые уже пробовали скачать. Неудачный до следующего запуска
    /// не повторяется, иначе без сети каждое построение списка шло бы в сеть.
    tried: HashSet<String>,
    /// О нечитаемом каталоге Epic журнал уже знает.
    catalog_reported: bool,
}

/// Состояние докачки, которое хранит Tauri (`manage`).
#[derive(Debug, Default)]
pub struct StoreArtDownloads(pub Mutex<DownloadState>);

/// Отдаёт под докачку новые адреса, если поток свободен, и сразу запоминает их
/// как опробованные. `None` — докачка уже идёт, либо добавить нечего.
pub fn claim(state: &mut DownloadState, pending: Vec<String>) -> Option<Vec<String>> {
    if state.running {
        return None;
    }
    let fresh: Vec<String> =
        pending.into_iter().filter(|url| !state.tried.contains(url)).collect();
    if fresh.is_empty() {
        return None;
    }
    state.tried.extend(fresh.iter().cloned());
    state.running = true;
    Some(fresh)
}

/// Докачка в потоке закончилась — следующий вызов `claim` может начать новую.
pub fn finish(state: &mut DownloadState) {
    state.running = false;
}

/// Забывает опробованные адреса: после очистки кеша неудачный раньше адрес
/// можно попробовать снова.
pub fn forget_tried(state: &mut DownloadState) {
    state.tried.clear();
}

/// Забывает один опробованный адрес: удачно скачанный не должен оставаться
/// закрытым, иначе пропавший с диска файл до следующего запуска не докачался бы.
pub fn forget(state: &mut DownloadState, url: &str) {
    state.tried.remove(url);
}

/// Правда только в первый раз за время работы приложения — дальше о
/// нечитаемом каталоге Epic в журнал больше не пишем.
pub fn report_catalog_once(state: &mut DownloadState) -> bool {
    if state.catalog_reported {
        return false;
    }
    state.catalog_reported = true;
    true
}

/// Докачивает недостающие картинки магазинов в отдельном потоке: картинки Epic и
/// большие картинки Steam.
///
/// Вызывается при каждом построении списка игр, поэтому одна дорога покрывает
/// запуск, первый запуск, поиск установленных игр, ручное добавление, включение
/// галочки и очистку кеша. Окно докачку не ждёт. Отказ по одной картинке пишется
/// в журнал и не мешает остальным.
pub fn start_missing_downloads(app: &AppHandle, games: &[Game], ctx: &ArtContext) {
    if ctx.epic_catalog_unreadable() {
        let should_log = {
            let state = app.state::<StoreArtDownloads>();
            let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
            report_catalog_once(&mut state)
        };
        if should_log {
            log::warn!("[art] каталог Epic не прочитан, картинок Epic не будет");
        }
    }
    // Отказ уже разобран в `resolve`: здесь просто нечего качать без папки.
    let Ok(dir) = cache_dir(app) else { return };
    let pending = pending_store_downloads(games, ctx, &dir);
    let claimed = {
        let state = app.state::<StoreArtDownloads>();
        let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
        claim(&mut state, pending)
    };
    let Some(urls) = claimed else { return };

    let app = app.clone();
    std::thread::spawn(move || {
        let mut done = 0;
        for url in urls {
            match crate::images::fetch_into(&dir, &url, MAX_STORE_ART_BYTES) {
                Ok(_) => done += 1,
                Err(e) => log::warn!("[art] картинка магазина не скачалась: {e}"),
            }
        }
        {
            let state = app.state::<StoreArtDownloads>();
            let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
            finish(&mut state);
        }
        if done > 0 {
            if let Err(e) = app.emit("games-changed", ()) {
                log::warn!("[art] окно не узнало о новых фонах: {e}");
            }
        }
    });
}

/// После очистки кеша картинки скачиваются заново, в том числе те, что не
/// скачались раньше.
pub fn forget_tried_downloads(app: &AppHandle) {
    let state = app.state::<StoreArtDownloads>();
    let mut state = state.0.lock().unwrap_or_else(|e| e.into_inner());
    forget_tried(&mut state);
}

/// Картинка магазина, уже лежащая в кеше фонов.
///
/// Картинка Steam с диска копируется сюда сразу: это чтение с диска. Большая
/// картинка Steam и картинка Epic здесь только ищутся в кеше — их докачивает
/// поток, который запускает построение списка игр, и окно список игр не ждёт.
/// Скачанная большая картинка Steam заменяет картинку с диска.
fn store_picture(dir: &Path, game: &Game, ctx: &ArtContext) -> Option<Provided> {
    if !ctx.store_art {
        return None;
    }
    match ctx.store_of(game)? {
        StoreRef::Steam { appid } => {
            let hero = crate::storeart::steam_hero(&ctx.steam_roots, appid)?;
            let big = crate::storeart::steam_hero_2x_url(&hero, appid)
                .and_then(|url| crate::images::cached(dir, &url));
            big.or_else(|| crate::localcopy::copy_into(dir, &hero, "steam-"))
                .map(|p| Provided::picture(ArtSource::Steam, p))
        }
        StoreRef::Epic { .. } => {
            let url = epic_image_url(game, ctx)?;
            crate::images::cached(dir, &url).map(|p| Provided::picture(ArtSource::Epic, p))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    fn epic_game(id: &str) -> Game {
        let mut g = Game::manual(id.into(), id.into());
        g.launch = crate::config::Launch::Epic {
            namespace: "ns".into(),
            catalog_item_id: id.into(),
            app_name: "app".into(),
        };
        g
    }

    fn two_game_catalog() -> serde_json::Value {
        serde_json::json!([
            { "id": "a", "keyImages": [{ "type": "DieselGameBox", "url": "https://cdn1.epicgames.com/a.jpg" }] },
            { "id": "b", "keyImages": [{ "type": "DieselGameBox", "url": "https://cdn1.epicgames.com/b.jpg" }] }
        ])
    }

    fn scratch(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("gh-art-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn only_missing_epic_pictures_are_queued() {
        let dir = scratch("pending");
        let a = "https://cdn1.epicgames.com/a.jpg";
        std::fs::write(dir.join(crate::images::file_name_for(a, "jpg")), b"jpg").unwrap();
        let ctx = ArtContext::for_test(true, Vec::new(), Some(two_game_catalog()));
        let games = [epic_game("a"), epic_game("b")];
        assert_eq!(
            pending_store_downloads(&games, &ctx, &dir),
            vec!["https://cdn1.epicgames.com/b.jpg".to_string()]
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_is_queued_with_the_switch_off() {
        let dir = scratch("off");
        let ctx = ArtContext::for_test(false, Vec::new(), Some(two_game_catalog()));
        assert!(pending_store_downloads(&[epic_game("a")], &ctx, &dir).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_same_picture_is_queued_once() {
        let dir = scratch("dedup");
        let ctx = ArtContext::for_test(true, Vec::new(), Some(two_game_catalog()));
        let games = [epic_game("a"), epic_game("a")];
        assert_eq!(pending_store_downloads(&games, &ctx, &dir).len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_own_video_comes_first_and_keeps_the_picture_as_its_still() {
        let chosen = choose(Some(p("v.mp4")), Some(p("pic.img")), Some(Provided::picture(ArtSource::Steam, p("steam.img"))));
        assert_eq!(chosen.source, ArtSource::Video);
        assert_eq!(chosen.video_path, Some(p("v.mp4")));
        assert_eq!(chosen.art_path, Some(p("pic.img")), "картинка остаётся неподвижным кадром");
    }

    #[test]
    fn a_video_over_store_art_uses_it_as_the_still() {
        let chosen = choose(Some(p("v.mp4")), None, Some(Provided::picture(ArtSource::Epic, p("epic.jpg"))));
        assert_eq!(chosen.source, ArtSource::Video);
        assert_eq!(chosen.art_path, Some(p("epic.jpg")));
    }

    #[test]
    fn an_own_picture_beats_the_store() {
        let chosen = choose(None, Some(p("pic.img")), Some(Provided::picture(ArtSource::Steam, p("steam.img"))));
        assert_eq!(chosen.source, ArtSource::Picture);
        assert_eq!(chosen.art_path, Some(p("pic.img")));
    }

    #[test]
    fn store_art_is_used_when_nothing_own_is_set() {
        let chosen = choose(None, None, Some(Provided::picture(ArtSource::Epic, p("epic.jpg"))));
        assert_eq!(chosen.source, ArtSource::Epic);
        assert_eq!(chosen.art_path, Some(p("epic.jpg")));
        assert_eq!(chosen.video_path, None);
    }

    #[test]
    fn nothing_at_all_means_the_fill() {
        assert_eq!(
            choose(None, None, None),
            Chosen { source: ArtSource::Fill, art_path: None, video_path: None }
        );
    }

    #[test]
    fn the_official_background_plays_its_video_over_its_picture() {
        let chosen = choose(None, None, Some(Provided { source: ArtSource::HoYoPlay, picture: Some(p("hyp.webp")), video: Some(p("hyp.webm")) }));
        assert_eq!(chosen, Chosen { source: ArtSource::HoYoPlay, art_path: Some(p("hyp.webp")), video_path: Some(p("hyp.webm")) });
    }

    #[test]
    fn an_own_picture_hides_the_official_video_too() {
        let chosen = choose(None, Some(p("pic.img")), Some(Provided { source: ArtSource::HoYoPlay, picture: Some(p("hyp.webp")), video: Some(p("hyp.webm")) }));
        assert_eq!(chosen, Chosen { source: ArtSource::Picture, art_path: Some(p("pic.img")), video_path: None });
    }

    #[test]
    fn an_own_video_keeps_the_official_picture_as_its_still() {
        let chosen = choose(Some(p("v.mp4")), None, Some(Provided { source: ArtSource::HoYoPlay, picture: Some(p("hyp.webp")), video: Some(p("hyp.webm")) }));
        assert_eq!(chosen, Chosen { source: ArtSource::Video, art_path: Some(p("hyp.webp")), video_path: Some(p("v.mp4")) });
    }

    fn hub_game(id: &str, image: &str, video: Option<&str>) -> crate::hub::schema::HubGame {
        crate::hub::schema::HubGame {
            id: id.into(),
            background: Some(crate::hub::schema::GameBackground { image: image.into(), video: video.map(Into::into) }),
            ..Default::default()
        }
    }

    #[test]
    fn the_official_background_is_looked_up_by_content_id_and_beats_the_store() {
        let dir = scratch("launcher-pick");
        let img = "https://x.test/zzz.webp";
        let vid = "https://x.test/zzz.webm";
        std::fs::write(dir.join(crate::images::file_name_for(img, "webp")), b"x").unwrap();
        std::fs::write(dir.join(crate::images::file_name_for(vid, "webm")), b"x").unwrap();
        let mut game = epic_game("zzz");
        game.content_id = Some("zzz".into());
        let hub_games = vec![hub_game("zzz", img, Some(vid))];
        let ctx = ArtContext::for_test(true, Vec::new(), Some(two_game_catalog())).with_launcher(&hub_games);
        let picked = launcher_backdrop(&dir, &game, &ctx).expect("официальный фон");
        assert_eq!(picked.source, ArtSource::HoYoPlay);
        assert_eq!(picked.picture, Some(dir.join(crate::images::file_name_for(img, "webp"))));
        assert_eq!(picked.video, Some(dir.join(crate::images::file_name_for(vid, "webm"))));
        assert_eq!(ctx.launcher_urls(&[game.clone()]), vec![img.to_string(), vid.to_string()]);
        let off = ArtContext::for_test(false, Vec::new(), None).with_launcher(&hub_games);
        assert!(launcher_backdrop(&dir, &game, &off).is_none(), "галочка выключена");
        assert!(off.launcher_urls(&[game]).is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_downloaded_yet_falls_through() {
        let dir = scratch("launcher-empty");
        let mut game = epic_game("zzz");
        game.content_id = Some("zzz".into());
        let hub_games = vec![hub_game("zzz", "https://x.test/zzz.webp", None)];
        let ctx = ArtContext::for_test(true, Vec::new(), None).with_launcher(&hub_games);
        assert!(launcher_backdrop(&dir, &game, &ctx).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_launcher_art_is_only_looked_for_games_that_have_it() {
        let hub_games = vec![hub_game("zzz", "https://x.test/zzz.webp", None)];
        let ctx = ArtContext::for_test(true, Vec::new(), None).with_launcher(&hub_games);
        let mut known = epic_game("zzz");
        known.content_id = Some("zzz".into());
        let mut other = epic_game("a");
        other.content_id = Some("a".into());
        assert!(ctx.has_launcher_art(&known));
        assert!(!ctx.has_launcher_art(&other), "в хабе нет фона этой игры");
        assert!(!ctx.has_launcher_art(&epic_game("zzz")), "нет content_id");
        let off = ArtContext::for_test(false, Vec::new(), None).with_launcher(&hub_games);
        assert!(!off.has_launcher_art(&known), "галочка выключена");
    }

    fn official(picture: Option<&str>, video: Option<&str>) -> Provided {
        Provided { source: ArtSource::HoYoPlay, picture: picture.map(p), video: video.map(p) }
    }

    #[test]
    fn an_official_picture_is_kept_and_the_store_is_not_asked() {
        let got = with_still(Some(official(Some("hyp.webp"), Some("hyp.webm"))), || {
            panic!("магазин не должен спрашиваться")
        });
        assert_eq!(got, Some(official(Some("hyp.webp"), Some("hyp.webm"))));
    }

    #[test]
    fn an_official_video_alone_takes_the_store_picture_as_its_still() {
        let got = with_still(Some(official(None, Some("hyp.webm"))), || {
            Some(Provided::picture(ArtSource::Epic, p("epic.jpg")))
        });
        assert_eq!(got, Some(official(Some("epic.jpg"), Some("hyp.webm"))), "источник остаётся официальным");
        let chosen = choose(None, None, got);
        assert_eq!(
            chosen,
            Chosen { source: ArtSource::HoYoPlay, art_path: Some(p("epic.jpg")), video_path: Some(p("hyp.webm")) }
        );
    }

    #[test]
    fn an_official_video_alone_stays_alone_when_the_store_has_nothing() {
        assert_eq!(
            with_still(Some(official(None, Some("hyp.webm"))), || None),
            Some(official(None, Some("hyp.webm")))
        );
    }

    #[test]
    fn without_an_official_background_the_store_decides() {
        assert_eq!(
            with_still(None, || Some(Provided::picture(ArtSource::Steam, p("steam.img")))),
            Some(Provided::picture(ArtSource::Steam, p("steam.img")))
        );
        assert_eq!(with_still(None, || None), None);
    }

    #[test]
    fn the_source_is_sent_in_lowercase() {
        assert_eq!(serde_json::to_string(&ArtSource::Epic).unwrap(), "\"epic\"");
        assert_eq!(serde_json::to_string(&ArtSource::Picture).unwrap(), "\"picture\"");
        assert_eq!(serde_json::to_string(&ArtSource::HoYoPlay).unwrap(), "\"hoyoplay\"");
    }

    #[test]
    fn with_the_switch_off_no_epic_address_is_given() {
        let mut g = Game::manual("e".into(), "E".into());
        g.launch = crate::config::Launch::Epic {
            namespace: "ns".into(),
            catalog_item_id: "a".into(),
            app_name: "app".into(),
        };
        let catalog = serde_json::json!([
            { "id": "a", "keyImages": [{ "type": "DieselGameBox", "url": "https://cdn1.epicgames.com/a.jpg" }] }
        ]);
        let on = ArtContext::for_test(true, Vec::new(), Some(catalog.clone()));
        assert_eq!(epic_image_url(&g, &on), Some("https://cdn1.epicgames.com/a.jpg".into()));
        let off = ArtContext::for_test(false, Vec::new(), Some(catalog));
        assert_eq!(epic_image_url(&g, &off), None);
    }

    #[test]
    fn claim_hands_out_each_new_address_once() {
        let mut state = DownloadState::default();
        assert_eq!(
            claim(&mut state, vec!["a".to_string(), "b".to_string()]),
            Some(vec!["a".to_string(), "b".to_string()])
        );
        assert_eq!(claim(&mut state, vec!["c".to_string()]), None, "поток уже работает");
        finish(&mut state);
        assert_eq!(
            claim(&mut state, vec!["a".to_string(), "b".to_string()]),
            None,
            "оба адреса уже пробовали"
        );
        assert_eq!(
            claim(&mut state, vec!["a".to_string(), "c".to_string()]),
            Some(vec!["c".to_string()])
        );
    }

    #[test]
    fn claim_with_nothing_new_leaves_the_worker_stopped() {
        let mut state = DownloadState::default();
        assert_eq!(claim(&mut state, Vec::new()), None);
        assert_eq!(claim(&mut state, vec!["a".to_string()]), Some(vec!["a".to_string()]));
        finish(&mut state);
        assert_eq!(claim(&mut state, vec!["a".to_string()]), None);
        assert_eq!(claim(&mut state, vec!["b".to_string()]), Some(vec!["b".to_string()]));
    }

    #[test]
    fn forgetting_tried_addresses_allows_a_new_try() {
        let mut state = DownloadState::default();
        assert_eq!(claim(&mut state, vec!["a".to_string()]), Some(vec!["a".to_string()]));
        finish(&mut state);
        forget_tried(&mut state);
        assert_eq!(claim(&mut state, vec!["a".to_string()]), Some(vec!["a".to_string()]));
    }

    #[test]
    fn forgetting_one_address_lets_only_it_be_tried_again() {
        let mut state = DownloadState::default();
        assert_eq!(
            claim(&mut state, vec!["a".to_string(), "b".to_string()]),
            Some(vec!["a".to_string(), "b".to_string()])
        );
        finish(&mut state);
        forget(&mut state, "a");
        assert_eq!(
            claim(&mut state, vec!["a".to_string(), "b".to_string()]),
            Some(vec!["a".to_string()]),
            "забытый адрес снова доступен, а неудачный b по-прежнему закрыт"
        );
    }

    #[test]
    fn forgetting_an_unknown_address_changes_nothing() {
        let mut state = DownloadState::default();
        forget(&mut state, "never-tried");
        assert_eq!(claim(&mut state, vec!["a".to_string()]), Some(vec!["a".to_string()]));
    }

    #[test]
    fn an_unreadable_catalog_is_reported_once() {
        let mut state = DownloadState::default();
        assert!(report_catalog_once(&mut state));
        assert!(!report_catalog_once(&mut state));
    }

    const HASH: &str = "de0f5fcf72849ff1ba2aa8603e64dd42ba7f380d";

    fn steam_game(appid: u32) -> Game {
        let mut g = Game::manual("s".into(), "S".into());
        g.launch = crate::config::Launch::Steam { appid };
        g
    }

    /// Папка Steam, где у игры лежит картинка библиотеки в новой раскладке кеша.
    fn steam_root_with_hero(tag: &str, appid: u32) -> PathBuf {
        let root = scratch(tag);
        let folder = root
            .join("appcache")
            .join("librarycache")
            .join(appid.to_string())
            .join(HASH);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("library_hero.jpg"), b"small").unwrap();
        root
    }

    fn big_hero_url(appid: u32) -> String {
        format!(
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/{HASH}/library_hero_2x.jpg"
        )
    }

    #[test]
    fn a_missing_big_steam_picture_is_queued_until_it_is_cached() {
        let root = steam_root_with_hero("steam-root-queue", 7);
        let dir = scratch("steam-dir-queue");
        let ctx = ArtContext::for_test(true, Vec::new(), None).with_steam_roots(vec![root.clone()]);
        assert_eq!(pending_store_downloads(&[steam_game(7)], &ctx, &dir), vec![big_hero_url(7)]);
        std::fs::write(dir.join(crate::images::file_name_for(&big_hero_url(7), "jpg")), b"big")
            .unwrap();
        assert!(pending_store_downloads(&[steam_game(7)], &ctx, &dir).is_empty(), "уже в кеше");
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_big_steam_picture_is_queued_with_the_switch_off() {
        let root = steam_root_with_hero("steam-root-off", 7);
        let dir = scratch("steam-dir-off");
        let ctx = ArtContext::for_test(false, Vec::new(), None).with_steam_roots(vec![root.clone()]);
        assert!(pending_store_downloads(&[steam_game(7)], &ctx, &dir).is_empty());
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_big_steam_picture_replaces_the_small_one_once_downloaded() {
        let root = steam_root_with_hero("steam-root-show", 7);
        let dir = scratch("steam-dir-show");
        let ctx = ArtContext::for_test(true, Vec::new(), None).with_steam_roots(vec![root.clone()]);
        let small = store_picture(&dir, &steam_game(7), &ctx).unwrap();
        assert_eq!(small.source, ArtSource::Steam);
        let small = small.picture.unwrap();
        assert_eq!(std::fs::read(&small).unwrap(), b"small", "пока большой нет — картинка с диска");
        let big = dir.join(crate::images::file_name_for(&big_hero_url(7), "jpg"));
        std::fs::write(&big, b"big").unwrap();
        assert_eq!(store_picture(&dir, &steam_game(7), &ctx), Some(Provided::picture(ArtSource::Steam, big)));
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_mp4_and_webm_are_videos() {
        assert!(is_video_file_name(Path::new("a.mp4")));
        assert!(is_video_file_name(Path::new("B.WEBM")));
        assert!(!is_video_file_name(Path::new("c.mkv")));
        assert!(!is_video_file_name(Path::new("d.mp4.exe")));
        assert!(!is_video_file_name(Path::new("noext")));
        assert!(!is_video_file_name(Path::new("e.jpg")));
    }

    #[test]
    fn video_file_problem_flags_the_wrong_extension() {
        let dir = scratch("video-ext");
        let file = dir.join("clip.txt");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(video_file_problem(&file), Some(AppError::new(code::VIDEO_WRONG_FORMAT)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn video_file_problem_flags_a_missing_file() {
        let dir = scratch("video-missing");
        let file = dir.join("nope.mp4");
        assert_eq!(video_file_problem(&file), Some(AppError::new(code::VIDEO_FILE_MISSING)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn video_file_problem_accepts_a_small_real_file() {
        let dir = scratch("video-ok");
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"tiny").unwrap();
        assert_eq!(video_file_problem(&file), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn exceeds_video_limit_is_false_exactly_at_the_ceiling() {
        assert!(!exceeds_video_limit(MAX_VIDEO_BYTES));
    }

    #[test]
    fn exceeds_video_limit_is_true_one_byte_over() {
        assert!(exceeds_video_limit(MAX_VIDEO_BYTES + 1));
    }
}
