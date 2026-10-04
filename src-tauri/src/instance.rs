//! Один экземпляр на пользователя (спека этапа 7 §4.3). Первый экземпляр
//! слушает петлевой порт; второй подключается, называет себя и просит
//! показать окно. Порт на `127.0.0.1` — наружу не виден, брандмауэр не
//! спрашивает.
//!
//! Порт общий на весь компьютер, а не на пользователя — с быстрым
//! переключением пользователей Windows экземпляр другого пользователя мог бы
//! ответить вместо своего и показать чужое окно в чужой сессии. Поэтому
//! приветствие несёт личность (`USERDOMAIN\USERNAME`), и первый экземпляр
//! отвечает, только если она совпадает с его собственной; иначе — как и с
//! чужой программой на порту, которая ответит неправильным приветствием или
//! не ответит вовсе, — соединение закрывается без ответа, и второй экземпляр
//! запускается как обычно, без защиты.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

/// Порт сменился вместе с переименованием: прежняя версия (Gacha Hub) слушала
/// 47631, и общий порт лишил бы Kitsudock защиты от второго экземпляра, пока
/// запущен Gacha Hub. Теперь у двух приложений порты никогда не совпадают.
pub const PORT: u16 = 47632;
const HELLO: &str = "kitsudock show";
const REPLY: &str = "kitsudock ok";
const WAIT: Duration = Duration::from_millis(500);
/// Сколько байт строки читается с порта: приветствие вместе с личностью —
/// несколько десятков байт.
const MAX_LINE: u64 = 256;

pub enum Start {
    /// Порт свободен — этот экземпляр первый.
    First(TcpListener),
    /// Первый экземпляр уже работает и покажет своё окно — этому закрыться.
    Handed,
    /// Порт занят чужой программой или другим пользователем — запускаться
    /// как обычно.
    Alone,
}

/// Личность пользователя для приветствия: `USERDOMAIN\USERNAME` из
/// переменных окружения. Нет переменной — пустая строка на её месте вместо
/// паники: единая личность на весь компьютер хуже, чем задуманная защита на
/// пользователя, но лучше, чем совсем без единого экземпляра.
pub fn current_identity() -> String {
    format!(
        "{}\\{}",
        std::env::var("USERDOMAIN").unwrap_or_default(),
        std::env::var("USERNAME").unwrap_or_default(),
    )
}

fn greeting(identity: &str) -> String {
    format!("{HELLO} {identity}")
}

pub fn claim(port: u16, identity: &str) -> Start {
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => Start::First(listener),
        Err(_) if ask_to_show(port, identity) => Start::Handed,
        Err(_) => Start::Alone,
    }
}

/// Второй экземпляр: просит первый показать окно. `true` — первый ответил.
pub fn ask_to_show(port: u16, identity: &str) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, WAIT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(WAIT));
    if writeln!(stream, "{}", greeting(identity)).is_err() {
        return false;
    }
    let mut line = String::new();
    // Ответ чужой программы читается не дальше `MAX_LINE` байт: без предела
    // она могла бы гнать байты без конца строки до самого таймаута.
    BufReader::new(stream.take(MAX_LINE)).read_line(&mut line).is_ok()
        && line.trim_end() == REPLY
}

