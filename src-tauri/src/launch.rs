//! Запуск игры. Три способа, но для пользователя их два: через магазин
//! и напрямую.
//!
//! 1. Steam — `steam://rungameid/<appid>`. Клиент Steam сам разбирается
//!    с обновлениями и авторизацией.
//! 2. Epic — `com.epicgames.launcher://apps/<ns>%3A<cid>%3A<app>?action=launch&silent=true`.
//!    Три идентификатора берутся из манифеста Epic, пользователь ничего
//!    не вводит.
//! 3. Свой .exe — `std::process::Command` (CreateProcessW):
//!      * аргументы передаются вектором, оболочка не участвует, поэтому
//!        проблемы экранирования невозможны по построению;
//!      * строка аргументов разбирается по правилам Windows
//!        `CommandLineToArgvW` (см. `split_args`), а НЕ по POSIX: последний
//!        съедает `\` в путях;
//!      * рабочий каталог — папка самого exe: клиенты игр ищут свои данные
//!        относительно себя. Так при прямом запуске (`CreateProcess`) и на пути
//!        через PowerShell; на пути через оболочку (ошибка 740, аргументов нет)
//!        оболочка рабочую папку не задаёт — игра наследует рабочую папку
//!        самого Kitsudock;
//!      * игры HoYoPlay требуют прав администратора: `CreateProcess` на них
//!        отвечает ошибкой 740, а окно прав показывает только оболочка Windows.
//!        Поэтому именно при 740 (и только при ней) игра открывается через
//!        оболочку Windows (ShellExecuteExW) — она показывает окно прав
//!        администратора, а если у игры есть аргументы — через PowerShell
//!        `Start-Process`: только он передаёт и аргументы, и рабочую папку.
//!        См. `start_with_elevation`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::config::{Game, Launch};
use crate::error::{code, AppError};

/// Разбор строки аргументов по правилам Windows `CommandLineToArgvW`
/// (НЕ по POSIX):
///   * двойные кавычки ограничивают аргумент;
///   * `2n` обратных слэшей перед кавычкой  -> `n` слэшей, кавычка ограничивает;
///   * `2n+1` слэшей перед кавычкой -> `n` слэшей и буквальная `"`.
///
/// Возвращает `None`, если кавычка осталась незакрытой: вызывающий обязан
/// показать это ошибкой, а не молча запустить игру без аргументов.
fn split_args(input: &str) -> Option<Vec<String>> {
    let mut args: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut have_arg = false;
    let mut in_quotes = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                have_arg = true;
            }
            c if c.is_whitespace() => {
                if in_quotes {
                    current.push(c);
                } else if have_arg || !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                    have_arg = false;
                }
            }
            '\\' => {
                let mut backslashes = 1;
                while let Some(&'\\') = chars.peek() {
                    chars.next();
                    backslashes += 1;
                }
                let half = backslashes / 2;
                match chars.peek() {
                    Some(&'"') => {
                        chars.next();
                        current.push_str(&"\\".repeat(half));
                        if backslashes % 2 == 1 {
                            // Нечётное: последний слэш экранирует кавычку —
                            // она становится буквальной внутри аргумента.
                            current.push('"');
                        } else {
                            // Чётное: кавычка ограничивает аргумент.
                            in_quotes = !in_quotes;
                            have_arg = true;
                        }
                    }
                    _ => {
                        // Дальше не кавычка: все слэши буквальные.
                        current.push_str(&"\\".repeat(backslashes));
                    }
                }
            }
            c => current.push(c),
        }
    }

    if in_quotes {
        return None;
    }
    if have_arg || !current.is_empty() {
        args.push(current);
    }
    Some(args)
}

