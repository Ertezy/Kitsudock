//! Игры, поставленные через собственные лаунчеры: HoYoPlay, лаунчер Kuro
//! (Wuthering Waves) и GRYPHLINK (Arknights: Endfield).
//!
//! У этих лаунчеров нет манифестов, как у Steam и Epic, зато они пишут путь
//! установки в реестр Windows (а Kuro и GRYPHLINK ещё и кладут игру в папку по
//! умолчанию). Реестр читается через маленький трейт, чтобы искатели проверялись
//! на таблице в памяти, а не на чужом компьютере: настоящая реализация — winreg
//! под `#[cfg(windows)]`, как в `steam.rs`.
//!
//! Найденная игра запускается напрямую: `Launch::Exe` плюс `exe_path`, ровно как
//! игра, добавленная вручную. Сам лаунчер (`LauncherPaths`) — ещё один способ
//! запуска на выбор человека: его ищут тем же реестром, только при запуске и
//! при построении списка игр, а в конфиг путь не пишется — лаунчер могут
//! переставить или удалить. Предлагается он только игре, которую сам и
//! поставил: копию из магазина он не знает.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{InstalledGame, Launch, Source};

/// Куст реестра.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Root {
    CurrentUser,
    LocalMachine,
}

/// То, что нужно искателям от реестра. Настоящая реализация — winreg, в тестах —
/// таблица в памяти.
pub trait Registry {
    /// Имена подразделов; пусто, если раздела нет.
    fn subkeys(&self, root: Root, path: &str) -> Vec<String>;
    /// Строковое значение; `None`, если его нет.
    fn value(&self, root: Root, path: &str, name: &str) -> Option<String>;
}