/// Первый экземпляр: на приветствие со своей личностью отвечает и зовёт
/// `on_show`; на приветствие с чужой (другой пользователь на том же порту) —
/// не отвечает, соединение просто закрывается.
pub fn serve(listener: TcpListener, identity: String, on_show: impl Fn() + Send + 'static) {
    std::thread::spawn(move || {
        let expected = greeting(&identity);
        for stream in listener.incoming().flatten() {
            let _ = stream.set_read_timeout(Some(WAIT));
            let mut line = String::new();
            // Порт открыт любой программе на этом компьютере: приветствие —
            // одна короткая строка, и дальше `MAX_LINE` байт никто не читается.
            // Клиент без конца строки обрывается сразу, а не по таймауту, и
            // следующее соединение обслуживается как обычно.
            if BufReader::new((&stream).take(MAX_LINE)).read_line(&mut line).is_ok()
                && line.trim_end() == expected
            {
                let _ = (&stream).write_all(format!("{REPLY}\n").as_bytes());
                on_show();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    const WHO: &str = r"TESTDOMAIN\tester";

    fn free_port() -> u16 {
        TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port()
    }

    #[test]
    fn the_port_is_not_the_one_gacha_hub_listened_on() {
        // Прежняя версия слушала 47631: общий порт лишил бы Kitsudock защиты
        // от второго экземпляра, пока Gacha Hub запущен.
        assert_ne!(PORT, 47631);
    }

    #[test]
    fn a_free_port_makes_this_instance_the_first() {
        assert!(matches!(claim(free_port(), WHO), Start::First(_)));
    }

    #[test]
    fn a_second_instance_hands_over_to_the_first() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        serve(listener, WHO.to_string(), move || {
            let _ = tx.send(());
        });
        assert!(matches!(claim(port, WHO), Start::Handed));
        rx.recv_timeout(Duration::from_secs(2)).expect("первый экземпляр получил просьбу показать окно");
    }

    #[test]
    fn a_different_users_greeting_gets_no_reply() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel::<()>();
        serve(listener, WHO.to_string(), move || {
            let _ = tx.send(());
        });
        assert!(matches!(claim(port, r"OTHERDOMAIN\other"), Start::Alone));
        assert!(rx.try_recv().is_err(), "окно чужого пользователя показывать не просили");
    }

    /// Подключается, шлёт `bytes` байт без перевода строки и ждёт: сервер
    /// должен оборвать чтение сам, не дожидаясь ни конца строки, ни таймаута.
    /// Возвращает, сколько байт ответа пришло до закрытия соединения. Сброс
    /// соединения тоже считается закрытием: сокет с непрочитанным хвостом
    /// Windows закрывает именно так.
    fn send_without_newline(port: u16, bytes: usize) -> usize {
        use std::io::ErrorKind;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let _ = stream.write_all(&vec![b'x'; bytes]);
        let mut reply = Vec::new();
        match stream.read_to_end(&mut reply) {
            Ok(_) => {}
            Err(e) if matches!(e.kind(), ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted) => {}
            Err(e) => panic!("сервер не закрыл соединение: {e}"),
        }
        reply.len()
    }

    #[test]
    fn a_client_that_never_ends_its_line_is_dropped_and_the_listener_keeps_serving() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        serve(listener, WHO.to_string(), move || {
            let _ = tx.send(());
        });

        let started = std::time::Instant::now();
        let got = send_without_newline(port, 1024);
        assert_eq!(got, 0, "плохому клиенту не отвечают");
        assert!(
            started.elapsed() < Duration::from_millis(400),
            "сервер ждал конца строки, вместо того чтобы оборвать чтение на пределе"
        );
        assert!(rx.try_recv().is_err(), "окно по такому запросу не показывают");

        // Следующий нормальный экземпляр обслуживается как обычно.
        assert!(matches!(claim(port, WHO), Start::Handed));
        rx.recv_timeout(Duration::from_secs(2)).expect("первый экземпляр получил просьбу показать окно");
    }

    #[test]
    fn a_reply_that_never_ends_its_line_is_not_read_past_the_limit() {
        let foreign = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = foreign.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in foreign.incoming().flatten() {
                // Ответ без перевода строки и заметно длиннее предела; соединение
                // остаётся открытым, как у зависшей чужой программы.
                let _ = (&stream).write_all(&vec![b'y'; 4096]);
                std::thread::sleep(Duration::from_secs(3));
            }
        });
        let started = std::time::Instant::now();
        assert!(!ask_to_show(port, WHO));
        assert!(started.elapsed() < Duration::from_millis(400), "ответ читался без предела");
    }

    #[test]
    fn a_foreign_program_on_the_port_is_not_taken_for_us() {
        let foreign = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = foreign.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in foreign.incoming().flatten() {
                let _ = (&stream).write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
            }
        });
        assert!(matches!(claim(port, WHO), Start::Alone));
    }
}