/// Один аргумент в строке команды Windows: обратное к `split_args`.
///   * непустой аргумент без пробельных символов и кавычек остаётся как есть;
///   * иначе он берётся в двойные кавычки; обратные слэши перед кавычкой
///     (и перед закрывающей кавычкой) удваиваются, а кавычка внутри
///     экранируется как `\"`.
///
/// Пробельным считается всё, что `split_args` считает разделителем
/// (`char::is_whitespace`), а не только пробел и табуляция: иначе перевод строки
/// внутри аргумента разорвал бы его.
fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.chars().any(|c| c.is_whitespace() || c == '"') {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                // 2n+1 слэшей и кавычка: n слэшей и буквальная кавычка.
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            c => {
                // Слэши не перед кавычкой остаются буквальными.
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    // Слэши перед закрывающей кавычкой удваиваются, иначе они её съедят.
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// Разобранные аргументы обратно в одну строку: `split_args` вернёт их же.
fn join_windows_args(args: &[String]) -> String {
    args.iter()
        .map(|a| quote_windows_arg(a))
        .collect::<Vec<_>>()
        .join(" ")
}

/// ERROR_ELEVATION_REQUIRED: файлу нужны права администратора, а
/// `CreateProcess` их не запрашивает.
const ERROR_ELEVATION_REQUIRED: i32 = 740;

fn needs_elevation(e: &std::io::Error) -> bool {
    e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED)
}

/// ERROR_CANCELLED: в окне прав администратора нажали «Нет».
const ERROR_CANCELLED: i32 = 1223;

/// Отказ в окне прав — выбор человека, а не сбой запуска (спека 2026-10-01 §3).
fn is_cancelled(e: &std::io::Error) -> bool {
    e.raw_os_error() == Some(ERROR_CANCELLED)
}

/// Чем запускать игру, которой нужны права администратора.
#[derive(Debug, PartialEq)]
enum ElevatedRoute {
    /// Оболочка Windows (ShellExecuteExW) — она показывает окно прав администратора.
    Shell,
    /// PowerShell `Start-Process`: только он передаёт и аргументы, и рабочую папку.
    PowerShell,
}

/// Без аргументов — оболочка Windows; с аргументами — PowerShell.
fn elevated_route(args: &[String]) -> ElevatedRoute {
    if args.is_empty() {
        ElevatedRoute::Shell
    } else {
        ElevatedRoute::PowerShell
    }
}

/// Открывает exe через оболочку Windows (ShellExecuteExW) — она показывает окно
/// прав администратора. Рабочую папку оболочка здесь не задаёт.
fn start_via_shell(exe: &Path) -> std::io::Result<()> {
    tauri_plugin_opener::open_path(exe, None::<&str>).map_err(|e| match e {
        tauri_plugin_opener::Error::Io(io) => io,
        other => std::io::Error::other(other.to_string()),
    })
}

/// Запуск игры, ответившей ошибкой 740. Отказ в окне прав — не ошибка;
/// другой отказ оболочки — пробуем PowerShell. Ошибка — текст обеих причин.
fn start_with_elevation(exe: &Path, cwd: &Path, args: &[String]) -> Result<(), String> {
    if elevated_route(args) == ElevatedRoute::Shell {
        match start_via_shell(exe) {
            Ok(()) => return Ok(()),
            Err(e) if is_cancelled(&e) => return Ok(()),
            Err(shell) => {
                // Запасной путь должен быть виден в журнале приложения.
                log::warn!(
                    "[launch] оболочка Windows не запустила {}: {shell}; пробуем PowerShell",
                    exe.display()
                );
                return start_elevated(exe, cwd, args)
                    .map_err(|ps| format!("Windows: {shell}; PowerShell: {ps}"));
            }
        }
    }
    start_elevated(exe, cwd, args).map_err(|ps| format!("PowerShell: {ps}"))
}

/// Значение как строка PowerShell: в одинарных кавычках, а `'` внутри
/// удваивается.
///
/// В скрипте остаётся только печатный ASCII. Скрипт идёт в PowerShell через
/// stdin, а там он читается в кодовой странице консоли (OEM, у нас 866), а не в
/// UTF-8: кириллица в пути (`D:\Игры`, имя пользователя) превратилась бы в
/// мусор, и заодно закрывающими кавычками PowerShell считает «умные» `’ ‘ ‚ ‛`.
/// Поэтому всё остальное вставляется как `[char]0x….`, по одной кодовой единице
/// UTF-16 (`'a'+[char]0x0418+'b'`); такое выражение берётся в скобки, чтобы
/// стать значением параметра.
fn ps_string(value: &str) -> String {
    let mut out = String::from("'");
    let mut spliced = false;
    for unit in value.encode_utf16() {
        match u8::try_from(unit) {
            Ok(b'\'') => out.push_str("''"),
            Ok(b) if (0x20..0x7f).contains(&b) => out.push(b as char),
            _ => {
                out.push_str(&format!("'+[char]0x{unit:04X}+'"));
                spliced = true;
            }
        }
    }
    out.push('\'');
    if spliced {
        format!("({out})")
    } else {
        out
    }
}

/// Скрипт для PowerShell: `Start-Process` идёт через ShellExecute, а он
/// показывает UAC. Каталог задан явно, как и у обычного запуска. Аргументы —
/// ОДНОЙ строкой, собранной по правилам Windows: массив в `-ArgumentList`
/// Windows PowerShell 5.1 склеил бы без кавычек, и путь с пробелом развалился
/// бы на два аргумента. Пустой `-ArgumentList` — ошибка, поэтому без аргументов
/// параметра нет.
fn elevation_script(exe: &Path, cwd: &Path, args: &[String]) -> String {
    let mut script = format!(
        "Start-Process -FilePath {} -WorkingDirectory {}",
        ps_string(&exe.to_string_lossy()),
        ps_string(&cwd.to_string_lossy()),
    );
    if !args.is_empty() {
        script.push_str(" -ArgumentList ");
        script.push_str(&ps_string(&join_windows_args(args)));
    }
    script
}

/// CREATE_NO_WINDOW: у PowerShell не должно появляться окна консоли.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// PowerShell по абсолютному пути из системной папки Windows, а не по имени:
/// поиск по имени смотрит сначала в папку самой программы и в текущую папку.
/// Переменной нет, она пуста или путь в ней не абсолютный (относительный
/// вернул бы поиск от текущей папки) — `C:\Windows`.
fn powershell_exe(system_root: Option<std::ffi::OsString>) -> PathBuf {
    system_root
        .map(PathBuf::from)
        .filter(|root| root.is_absolute())
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe")
}

/// Запускает игру через PowerShell `Start-Process` (игры с аргументами и запасной
/// путь, когда оболочка отказала), чтобы Windows показала окно UAC.
/// Ждать нечего: пользователь может думать над окном сколько угодно, а отказ от
/// UAC — его выбор, а не ошибка запуска.
fn start_elevated(exe: &Path, cwd: &Path, args: &[String]) -> std::io::Result<()> {
    let mut powershell = Command::new(powershell_exe(std::env::var_os("SystemRoot")));
    powershell
        .args(["-NoProfile", "-NonInteractive", "-Command", "-"])
        .stdin(Stdio::piped())
        // У приложения нет консоли: унаследованные потоки бесполезны.
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        powershell.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = powershell.spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        let script = format!("{}\n", elevation_script(exe, cwd, args));
        stdin.write_all(script.as_bytes())?;
        // stdin закрывается здесь: конец ввода — сигнал выполнять скрипт.
    }
    Ok(())
}

