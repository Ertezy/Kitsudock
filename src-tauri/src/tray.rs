//! Значок в трее и перехват закрытия окна.
//!
//! Меню: все игры в порядке дока, черта, «показать окно», «выход». Запуск игр
//! из трея добавлен позже — раньше меню намеренно было из двух пунктов.

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::config::{self, Game, Language};
use crate::error::AppError;
use crate::i18n;

/// Событие для страницы: окно показано (`true`) или спрятано (`false`).
pub const VISIBILITY_EVENT: &str = "window-visibility";

/// Событие для страницы: запуск из трея не удался.
pub const TRAY_LAUNCH_FAILED: &str = "tray-launch-failed";

const GAME_PREFIX: &str = "game:";

/// Значок трея: мордочка кицунэ крупным планом, 32×32 RGBA без сжатия.
/// Значок приложения при 16 px превращается в пятно, поэтому у трея свой
/// рисунок; сырые пиксели — чтобы не подключать декодер PNG (без новых
/// возможностей tauri).
pub const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-32.rgba");
pub const TRAY_ICON_SIZE: u32 = 32;

/// Пункт меню — чистые данные, чтобы список проверялся без окна.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Game { id: String, text: String, enabled: bool },
    Separator,
    Show(&'static str),
    Quit(&'static str),
}

/// В `AppendMenuW` одиночный `&` — мнемоника показанной рядом буквы, и
/// «Might & Magic» отображалась бы с пропавшим «&». Удваиваем его, как учит
/// сам API.
fn escape_ampersand(text: &str) -> String {
    text.replace('&', "&&")
}

/// Все игры в порядке дока, черта, «показать окно», «выход». Игра без файла
/// видна, но неактивна, с пометкой на языке интерфейса.
pub fn entries(games: &[Game], lang: Language) -> Vec<Entry> {
    let texts = i18n::tray(lang);
    let mut list: Vec<Entry> = games
        .iter()
        .map(|g| {
            let present = config::is_present(g);
            let raw = if present { g.title.clone() } else { format!("{} {}", g.title, texts.file_missing) };
            Entry::Game { id: g.id.clone(), text: escape_ampersand(&raw), enabled: present }
        })
        .collect();
    if !list.is_empty() {
        list.push(Entry::Separator);
    }
    list.push(Entry::Show(texts.show));
    list.push(Entry::Quit(texts.quit));
    list
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let cfg = config::load(app);
    let menu = Menu::new(app)?;
    for entry in entries(&cfg.games, cfg.language) {
        match entry {
            Entry::Game { id, text, enabled } => {
                menu.append(&MenuItem::with_id(app, format!("{GAME_PREFIX}{id}"), text, enabled, None::<&str>)?)?
            }
            Entry::Separator => menu.append(&PredefinedMenuItem::separator(app)?)?,
            Entry::Show(text) => menu.append(&MenuItem::with_id(app, "show", text, true, None::<&str>)?)?,
            Entry::Quit(text) => menu.append(&MenuItem::with_id(app, "quit", text, true, None::<&str>)?)?,
        }
    }
    Ok(menu)
}

/// Пересобирает меню: после любой записи списка игр и после смены языка.
/// Без трея — ничего не делает.
pub fn rebuild_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    match build_menu(app) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => log::error!("[tray] не удалось пересобрать меню: {e}"),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayLaunchFailed {
    game_id: String,
    error: AppError,
}

/// Запуск из трея — в своём потоке, чтобы меню не ждало. Неудача: окно
/// открывается, страница показывает ошибку у кнопки Play.
fn launch_from_tray(app: &AppHandle, game_id: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = crate::commands::launch_and_remember(&app, &game_id) {
            restore(&app);
            let _ = app.emit(TRAY_LAUNCH_FAILED, TrayLaunchFailed { game_id, error });
        }
    });
}