/// Разделы «Установка и удаление программ»: 64-битный и 32-битный вид машины и
/// раздел пользователя. Kuro и GRYPHLINK записываются в любой из них — смотря
/// как их поставили.
const UNINSTALL_ROOTS: [(Root, &str); 3] = [
    (Root::LocalMachine, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    (Root::LocalMachine, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
    (Root::CurrentUser, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
];

/// Где HoYoPlay хранит установленные игры: глобальная и китайская редакции.
const HOYOPLAY_ROOTS: [&str; 2] = [r"Software\Cognosphere\HYP", r"Software\miHoYo\HYP"];

/// Ключ игры в HoYoPlay → название и исполняемый файл. Глобальная и китайская
/// редакции называют файл по-разному только у Genshin Impact.
const HOYOPLAY_GAMES: [(&str, &str, &str); 6] = [
    ("hk4e_global", "Genshin Impact", "GenshinImpact.exe"),
    ("hk4e_cn", "Genshin Impact", "YuanShen.exe"),
    ("hkrpg_global", "Honkai: Star Rail", "StarRail.exe"),
    ("hkrpg_cn", "Honkai: Star Rail", "StarRail.exe"),
    ("nap_global", "Zenless Zone Zero", "ZenlessZoneZero.exe"),
    ("nap_cn", "Zenless Zone Zero", "ZenlessZoneZero.exe"),
];

const HOYOPLAY_LABEL: &str = "HoYoPlay";

const KURO_TITLE: &str = "Wuthering Waves";
const KURO_LABEL: &str = "лаунчер Kuro";
/// Имя раздела удаления у Kuro начинается так: за ним идёт редакция игры
/// («Overseas», «China»).
const KURO_KEY_PREFIX: &str = "KRInstall Wuthering Waves";

const GRYPHLINK_TITLE: &str = "Arknights: Endfield";
const GRYPHLINK_NAME: &str = "GRYPHLINK";

/// Подраздел вида `1_0`, `1_2`: две группы цифр через подчёркивание. Так HoYoPlay
/// называет версию своих настроек; `standalone` и прочее под это не подходит.
fn is_version_key(name: &str) -> bool {
    let mut parts = name.split('_');
    let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
    digits(a) && digits(b)
}

/// Значение без пробелов и кавычек по краям; пустое — как отсутствующее.
fn text(value: Option<String>) -> Option<String> {
    let value = value?;
    let value = value.trim().trim_matches('"').trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// Папка исполняемого файла из командной строки вроде
/// `"C:\Games\Kuro\unins000.exe" /SILENT` или `C:\Games\Kuro\unins000.exe /S`.
fn folder_of_command(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    let exe = if let Some(rest) = command.strip_prefix('"') {
        rest.split('"').next().unwrap_or(rest)
    } else {
        // Без кавычек аргументы отделены пробелом, а сам путь может его
        // содержать («C:\Program Files\…»), поэтому режем по «.exe», а не по
        // первому пробелу.
        match command.to_ascii_lowercase().find(".exe") {
            Some(at) => &command[..at + ".exe".len()],
            None => command,
        }
    };
    Path::new(exe.trim())
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
}

/// Записи из разделов удаления: куст, полный путь к записи и её имя.
fn uninstall_entries(reg: &dyn Registry) -> Vec<(Root, String, String)> {
    let mut out = Vec::new();
    for (root, path) in UNINSTALL_ROOTS {
        for name in reg.subkeys(root, path) {
            out.push((root, format!(r"{path}\{name}"), name));
        }
    }
    out
}

/// Папка установки из записи удаления: первое непустое из перечисленных
/// значений, а если их нет — папка программы удаления.
///
/// Командная строка уходит в `folder_of_command` как есть, без `text()`: та
/// снимает кавычку в начале, и путь в кавычках разбирался бы как путь без
/// кавычек — по подстроке «.exe», которая может оказаться в имени папки.
fn install_dir(reg: &dyn Registry, root: Root, key: &str, names: &[&str]) -> Option<PathBuf> {
    names
        .iter()
        .find_map(|name| text(reg.value(root, key, name)).map(PathBuf::from))
        .or_else(|| {
            reg.value(root, key, "UninstallString")
                .and_then(|c| folder_of_command(&c))
        })
}

fn same_path(a: &Path, b: &Path) -> bool {
    super::is_inside(a, b) && super::is_inside(b, a)
}

/// Как лаунчер называется в журнале: «найдена через …» пишет `stores::merge_finds`,
/// когда находка остаётся в списке.
pub fn label(source: Source) -> &'static str {
    match source {
        Source::Steam => "Steam",
        Source::Epic => "Epic Games",
        Source::HoYoPlay => HOYOPLAY_LABEL,
        Source::Kuro => KURO_LABEL,
        Source::Gryphlink => GRYPHLINK_NAME,
    }
}

/// Добавляет находку, если такого exe в списке ещё нет: одну папку могут
/// назвать и реестр, и список папок по умолчанию. В журнал находка здесь не
/// попадает: её могут отбросить как повтор магазина, и «найдена» было бы неправдой.
fn push_find(found: &mut Vec<InstalledGame>, title: &str, source: Source, exe: PathBuf) {
    if found
        .iter()
        .any(|g| g.exe_path.as_deref().is_some_and(|e| same_path(e, &exe)))
    {
        return;
    }
    found.push(InstalledGame {
        title: title.to_string(),
        install_path: exe.parent().map(Path::to_path_buf).unwrap_or_default(),
        exe_path: Some(exe),
        launch: Launch::Exe,
        source,
    });
}

/// Первый существующий файл из кандидатов; промахи пишутся в отладочный лог.
fn first_existing(launcher: &str, candidates: Vec<PathBuf>) -> Option<PathBuf> {
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
        log::debug!("[launchers] {launcher}: файла нет, {}", candidate.display());
    }
    None
}

/// Папки без повторов, порядок сохраняется.
fn unique_dirs(dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if !out.iter().any(|d| same_path(d, &dir)) {
            out.push(dir);
        }
    }
    out
}

/// HoYoPlay: `<HYP>\<версия>\<игра>\GameInstallPath`. Пустой путь или нет
/// файла игры в папке — игры нет (её удалили, а ключ остался).
pub fn hoyoplay(reg: &dyn Registry) -> Vec<InstalledGame> {
    let mut found = Vec::new();
    for hyp in HOYOPLAY_ROOTS {
        for version in reg.subkeys(Root::CurrentUser, hyp) {
            if !is_version_key(&version) {
                continue;
            }
            let version_key = format!(r"{hyp}\{version}");
            for biz in reg.subkeys(Root::CurrentUser, &version_key) {
                let Some(&(_, title, exe_name)) = HOYOPLAY_GAMES
                    .iter()
                    .find(|(known, _, _)| known.eq_ignore_ascii_case(&biz))
                else {
                    log::debug!("[launchers] HoYoPlay: неизвестная игра {biz} ({version_key})");
                    continue;
                };
                let key = format!(r"{version_key}\{biz}");
                let Some(dir) = text(reg.value(Root::CurrentUser, &key, "GameInstallPath")) else {
                    log::debug!("[launchers] HoYoPlay: {title} — путь установки пуст ({key})");
                    continue;
                };
                if let Some(exe) =
                    first_existing(HOYOPLAY_LABEL, vec![Path::new(&dir).join(exe_name)])
                {
                    push_find(&mut found, title, Source::HoYoPlay, exe);
                }
            }
        }
    }
    found
}

/// Лаунчер Kuro: записи удаления `KRInstall Wuthering Waves…` и папки по
/// умолчанию. В каждой папке игра лежит либо во вложенной `Wuthering Waves Game`,
/// либо рядом с лаунчером — берётся первое из существующих.
pub fn kuro(reg: &dyn Registry, default_dirs: &[PathBuf]) -> Vec<InstalledGame> {
    let mut dirs = Vec::new();
    for (root, key, name) in uninstall_entries(reg) {
        if !name.to_lowercase().starts_with(&KURO_KEY_PREFIX.to_lowercase()) {
            continue;
        }
        match install_dir(reg, root, &key, &["InstallPath", "InstallLocation"]) {
            Some(dir) => dirs.push(dir),
            None => log::debug!("[launchers] Kuro: в записи {key} нет папки установки"),
        }
    }
    dirs.extend_from_slice(default_dirs);

    let mut found = Vec::new();
    for dir in unique_dirs(dirs) {
        let candidates = vec![
            dir.join("Wuthering Waves Game").join("Wuthering Waves.exe"),
            dir.join("Wuthering Waves.exe"),
        ];
        if let Some(exe) = first_existing(KURO_LABEL, candidates) {
            push_find(&mut found, KURO_TITLE, Source::Kuro, exe);
        }
    }
    found
}

/// GRYPHLINK: записи удаления с этим именем и папка по умолчанию. Запускается
/// сам лаунчер, где он хранит игру — публично не описано.
pub fn gryphlink(reg: &dyn Registry, default_dirs: &[PathBuf]) -> Vec<InstalledGame> {
    let mut dirs = Vec::new();
    for (root, key, _) in uninstall_entries(reg) {
        let is_gryphlink = text(reg.value(root, &key, "DisplayName"))
            .is_some_and(|n| n.to_lowercase().contains(&GRYPHLINK_NAME.to_lowercase()));
        if !is_gryphlink {
            continue;
        }
        match install_dir(reg, root, &key, &["InstallLocation"]) {
            Some(dir) => dirs.push(dir),
            None => log::debug!("[launchers] GRYPHLINK: в записи {key} нет папки установки"),
        }
    }
    dirs.extend_from_slice(default_dirs);

    let mut found = Vec::new();
    for dir in unique_dirs(dirs) {
        if let Some(exe) = first_existing(GRYPHLINK_NAME, vec![dir.join("Launcher.exe")]) {
            push_find(&mut found, GRYPHLINK_TITLE, Source::Gryphlink, exe);
        }
    }
    found
}

/// Собственный лаунчер, через который можно открыть игру: человек жмёт
/// «Играть» уже в его окне. На проводе — словом (`"hoyoplay"`), подпись на языке
/// интерфейса подставляет страница.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Launcher {
    HoYoPlay,
    Kuro,
    Gryphlink,
}