/// Официальная ссылка запуска Epic Games Launcher.
/// Разделитель между тремя идентификаторами — двоеточие в URL-кодировке.
pub fn epic_uri(namespace: &str, catalog_item_id: &str, app_name: &str) -> String {
    format!(
        "com.epicgames.launcher://apps/{namespace}%3A{catalog_item_id}%3A{app_name}?action=launch&silent=true"
    )
}

/// Ошибка — код с подробностью: фразу на языке интерфейса собирает страница
/// (спека этапа 6 §6.2).
pub fn launch(app: &AppHandle, game: &Game) -> Result<(), AppError> {
    match &game.launch {
        Launch::Steam { appid } => {
            let uri = format!("steam://rungameid/{appid}");
            app.opener()
                .open_url(&uri, None::<String>)
                .map_err(|e| AppError::with(code::STEAM_OPEN_FAILED, format!("{uri}: {e}")))
        }
        Launch::Epic {
            namespace,
            catalog_item_id,
            app_name,
        } => {
            let uri = epic_uri(namespace, catalog_item_id, app_name);
            app.opener()
                .open_url(&uri, None::<String>)
                .map_err(|e| AppError::with(code::EPIC_OPEN_FAILED, e.to_string()))
        }
        Launch::Exe => {
            let exe = game
                .exe_path
                .clone()
                .filter(|p| !p.as_os_str().is_empty())
                .ok_or_else(|| AppError::new(code::EXE_PATH_MISSING))?;

            if !exe.is_file() {
                return Err(AppError::with(code::FILE_MISSING, exe.display().to_string()));
            }

            let parsed = split_args(&game.args)
                .ok_or_else(|| AppError::with(code::ARGS_UNCLOSED_QUOTE, game.args.clone()))?;

            let cwd = exe
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));

            match Command::new(&exe).args(&parsed).current_dir(&cwd).spawn() {
                Ok(_) => Ok(()),
                // 740: игре нужны права администратора. Только в этом случае
                // отдаём запуск оболочке Windows, чтобы она показала окно прав.
                Err(first) if needs_elevation(&first) => start_with_elevation(&exe, &cwd, &parsed)
                    .map_err(|second| {
                        AppError::with(
                            code::EXE_START_FAILED,
                            format!("{}: {first}; {second}", exe.display()),
                        )
                    }),
                Err(e) => Err(AppError::with(
                    code::EXE_START_FAILED,
                    format!("{}: {e}", exe.display()),
                )),
            }
        }
    }
}