/// Прячет главное окно. Единственное место в приложении, где это делается.
///
/// Раньше окно пряталось в двух местах, у крестика и после запуска игры, и
/// проверка «есть ли значок в трее» жила у каждого отдельно — во втором её
/// однажды забыли. Теперь и проверка, и сообщение странице (видео фона встаёт на
/// паузу) живут здесь, и забыть их в новом месте нельзя:
/// другого способа спрятать окно в коде нет.
///
/// `false` — окно не спрятано: без значка в трее его стало бы нечем вернуть.
pub fn hide_main_window(app: &AppHandle) -> bool {
    if app.tray_by_id("main").is_none() {
        return false;
    }
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    if window.hide().is_err() {
        return false;
    }
    let _ = app.emit(VISIBILITY_EVENT, false);
    true
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    let icon = tauri::image::Image::new(TRAY_ICON, TRAY_ICON_SIZE, TRAY_ICON_SIZE);

    // with_id — конструктор, а не звено в цепочке: без своего id значок нельзя
    // будет найти через tray_by_id при перехвате закрытия окна.
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => restore(app),
            "quit" => app.exit(0),
            id => {
                if let Some(game_id) = id.strip_prefix(GAME_PREFIX) {
                    launch_from_tray(app, game_id.to_string());
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Возврат окна — обычный левый клик по значку.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn restore(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit(VISIBILITY_EVENT, true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Game, Language, Launch};

    fn game(id: &str, title: &str, exe: Option<&str>) -> Game {
        Game {
            id: id.into(),
            title: title.into(),
            content_id: None,
            launch: Launch::Exe,
            install_path: None,
            exe_path: exe.map(std::path::PathBuf::from),
            args: String::new(),
            background: None,
            icon: None,
            video: None,
            content_unlinked: false,
            launch_way: None,
        }
    }

    #[test]
    fn games_come_first_in_dock_order_then_show_and_quit() {
        let exe = std::env::current_exe().unwrap();
        let exe = exe.to_str().unwrap();
        let list = entries(&[game("a", "Alpha", Some(exe)), game("b", "Beta", Some(exe))], Language::En);
        assert_eq!(
            list,
            vec![
                Entry::Game { id: "a".into(), text: "Alpha".into(), enabled: true },
                Entry::Game { id: "b".into(), text: "Beta".into(), enabled: true },
                Entry::Separator,
                Entry::Show("Show window"),
                Entry::Quit("Quit"),
            ]
        );
    }

    #[test]
    fn a_game_without_its_file_is_disabled_and_marked_in_the_language() {
        let missing = game("m", "Gone", Some(r"C:\nope\never\gone.exe"));
        assert_eq!(
            entries(&[missing.clone()], Language::En)[0],
            Entry::Game { id: "m".into(), text: "Gone — file not found".into(), enabled: false }
        );
        assert_eq!(
            entries(&[missing], Language::Ru)[0],
            Entry::Game { id: "m".into(), text: "Gone — файл не найден".into(), enabled: false }
        );
    }

    #[test]
    fn no_games_means_no_separator() {
        assert_eq!(entries(&[], Language::Ru), vec![Entry::Show("Показать окно"), Entry::Quit("Выход")]);
    }

    #[test]
    fn ampersand_in_the_title_is_doubled_for_the_menu() {
        let exe = std::env::current_exe().unwrap();
        let exe = exe.to_str().unwrap();
        let list = entries(&[game("mm", "Might & Magic", Some(exe))], Language::En);
        assert_eq!(list[0], Entry::Game { id: "mm".into(), text: "Might && Magic".into(), enabled: true });
    }

    #[test]
    fn tray_icon_is_32_by_32_rgba() {
        assert_eq!(TRAY_ICON.len(), (TRAY_ICON_SIZE * TRAY_ICON_SIZE * 4) as usize);
    }

    #[test]
    fn icon_has_every_size_windows_asks_for() {
        // Windows берёт значок окна и панели задач из ресурса exe и сам выбирает
        // размер под масштаб экрана — нужны все размеры; до 48 это крупный план
        // мордочки, от 64 — значок целиком. Порядок записей в icon.ico не важен.
        let ico = include_bytes!("../icons/icon.ico");
        assert_eq!(&ico[0..4], &[0, 0, 1, 0], "не ICO");
        let count = u16::from_le_bytes([ico[4], ico[5]]) as usize;
        let mut sizes = std::collections::BTreeSet::new();
        for i in 0..count {
            let entry = &ico[6 + i * 16..6 + (i + 1) * 16];
            // В каталоге ICO размер 256 записан нулём.
            let side = |b: u8| if b == 0 { 256 } else { u32::from(b) };
            assert_eq!(side(entry[0]), side(entry[1]), "запись {i} не квадратная");
            sizes.insert(side(entry[0]));
        }
        let expected: std::collections::BTreeSet<u32> =
            [16, 20, 24, 32, 40, 48, 64, 96, 128, 256].into_iter().collect();
        assert_eq!(sizes, expected);
    }
}