/// Идентификатор игры в каталоге → её лаунчер.
const LAUNCHER_OF_CONTENT: [(&str, Launcher); 5] = [
    ("genshin", Launcher::HoYoPlay),
    ("hsr", Launcher::HoYoPlay),
    ("zzz", Launcher::HoYoPlay),
    ("wuthering", Launcher::Kuro),
    ("endfield", Launcher::Gryphlink),
];

impl Launcher {
    /// Лаунчер игры. Привязка к каталогу решает сама: игру могли переименовать.
    /// Без привязки — по названию, так же, как находки сверяются с магазинами
    /// (`catalog::normalize`).
    pub fn of_game(content_id: Option<&str>, title: &str) -> Option<Launcher> {
        if let Some(id) = content_id {
            return LAUNCHER_OF_CONTENT
                .iter()
                .find(|(known, _)| *known == id)
                .map(|&(_, launcher)| launcher);
        }
        let title = crate::catalog::normalize(title);
        let is = |known: &str| crate::catalog::normalize(known) == title;
        if HOYOPLAY_GAMES.iter().any(|(_, known, _)| is(known)) {
            Some(Launcher::HoYoPlay)
        } else if is(KURO_TITLE) {
            Some(Launcher::Kuro)
        } else if is(GRYPHLINK_TITLE) {
            Some(Launcher::Gryphlink)
        } else {
            None
        }
    }
}

/// Файл лаунчера HoYoPlay в папке из его ключа (`InstallPath`).
const HOYOPLAY_EXE: &str = "launcher.exe";
/// Файл лаунчера Kuro рядом с папкой игры `Wuthering Waves Game`.
const KURO_EXE: &str = "launcher.exe";
/// Файл GRYPHLINK — тот же, что запускает находка `gryphlink`.
const GRYPHLINK_EXE: &str = "Launcher.exe";

/// Лаунчер на компьютере и папки игр, которые он сам поставил. Предлагать его
/// можно только игре из этих папок: копию из магазина он не знает и показал
/// бы на её месте кнопку загрузки.
#[derive(Debug, Clone)]
pub struct KnownLauncher {
    pub exe: PathBuf,
    pub installs: Vec<PathBuf>,
}

/// HoYoPlay: `<HYP>\<версия>\InstallPath` — папка самого лаунчера, а под тем же
/// ключом `<игра>\GameInstallPath` — его установки. Пустой путь — игра в
/// лаунчере есть в списке, но не поставлена. Подраздел `standalone` — копии
/// из магазинов со встроенным лаунчером, не его установки.
fn hoyoplay_launchers(reg: &dyn Registry) -> Vec<KnownLauncher> {
    let mut found = Vec::new();
    for hyp in HOYOPLAY_ROOTS {
        for version in reg.subkeys(Root::CurrentUser, hyp) {
            if !is_version_key(&version) {
                continue;
            }
            let key = format!(r"{hyp}\{version}");
            let Some(dir) = text(reg.value(Root::CurrentUser, &key, "InstallPath")) else {
                continue;
            };
            let Some(exe) = first_existing(HOYOPLAY_LABEL, vec![Path::new(&dir).join(HOYOPLAY_EXE)]) else {
                continue;
            };
            let installs = reg
                .subkeys(Root::CurrentUser, &key)
                .into_iter()
                .filter(|biz| HOYOPLAY_GAMES.iter().any(|(known, _, _)| known.eq_ignore_ascii_case(biz)))
                .filter_map(|biz| {
                    text(reg.value(Root::CurrentUser, &format!(r"{key}\{biz}"), "GameInstallPath"))
                })
                .map(PathBuf::from)
                .collect();
            found.push(KnownLauncher { exe, installs });
        }
    }
    found
}

/// Лаунчер Kuro лежит в папке из записи удаления `KRInstall Wuthering Waves…`,
/// и его установка — эта же папка: игра в ней, как её находит `kuro`.
fn kuro_launchers(reg: &dyn Registry) -> Vec<KnownLauncher> {
    uninstall_entries(reg)
        .into_iter()
        .filter(|(_, _, name)| name.to_lowercase().starts_with(&KURO_KEY_PREFIX.to_lowercase()))
        .filter_map(|(root, key, _)| install_dir(reg, root, &key, &["InstallPath", "InstallLocation"]))
        .filter_map(|dir| {
            let exe = first_existing(KURO_LABEL, vec![dir.join(KURO_EXE)])?;
            Some(KnownLauncher { exe, installs: vec![dir] })
        })
        .collect()
}

/// GRYPHLINK — по записи удаления с этим именем, как и находка `gryphlink`.
/// Свой ключ `Software\GRYPHLINK` пути не хранит, а где лаунчер держит игру,
/// публично не описано: его установкой считается только то, что лежит в его
/// же папке.
fn gryphlink_launchers(reg: &dyn Registry) -> Vec<KnownLauncher> {
    uninstall_entries(reg)
        .into_iter()
        .filter(|(root, key, _)| {
            text(reg.value(*root, key, "DisplayName"))
                .is_some_and(|n| n.to_lowercase().contains(&GRYPHLINK_NAME.to_lowercase()))
        })
        .filter_map(|(root, key, _)| install_dir(reg, root, &key, &["InstallLocation"]))
        .filter_map(|dir| {
            let exe = first_existing(GRYPHLINK_NAME, vec![dir.join(GRYPHLINK_EXE)])?;
            Some(KnownLauncher { exe, installs: vec![dir] })
        })
        .collect()
}