#[cfg(test)]
mod launch_tests {
    use super::*;

    #[test]
    fn builds_the_official_epic_launch_uri() {
        assert_eq!(
            epic_uri("879b0d87", "7d690c12", "41869934"),
            "com.epicgames.launcher://apps/879b0d87%3A7d690c12%3A41869934?action=launch&silent=true"
        );
    }

    #[test]
    fn windows_argument_rules_keep_backslashes() {
        // Ради этого мы не берём POSIX-разбор: shlex съел бы обратные слэши.
        assert_eq!(
            split_args(r"-config C:\Games\Genshin -dx12").unwrap(),
            vec![r"-config", r"C:\Games\Genshin", "-dx12"]
        );
    }

    #[test]
    fn unterminated_quote_is_an_error_not_a_silent_drop() {
        assert!(split_args(r#"-name "unterminated"#).is_none());
    }

    // ------------------------------------------------- запуск с правами администратора

    #[test]
    fn only_error_740_asks_for_elevation() {
        assert!(needs_elevation(&std::io::Error::from_raw_os_error(740)));
        // Файла нет, отказано в доступе, а также ошибка без кода ОС — не повод
        // звать оболочку.
        assert!(!needs_elevation(&std::io::Error::from_raw_os_error(2)));
        assert!(!needs_elevation(&std::io::Error::from_raw_os_error(5)));
        assert!(!needs_elevation(&std::io::Error::other("no os code")));
    }

    #[test]
    fn without_arguments_the_windows_shell_starts_an_elevated_game() {
        assert_eq!(elevated_route(&[]), ElevatedRoute::Shell);
    }

    #[test]
    fn with_arguments_powershell_keeps_them_and_the_working_folder() {
        assert_eq!(elevated_route(&["-dx12".to_string()]), ElevatedRoute::PowerShell);
    }

    #[test]
    fn a_no_in_the_rights_window_is_the_users_choice_not_a_failure() {
        assert!(is_cancelled(&std::io::Error::from_raw_os_error(1223)));
        assert!(!is_cancelled(&std::io::Error::from_raw_os_error(740)));
        assert!(!is_cancelled(&std::io::Error::other("x")));
    }

    #[test]
    fn plain_arguments_stay_as_they_are() {
        assert_eq!(quote_windows_arg("-dx12"), "-dx12");
        assert_eq!(quote_windows_arg(r"C:\Games\Genshin"), r"C:\Games\Genshin");
        // Слэши в конце без пробелов и кавычек ничего не съедают.
        assert_eq!(quote_windows_arg(r"C:\Games\"), r"C:\Games\");
    }

    #[test]
    fn arguments_with_spaces_quotes_or_nothing_get_quoted() {
        assert_eq!(quote_windows_arg(""), r#""""#);
        assert_eq!(quote_windows_arg("a b"), r#""a b""#);
        assert_eq!(quote_windows_arg("a\tb"), "\"a\tb\"");
        assert_eq!(quote_windows_arg(r#"say "hi""#), r#""say \"hi\"""#);
        // Слэши перед закрывающей кавычкой удваиваются.
        assert_eq!(quote_windows_arg(r"C:\My Games\"), r#""C:\My Games\\""#);
        // Слэши перед кавычкой внутри: 2n+1.
        assert_eq!(quote_windows_arg(r#"a\"b"#), r#""a\\\"b""#);
        // Слэши не перед кавычкой не трогаем.
        assert_eq!(quote_windows_arg(r"a b\c"), r#""a b\c""#);
    }

    #[test]
    fn joined_arguments_split_back_into_the_same_ones() {
        let cases: Vec<Vec<&str>> = vec![
            vec![],
            vec!["-dx12"],
            vec!["-config", r"C:\Games\Genshin", "-dx12"],
            vec!["with space", "x"],
            vec![""],
            vec!["", "", "x", ""],
            vec![r#"say "hi""#],
            vec![r#"""#],
            vec![r#""""#],
            vec![r"C:\My Games\"],
            vec![r"C:\My Games\\"],
            vec![r#"a\"b"#],
            vec![r#"a\\"b c\"#],
            vec![r"\", r"\\", r"\ \"],
            vec!["tab\there", "new\nline", "cr\r\nlf"],
            vec!["Игры и ещё", "ё"],
            vec![r#"-path=C:\Program Files\Game" -x"#, r#"\""#, r#"\\\""#],
        ];
        for case in cases {
            let args: Vec<String> = case.iter().map(|s| s.to_string()).collect();
            let joined = join_windows_args(&args);
            assert_eq!(split_args(&joined), Some(args), "строка: {joined}");
        }
    }

    #[test]
    fn a_string_for_powershell_doubles_single_quotes() {
        assert_eq!(ps_string("plain"), "'plain'");
        assert_eq!(ps_string("O'Neil"), "'O''Neil'");
        assert_eq!(ps_string("'"), "''''");
        // Двойные кавычки и `$` в одинарных кавычках ничего не значат.
        assert_eq!(ps_string(r#"a "b" $c `d"#), r#"'a "b" $c `d'"#);
        assert_eq!(ps_string(""), "''");
    }

    #[test]
    fn everything_but_printable_ascii_goes_into_a_script_as_char_codes() {
        // Скрипт читается в OEM-странице, поэтому кириллица, «умные» кавычки,
        // управляющие символы и пары суррогатов не должны попасть в него как есть.
        assert_eq!(ps_string("aИ"), "('a'+[char]0x0418+'')");
        assert_eq!(ps_string("’x"), "(''+[char]0x2019+'x')");
        assert_eq!(ps_string("a\nb"), "('a'+[char]0x000A+'b')");
        assert_eq!(
            ps_string("\u{1F600}"),
            "(''+[char]0xD83D+''+[char]0xDE00+'')"
        );
        // Апостроф рядом с вставкой остаётся удвоенным.
        assert_eq!(ps_string("'И"), "(''''+[char]0x0418+'')");
        for s in ["D:\\Игры\\Genshin’s\n", "\u{1F600}", "a'b", "tab\t"] {
            let script = ps_string(s);
            assert!(
                script.bytes().all(|b| (0x20..0x7f).contains(&b)),
                "не только печатный ASCII: {script}"
            );
        }
    }

    #[test]
    fn the_script_starts_the_exe_in_its_folder() {
        let script = elevation_script(
            Path::new(r"C:\Games\Genshin Impact\GenshinImpact.exe"),
            Path::new(r"C:\Games\Genshin Impact"),
            &[],
        );
        assert_eq!(
            script,
            r"Start-Process -FilePath 'C:\Games\Genshin Impact\GenshinImpact.exe' -WorkingDirectory 'C:\Games\Genshin Impact'"
        );
    }

    #[test]
    fn the_script_has_no_argument_list_without_arguments() {
        let script = elevation_script(Path::new(r"C:\g\a.exe"), Path::new(r"C:\g"), &[]);
        assert!(!script.contains("-ArgumentList"));
    }

    #[test]
    fn single_quotes_in_paths_and_arguments_are_doubled_in_the_script() {
        let script = elevation_script(
            Path::new(r"C:\O'Neil's\a.exe"),
            Path::new(r"C:\O'Neil's"),
            &["-name".to_string(), "it's".to_string()],
        );
        assert_eq!(
            script,
            r"Start-Process -FilePath 'C:\O''Neil''s\a.exe' -WorkingDirectory 'C:\O''Neil''s' -ArgumentList '-name it''s'"
        );
    }

    #[test]
    fn the_arguments_go_in_as_one_windows_quoted_string() {
        let args: Vec<String> = ["-config", r"C:\My Games\", r#"say "hi""#]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let script = elevation_script(Path::new(r"C:\g\a.exe"), Path::new(r"C:\g"), &args);
        assert_eq!(
            script,
            r#"Start-Process -FilePath 'C:\g\a.exe' -WorkingDirectory 'C:\g' -ArgumentList '-config "C:\My Games\\" "say \"hi\""'"#
        );
    }

    #[test]
    fn powershell_is_started_by_absolute_path_from_the_system_root() {
        assert_eq!(
            powershell_exe(Some(r"D:\WINNT".into())),
            PathBuf::from(r"D:\WINNT\System32\WindowsPowerShell\v1.0\powershell.exe")
        );
    }

    #[test]
    fn without_a_system_root_powershell_comes_from_c_windows() {
        let fallback =
            PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        assert_eq!(powershell_exe(None), fallback);
        // Пустая переменная — всё равно что её отсутствие: иначе путь стал бы
        // относительным и вернулся бы поиск по имени.
        assert_eq!(powershell_exe(Some("".into())), fallback);
    }

    #[test]
    fn a_non_absolute_system_root_is_ignored_like_a_missing_one() {
        let fallback =
            PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        // Относительный путь вернул бы поиск относительно текущей папки.
        for root in ["Windows", r"\Windows", "C:Windows", ".", r"..\Windows", "%SystemRoot%"] {
            assert_eq!(powershell_exe(Some(root.into())), fallback, "{root}");
        }
    }

    #[test]
    fn a_path_with_cyrillic_stays_pure_ascii_in_the_script() {
        let script = elevation_script(
            Path::new(r"D:\Игры\a.exe"),
            Path::new(r"D:\Игры"),
            &["ё".to_string()],
        );
        assert!(script.is_ascii(), "{script}");
        assert!(script.starts_with(r"Start-Process -FilePath ('D:\'+[char]0x0418+"));
        assert!(script.contains(" -ArgumentList ("));
    }
}