/// Найденные лаунчеры: реестр читается один раз на весь список игр, а не на
/// каждую игру.
#[derive(Debug, Clone, Default)]
pub struct LauncherPaths {
    pub hoyoplay: Vec<KnownLauncher>,
    pub kuro: Vec<KnownLauncher>,
    pub gryphlink: Vec<KnownLauncher>,
}

impl LauncherPaths {
    /// Все три из данного реестра.
    pub fn read(reg: &dyn Registry) -> Self {
        Self {
            hoyoplay: hoyoplay_launchers(reg),
            kuro: kuro_launchers(reg),
            gryphlink: gryphlink_launchers(reg),
        }
    }

    /// Все три с настоящим реестром. Вне Windows лаунчеров нет.
    pub fn find() -> Self {
        #[cfg(windows)]
        {
            Self::read(&WinRegistry)
        }
        #[cfg(not(windows))]
        {
            Self::default()
        }
    }

    /// Лаунчер этой игры, если он стоит на компьютере и сам поставил именно
    /// эту её копию: файл игры (или её папка) лежит в одной из его установок.
    pub fn for_game(&self, game: &crate::config::Game) -> Option<(Launcher, &Path)> {
        let launcher = Launcher::of_game(game.content_id.as_deref(), &game.title)?;
        let own = game
            .exe_path
            .as_deref()
            .or(game.install_path.as_deref())
            .filter(|p| !p.as_os_str().is_empty())?;
        let known = match launcher {
            Launcher::HoYoPlay => &self.hoyoplay,
            Launcher::Kuro => &self.kuro,
            Launcher::Gryphlink => &self.gryphlink,
        };
        known
            .iter()
            .find(|l| l.installs.iter().any(|dir| super::is_inside(own, dir)))
            .map(|l| (launcher, l.exe.as_path()))
    }
}

/// Настоящий реестр Windows. Как и в `steam.rs`, ошибки открытия и чтения —
/// это «раздела или значения нет», а не сбой.
#[cfg(windows)]
struct WinRegistry;

#[cfg(windows)]
impl WinRegistry {
    fn open(root: Root, path: &str) -> Option<winreg::RegKey> {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        let hive = match root {
            Root::CurrentUser => HKEY_CURRENT_USER,
            Root::LocalMachine => HKEY_LOCAL_MACHINE,
        };
        winreg::RegKey::predef(hive).open_subkey(path).ok()
    }
}

#[cfg(windows)]
impl Registry for WinRegistry {
    fn subkeys(&self, root: Root, path: &str) -> Vec<String> {
        Self::open(root, path)
            .map(|key| key.enum_keys().flatten().collect())
            .unwrap_or_default()
    }

    fn value(&self, root: Root, path: &str, name: &str) -> Option<String> {
        Self::open(root, path)?.get_value::<String, _>(name).ok()
    }
}

/// Папка «Program Files» из переменной среды: Windows может стоять не на `C:`.
/// Нет переменной (или она пуста) — `C:\Program Files`, как в `steam.rs`.
#[cfg(windows)]
fn program_files(var: Option<std::ffi::OsString>) -> PathBuf {
    var.filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"))
}

/// Все три с настоящим реестром и папками по умолчанию. Вне Windows лаунчеров
/// нет — список пуст.
pub fn installed() -> Vec<InstalledGame> {
    #[cfg(windows)]
    {
        let reg = WinRegistry;
        let program_files = program_files(std::env::var_os("ProgramFiles"));
        let mut all = hoyoplay(&reg);
        all.extend(kuro(&reg, &[program_files.join("Wuthering Waves")]));
        all.extend(gryphlink(&reg, &[program_files.join("GRYPHLINK")]));
        all
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Реестр в памяти: ключ — корень и путь, значения — пары «имя → строка».
    /// Подразделы выводятся из путей, как в настоящем реестре, где промежуточный
    /// ключ существует, пока под ним что-то есть.
    type FakeKey = (Root, String, Vec<(String, String)>);

    #[derive(Default)]
    struct FakeRegistry {
        keys: Vec<FakeKey>,
    }

    impl FakeRegistry {
        fn with(mut self, root: Root, path: &str, values: &[(&str, &str)]) -> Self {
            let values = values
                .iter()
                .map(|(n, v)| (n.to_string(), v.to_string()))
                .collect();
            self.keys.push((root, path.to_string(), values));
            self
        }
    }

    impl Registry for FakeRegistry {
        fn subkeys(&self, root: Root, path: &str) -> Vec<String> {
            let prefix = format!("{}\\", path.to_lowercase());
            let mut out: Vec<String> = Vec::new();
            for (r, p, _) in &self.keys {
                if *r != root || !p.to_lowercase().starts_with(&prefix) {
                    continue;
                }
                let name = p[prefix.len()..].split('\\').next().unwrap().to_string();
                if !out.iter().any(|o| o.eq_ignore_ascii_case(&name)) {
                    out.push(name);
                }
            }
            out
        }

        fn value(&self, root: Root, path: &str, name: &str) -> Option<String> {
            self.keys
                .iter()
                .find(|(r, p, _)| *r == root && p.eq_ignore_ascii_case(path))
                .and_then(|(_, _, values)| {
                    values
                        .iter()
                        .find(|(n, _)| n.eq_ignore_ascii_case(name))
                        .map(|(_, v)| v.clone())
                })
        }
    }

    fn scratch(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("gh-launch-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Создаёт пустой файл (с промежуточными папками) и возвращает его путь.
    fn touch(dir: &Path, rel: &str) -> PathBuf {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, b"MZ").unwrap();
        p
    }

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    const UNINSTALL_HKLM: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    const UNINSTALL_WOW: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
    const UNINSTALL_HKCU: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    // ---------------------------------------------------------------- HoYoPlay

    #[test]
    fn hoyoplay_finds_global_genshin_impact() {
        let dir = scratch("hyp-genshin");
        let exe = touch(&dir, r"Genshin Impact game\GenshinImpact.exe");
        let reg = FakeRegistry::default().with(
            Root::CurrentUser,
            r"Software\Cognosphere\HYP\1_0\hk4e_global",
            &[("GameInstallPath", s(&dir.join("Genshin Impact game")))],
        );

        let found = hoyoplay(&reg);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "Genshin Impact");
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        assert_eq!(found[0].install_path, dir.join("Genshin Impact game"));
        assert_eq!(found[0].launch, Launch::Exe);
        assert_eq!(found[0].source, Source::HoYoPlay);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hoyoplay_knows_the_cn_and_the_other_games() {
        let dir = scratch("hyp-all");
        let yuanshen = touch(&dir, r"ys\YuanShen.exe");
        let rail_cn = touch(&dir, r"rail-cn\StarRail.exe");
        let rail_os = touch(&dir, r"rail-os\StarRail.exe");
        let zzz_cn = touch(&dir, r"zzz-cn\ZenlessZoneZero.exe");
        let zzz_os = touch(&dir, r"zzz-os\ZenlessZoneZero.exe");
        let cn = r"Software\miHoYo\HYP\1_2";
        let os = r"Software\Cognosphere\HYP\1_0";
        let path = |sub: &str| dir.join(sub).to_str().unwrap().to_string();
        let reg = FakeRegistry::default()
            .with(Root::CurrentUser, &format!(r"{cn}\hk4e_cn"), &[("GameInstallPath", &path("ys"))])
            .with(Root::CurrentUser, &format!(r"{cn}\hkrpg_cn"), &[("GameInstallPath", &path("rail-cn"))])
            .with(Root::CurrentUser, &format!(r"{os}\hkrpg_global"), &[("GameInstallPath", &path("rail-os"))])
            .with(Root::CurrentUser, &format!(r"{cn}\nap_cn"), &[("GameInstallPath", &path("zzz-cn"))])
            .with(Root::CurrentUser, &format!(r"{os}\nap_global"), &[("GameInstallPath", &path("zzz-os"))]);

        let mut found: Vec<(String, PathBuf)> = hoyoplay(&reg)
            .into_iter()
            .map(|g| {
                assert_eq!(g.source, Source::HoYoPlay);
                (g.title, g.exe_path.unwrap())
            })
            .collect();
        found.sort();

        assert_eq!(
            found,
            vec![
                ("Genshin Impact".to_string(), yuanshen),
                ("Honkai: Star Rail".to_string(), rail_cn),
                ("Honkai: Star Rail".to_string(), rail_os),
                ("Zenless Zone Zero".to_string(), zzz_cn),
                ("Zenless Zone Zero".to_string(), zzz_os),
            ]
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hoyoplay_skips_an_empty_install_path() {
        let reg = FakeRegistry::default()
            .with(
                Root::CurrentUser,
                r"Software\Cognosphere\HYP\1_0\hk4e_global",
                &[("GameInstallPath", "")],
            )
            .with(
                Root::CurrentUser,
                r"Software\Cognosphere\HYP\1_0\hkrpg_global",
                &[("GameInstallPath", "   ")],
            )
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0\nap_global", &[]);
        assert!(hoyoplay(&reg).is_empty());
    }

    #[test]
    fn hoyoplay_skips_a_folder_without_the_game_exe() {
        let dir = scratch("hyp-noexe");
        touch(&dir, r"game\readme.txt");
        // Чужой exe в папке не в счёт: нужен именно файл этой игры.
        touch(&dir, r"game\StarRail.exe");
        let reg = FakeRegistry::default().with(
            Root::CurrentUser,
            r"Software\Cognosphere\HYP\1_0\hk4e_global",
            &[("GameInstallPath", s(&dir.join("game")))],
        );
        assert!(hoyoplay(&reg).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hoyoplay_ignores_the_standalone_subtree() {
        // Встроенные в магазины лаунчеры уже находятся через Epic.
        let dir = scratch("hyp-standalone");
        touch(&dir, "GenshinImpact.exe");
        let reg = FakeRegistry::default().with(
            Root::CurrentUser,
            r"Software\Cognosphere\HYP\standalone\1_3\hk4e_global",
            &[("GameInstallPath", s(&dir))],
        );
        assert!(hoyoplay(&reg).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hoyoplay_ignores_unknown_games_and_keys_that_are_not_versions() {
        let dir = scratch("hyp-unknown");
        touch(&dir, "BH3.exe");
        touch(&dir, "GenshinImpact.exe");
        let reg = FakeRegistry::default()
            .with(
                Root::CurrentUser,
                r"Software\Cognosphere\HYP\1_0\bh3_global",
                &[("GameInstallPath", s(&dir))],
            )
            .with(
                Root::CurrentUser,
                r"Software\Cognosphere\HYP\beta\hk4e_global",
                &[("GameInstallPath", s(&dir))],
            );
        assert!(hoyoplay(&reg).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hoyoplay_with_no_registry_keys_finds_nothing() {
        assert!(hoyoplay(&FakeRegistry::default()).is_empty());
    }

    // -------------------------------------------------------------------- Kuro

    fn kuro_key(root_path: &str, name: &str) -> String {
        format!(r"{root_path}\{name}")
    }

    #[test]
    fn kuro_finds_the_game_in_the_nested_folder() {
        let dir = scratch("kuro-nested");
        let exe = touch(&dir, r"Wuthering Waves Game\Wuthering Waves.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("InstallPath", s(&dir))],
        );

        let found = kuro(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "Wuthering Waves");
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        assert_eq!(found[0].install_path, dir.join("Wuthering Waves Game"));
        assert_eq!(found[0].launch, Launch::Exe);
        assert_eq!(found[0].source, Source::Kuro);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_falls_back_to_the_exe_right_in_the_folder() {
        let dir = scratch("kuro-flat");
        let exe = touch(&dir, "Wuthering Waves.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("InstallPath", s(&dir))],
        );

        let found = kuro(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        assert_eq!(found[0].install_path, dir);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_prefers_the_nested_exe_when_both_exist() {
        let dir = scratch("kuro-both");
        let nested = touch(&dir, r"Wuthering Waves Game\Wuthering Waves.exe");
        touch(&dir, "Wuthering Waves.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("InstallPath", s(&dir))],
        );

        let found = kuro(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(nested.as_path()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_reads_install_location_when_install_path_is_missing_or_blank() {
        let dir = scratch("kuro-location");
        let exe = touch(&dir, r"Wuthering Waves Game\Wuthering Waves.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_WOW, "KRInstall Wuthering Waves China"),
            &[("InstallPath", "  "), ("InstallLocation", s(&dir))],
        );

        let found = kuro(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_takes_the_folder_of_a_quoted_uninstall_string() {
        let dir = scratch("kuro-quoted");
        let exe = touch(&dir, r"Wuthering Waves Game\Wuthering Waves.exe");
        let uninstall = format!("\"{}\" /SILENT", dir.join("unins000.exe").display());
        let reg = FakeRegistry::default().with(
            Root::CurrentUser,
            &kuro_key(UNINSTALL_HKCU, "KRInstall Wuthering Waves Overseas"),
            &[("UninstallString", &uninstall)],
        );

        let found = kuro(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_quoted_uninstall_string_is_cut_at_the_closing_quote_not_at_a_dot_exe_in_the_folder() {
        // «.exe» внутри имени папки: по подстроке путь обрезался бы на «foo.exe»
        // и папкой оказалась бы родительская.
        let dir = scratch("kuro-dot-exe");
        let exe = touch(&dir, r"foo.exec\Wuthering Waves Game\Wuthering Waves.exe");
        let uninstall = format!("\"{}\" /SILENT", dir.join(r"foo.exec\unins000.exe").display());
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("UninstallString", &uninstall)],
        );

        let found = kuro(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_takes_the_folder_of_an_unquoted_uninstall_string_with_arguments() {
        let dir = scratch("kuro-unquoted");
        let exe = touch(&dir, "Wuthering Waves.exe");
        let uninstall = format!("{} /SILENT", dir.join("unins000.exe").display());
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("UninstallString", &uninstall)],
        );

        let found = kuro(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_uses_a_default_folder_when_the_registry_has_nothing() {
        let dir = scratch("kuro-default");
        let exe = touch(&dir, r"Wuthering Waves Game\Wuthering Waves.exe");

        let found = kuro(&FakeRegistry::default(), std::slice::from_ref(&dir));

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        assert_eq!(found[0].source, Source::Kuro);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_reports_a_folder_named_twice_only_once() {
        let dir = scratch("kuro-twice");
        touch(&dir, r"Wuthering Waves Game\Wuthering Waves.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("InstallPath", s(&dir))],
        );

        assert_eq!(kuro(&reg, std::slice::from_ref(&dir)).len(), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_finds_nothing_when_no_candidate_exists() {
        let dir = scratch("kuro-none");
        let empty_default = dir.join("no-such-default");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("InstallPath", s(&dir))],
        );

        assert!(kuro(&reg, std::slice::from_ref(&empty_default)).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_ignores_other_uninstall_entries() {
        let dir = scratch("kuro-other");
        touch(&dir, r"Wuthering Waves Game\Wuthering Waves.exe");
        let reg = FakeRegistry::default()
            .with(
                Root::LocalMachine,
                &kuro_key(UNINSTALL_HKLM, "KRInstall Punishing Gray Raven"),
                &[("InstallPath", s(&dir))],
            )
            .with(
                Root::LocalMachine,
                &kuro_key(UNINSTALL_HKLM, "Wuthering Waves"),
                &[("InstallPath", s(&dir))],
            );

        assert!(kuro(&reg, &[]).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    // --------------------------------------------------------------- GRYPHLINK

    #[test]
    fn gryphlink_finds_the_launcher_by_display_name() {
        let dir = scratch("gryph-name");
        let exe = touch(&dir, "Launcher.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "{6F1A3A52-0000-0000-0000-000000000001}"),
            &[("DisplayName", "GRYPHLINK"), ("InstallLocation", s(&dir))],
        );

        let found = gryphlink(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "Arknights: Endfield");
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        assert_eq!(found[0].install_path, dir);
        assert_eq!(found[0].launch, Launch::Exe);
        assert_eq!(found[0].source, Source::Gryphlink);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gryphlink_matches_the_display_name_in_any_letter_case_and_root() {
        let dir = scratch("gryph-case");
        let exe = touch(&dir, "Launcher.exe");
        let reg = FakeRegistry::default().with(
            Root::CurrentUser,
            &kuro_key(UNINSTALL_HKCU, "gryphlink"),
            &[("DisplayName", "Gryphlink 1.0"), ("InstallLocation", s(&dir))],
        );

        let found = gryphlink(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gryphlink_takes_the_folder_of_the_uninstall_string() {
        let dir = scratch("gryph-uninstall");
        let exe = touch(&dir, "Launcher.exe");
        let uninstall = format!("\"{}\"", dir.join("uninst.exe").display());
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_WOW, "GRYPHLINK"),
            &[("DisplayName", "GRYPHLINK"), ("UninstallString", &uninstall)],
        );

        let found = gryphlink(&reg, &[]);

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gryphlink_uses_a_default_folder_when_the_registry_has_nothing() {
        let dir = scratch("gryph-default");
        let exe = touch(&dir, "Launcher.exe");

        let found = gryphlink(&FakeRegistry::default(), std::slice::from_ref(&dir));

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].exe_path.as_deref(), Some(exe.as_path()));
        assert_eq!(found[0].source, Source::Gryphlink);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gryphlink_ignores_entries_with_another_display_name() {
        let dir = scratch("gryph-other");
        touch(&dir, "Launcher.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "Some Launcher"),
            &[("DisplayName", "Some Launcher"), ("InstallLocation", s(&dir))],
        );

        assert!(gryphlink(&reg, &[]).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gryphlink_finds_nothing_without_a_launcher_exe() {
        let dir = scratch("gryph-none");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "GRYPHLINK"),
            &[("DisplayName", "GRYPHLINK"), ("InstallLocation", s(&dir))],
        );

        assert!(gryphlink(&reg, &[dir.join("no-such-default")]).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    // ---------------------------------------------------------- сами лаунчеры

    /// Игра конфига с файлом по этому пути.
    fn game_at(id: &str, title: &str, exe: &Path) -> crate::config::Game {
        let mut g = crate::config::Game::manual(id.into(), title.into());
        g.content_id = Some(id.into());
        g.exe_path = Some(exe.to_path_buf());
        g
    }

    #[test]
    fn hoyoplay_is_offered_for_a_game_installed_in_it() {
        let dir = scratch("hyp-launcher");
        let launcher = touch(&dir, r"HoYoPlay\launcher.exe");
        let game = touch(&dir, r"games\Genshin Impact game\GenshinImpact.exe");
        let reg = FakeRegistry::default()
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0", &[("InstallPath", s(&dir.join("HoYoPlay")))])
            .with(
                Root::CurrentUser,
                r"Software\Cognosphere\HYP\1_0\hk4e_global",
                &[("GameInstallPath", s(&dir.join(r"games\Genshin Impact game")))],
            );

        let found = LauncherPaths::read(&reg);
        assert_eq!(
            found.for_game(&game_at("genshin", "Genshin Impact", &game)),
            Some((Launcher::HoYoPlay, launcher.as_path()))
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_installed_launcher_without_this_game_offers_nothing() {
        // Как на живой машине: HoYoPlay стоит, `GameInstallPath` у игры пуст, а
        // сама игра поставлена из Epic. Открылся бы лаунчер с кнопкой загрузки.
        let dir = scratch("hyp-launcher-empty");
        touch(&dir, r"HoYoPlay\launcher.exe");
        let epic_copy = touch(&dir, r"Epic Games\GenshinImpact\launcher_epic.exe");
        let reg = FakeRegistry::default()
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0", &[("InstallPath", s(&dir.join("HoYoPlay")))])
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0\hk4e_global", &[("GameInstallPath", "")])
            // Копия из Epic записана в `standalone` — это не установка лаунчера.
            .with(
                Root::CurrentUser,
                r"Software\Cognosphere\HYP\standalone\1_3\hk4e_global\x\hk4e_global",
                &[("GameInstallPath", s(&dir.join(r"Epic Games\GenshinImpact")))],
            );

        let found = LauncherPaths::read(&reg);
        assert_eq!(found.for_game(&game_at("genshin", "Genshin Impact", &epic_copy)), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn another_copy_of_the_game_in_the_launcher_does_not_count() {
        // Лаунчер знает свою установку, а в конфиге — другая, из магазина.
        let dir = scratch("hyp-launcher-other-copy");
        touch(&dir, r"HoYoPlay\launcher.exe");
        touch(&dir, r"hyp-games\ZZZ\ZenlessZoneZero.exe");
        let store_copy = touch(&dir, r"Epic\ZZZ\launcher_epic.exe");
        let reg = FakeRegistry::default()
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0", &[("InstallPath", s(&dir.join("HoYoPlay")))])
            .with(
                Root::CurrentUser,
                r"Software\Cognosphere\HYP\1_0\nap_global",
                &[("GameInstallPath", s(&dir.join(r"hyp-games\ZZZ")))],
            );

        let found = LauncherPaths::read(&reg);
        assert_eq!(found.for_game(&game_at("zzz", "Zenless Zone Zero", &store_copy)), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_cn_hoyoplay_knows_its_own_games() {
        let dir = scratch("hyp-launcher-cn");
        let launcher = touch(&dir, r"launcher\launcher.exe");
        let game = touch(&dir, r"ys\YuanShen.exe");
        let reg = FakeRegistry::default()
            .with(
                Root::CurrentUser,
                r"Software\miHoYo\HYP\1_2",
                &[("InstallPath", &format!("\"{}\"", dir.join("launcher").display()))],
            )
            .with(Root::CurrentUser, r"Software\miHoYo\HYP\1_2\hk4e_cn", &[("GameInstallPath", s(&dir.join("ys")))]);

        let found = LauncherPaths::read(&reg);
        assert_eq!(
            found.for_game(&game_at("genshin", "Genshin Impact", &game)),
            Some((Launcher::HoYoPlay, launcher.as_path()))
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_hoyoplay_without_its_file_or_with_a_key_that_is_not_a_version() {
        let dir = scratch("hyp-launcher-none");
        let game = touch(&dir, r"g\GenshinImpact.exe");
        touch(&dir, r"standalone-only\launcher.exe");
        let reg = FakeRegistry::default()
            // Папка записана, а файла лаунчера в ней нет.
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0", &[("InstallPath", s(&dir))])
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0\hk4e_global", &[("GameInstallPath", s(&dir.join("g")))])
            // Не версия — не настройки лаунчера.
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\standalone", &[("InstallPath", s(&dir.join("standalone-only")))]);

        let genshin = game_at("genshin", "Genshin Impact", &game);
        assert_eq!(LauncherPaths::read(&reg).for_game(&genshin), None);
        assert_eq!(LauncherPaths::read(&FakeRegistry::default()).for_game(&genshin), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kuro_is_offered_for_the_game_in_the_folder_of_its_uninstall_entry() {
        let dir = scratch("kuro-launcher");
        let launcher = touch(&dir, r"Kuro\launcher.exe");
        let game = touch(&dir, r"Kuro\Wuthering Waves Game\Wuthering Waves.exe");
        let elsewhere = touch(&dir, r"Other\Wuthering Waves.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("InstallPath", s(&dir.join("Kuro")))],
        );

        let found = LauncherPaths::read(&reg);
        assert_eq!(
            found.for_game(&game_at("wuthering", "Wuthering Waves", &game)),
            Some((Launcher::Kuro, launcher.as_path()))
        );
        // Копия в другой папке — не его установка.
        assert_eq!(found.for_game(&game_at("wuthering", "Wuthering Waves", &elsewhere)), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_kuro_when_only_the_game_is_in_the_folder() {
        let dir = scratch("kuro-launcher-none");
        let game = touch(&dir, "Wuthering Waves.exe");
        let reg = FakeRegistry::default().with(
            Root::LocalMachine,
            &kuro_key(UNINSTALL_HKLM, "KRInstall Wuthering Waves Overseas"),
            &[("InstallPath", s(&dir))],
        );

        assert_eq!(LauncherPaths::read(&reg).for_game(&game_at("wuthering", "Wuthering Waves", &game)), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gryphlink_is_offered_only_for_a_game_inside_its_folder() {
        let dir = scratch("gryph-launcher");
        let launcher = touch(&dir, "Launcher.exe");
        let inside = touch(&dir, r"games\Endfield\Endfield.exe");
        let reg = FakeRegistry::default().with(
            Root::CurrentUser,
            &kuro_key(UNINSTALL_HKCU, "GRYPHLINK"),
            &[("DisplayName", "GRYPHLINK"), ("InstallLocation", s(&dir))],
        );

        let found = LauncherPaths::read(&reg);
        assert_eq!(
            found.for_game(&game_at("endfield", "Arknights: Endfield", &inside)),
            Some((Launcher::Gryphlink, launcher.as_path()))
        );
        let epic = Path::new(r"C:\Program Files\Epic Games\ArknightsEndfieldgowoU\Launcher.exe");
        assert_eq!(found.for_game(&game_at("endfield", "Arknights: Endfield", epic)), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_launcher_is_not_offered_to_a_game_that_is_not_its_own() {
        // Файл лежит в папке игры HoYoPlay, но сама игра — не из HoYoPlay.
        let dir = scratch("hyp-launcher-foreign");
        touch(&dir, r"HoYoPlay\launcher.exe");
        let reg = FakeRegistry::default()
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0", &[("InstallPath", s(&dir.join("HoYoPlay")))])
            .with(Root::CurrentUser, r"Software\Cognosphere\HYP\1_0\hk4e_global", &[("GameInstallPath", s(&dir))]);

        let found = LauncherPaths::read(&reg);
        assert_eq!(found.for_game(&game_at("lantern", "Lantern Keeper", &dir.join("Lantern.exe"))), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_game_belongs_to_its_launcher_by_catalog_id_or_by_title() {
        for id in ["genshin", "hsr", "zzz"] {
            assert_eq!(Launcher::of_game(Some(id), "x"), Some(Launcher::HoYoPlay), "{id}");
        }
        assert_eq!(Launcher::of_game(Some("wuthering"), "x"), Some(Launcher::Kuro));
        assert_eq!(Launcher::of_game(Some("endfield"), "x"), Some(Launcher::Gryphlink));
        // Без привязки к каталогу — по названию, без учёта регистра и знаков.
        assert_eq!(Launcher::of_game(None, "honkai star rail"), Some(Launcher::HoYoPlay));
        assert_eq!(Launcher::of_game(None, "Wuthering Waves"), Some(Launcher::Kuro));
        assert_eq!(Launcher::of_game(None, "ARKNIGHTS: ENDFIELD"), Some(Launcher::Gryphlink));
        assert_eq!(Launcher::of_game(None, "Lantern Keeper"), None);
        // Привязка важнее названия: игру переименовали, но каталог её знает.
        assert_eq!(Launcher::of_game(Some("wuthering"), "Genshin Impact"), Some(Launcher::Kuro));
        assert_eq!(Launcher::of_game(Some("other"), "Genshin Impact"), None);
    }

    #[test]
    fn launchers_go_over_the_wire_as_lowercase_words() {
        assert_eq!(serde_json::to_string(&Launcher::HoYoPlay).unwrap(), "\"hoyoplay\"");
        assert_eq!(serde_json::to_string(&Launcher::Kuro).unwrap(), "\"kuro\"");
        assert_eq!(serde_json::to_string(&Launcher::Gryphlink).unwrap(), "\"gryphlink\"");
    }

    // ------------------------------------------------------------------- прочее

    #[cfg(windows)]
    #[test]
    fn program_files_comes_from_the_environment_with_a_fallback() {
        use std::ffi::OsString;
        assert_eq!(
            program_files(Some(OsString::from(r"D:\Programs"))),
            PathBuf::from(r"D:\Programs")
        );
        assert_eq!(program_files(None), PathBuf::from(r"C:\Program Files"));
        assert_eq!(program_files(Some(OsString::new())), PathBuf::from(r"C:\Program Files"));
    }

    #[test]
    fn every_launcher_source_has_a_label_for_the_log() {
        assert_eq!(label(Source::HoYoPlay), "HoYoPlay");
        assert_eq!(label(Source::Kuro), "лаунчер Kuro");
        assert_eq!(label(Source::Gryphlink), "GRYPHLINK");
    }
}
