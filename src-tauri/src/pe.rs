//! Разбор исполняемого файла Windows ради одной вещи: достать иконку.
//!
//! Написано своими силами и без единой строки `unsafe` намеренно. Обращение к
//! системной функции Windows или сторонняя библиотека сделали бы то же самое,
//! но небезопасный код в них всё равно выполняется — он просто перестаёт быть
//! виден. Проект готовится к публикации, и утверждение «здесь нет
//! небезопасного кода» должно быть правдой, которую любой проверит.
//!
//! Отсюда правило всего модуля: **любое неверное смещение возвращает `None`**.
//! Файл может быть обрезан, повреждён или вообще не быть программой — ответом
//! будет «картинки нет», но никогда не паника.

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Число из двух байтов, младшим вперёд. `None`, если байтов не хватает.
fn u16_at(b: &[u8], off: usize) -> Option<u16> {
    let s = b.get(off..off.checked_add(2)?)?;
    Some(u16::from_le_bytes([s[0], s[1]]))
}

/// Число из четырёх байтов, младшим вперёд. `None`, если байтов не хватает.
fn u32_at(b: &[u8], off: usize) -> Option<u32> {
    let s = b.get(off..off.checked_add(4)?)?;
    Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// Секция файла: где она лежит в памяти и где в самом файле.
struct Section {
    virtual_address: u32,
    virtual_size: u32,
    raw_offset: u32,
    raw_size: u32,
}

/// Секции файла и адрес таблицы ресурсов.
///
/// Путь по заголовкам: в начале лежит старый заголовок MS-DOS, у него по
/// смещению 0x3C записано, где начинается настоящий заголовок. Дальше подпись
/// «PE\0\0», за ней заголовок с числом секций, за ним необязательный заголовок,
/// в конце которого — таблица каталогов; второй каталог и есть ресурсы.
fn sections_and_resources(b: &[u8]) -> Option<(Vec<Section>, u32)> {
    if b.get(..2)? != b"MZ" {
        return None;
    }
    let pe = u32_at(b, 0x3C)? as usize;
    if b.get(pe..pe.checked_add(4)?)? != b"PE\0\0" {
        return None;
    }

    let coff = pe.checked_add(4)?;
    let section_count = u16_at(b, coff.checked_add(2)?)? as usize;
    let optional_size = u16_at(b, coff.checked_add(16)?)? as usize;
    let optional = coff.checked_add(20)?;

    // 0x10b — 32-разрядный файл, 0x20b — 64-разрядный. Отличаются они только
    // тем, где начинается таблица каталогов.
    let directories = match u16_at(b, optional)? {
        0x10b => optional.checked_add(96)?,
        0x20b => optional.checked_add(112)?,
        _ => return None,
    };
    // Второй каталог по счёту (нумерация с нуля) — таблица ресурсов.
    let resource_rva = u32_at(b, directories.checked_add(2 * 8)?)?;
    if resource_rva == 0 {
        return None;
    }

    let table = optional.checked_add(optional_size)?;
    let mut sections = Vec::with_capacity(section_count.min(96));
    for i in 0..section_count {
        let s = table.checked_add(i.checked_mul(40)?)?;
        sections.push(Section {
            virtual_size: u32_at(b, s.checked_add(8)?)?,
            virtual_address: u32_at(b, s.checked_add(12)?)?,
            raw_size: u32_at(b, s.checked_add(16)?)?,
            raw_offset: u32_at(b, s.checked_add(20)?)?,
        });
    }
    Some((sections, resource_rva))
}

/// Адрес в памяти переводится в смещение внутри файла: находим секцию, в
/// которую адрес попадает, и сдвигаемся на столько же от её начала в файле.
fn rva_to_file(sections: &[Section], rva: u32) -> Option<usize> {
    for s in sections {
        // `continue`, а не `?`: переполнение здесь испорчено именно у этой
        // секции, а не у файла целиком. Нужный адрес может лежать в одной из
        // следующих секций, и она вполне может оказаться исправной — выходить
        // из всего поиска из-за одной плохой записи нельзя.
        let Some(end) = s.virtual_address.checked_add(s.virtual_size) else {
            continue;
        };
        if rva >= s.virtual_address && rva < end {
            let inside = rva.checked_sub(s.virtual_address)?;
            if inside >= s.raw_size {
                return None;
            }
            return s.raw_offset.checked_add(inside).map(|v| v as usize);
        }
    }
    None
}

/// Тип ресурса «картинка иконки».
const RT_ICON: u32 = 3;

/// Тип ресурса «группа иконок». Группа — это оглавление: какие размеры есть и
/// под какими номерами лежат их картинки.
const RT_GROUP_ICON: u32 = 14;

/// Общий предел числа шагов на весь обход дерева ресурсов, а не на один
/// узел. Ограничение в `children` — только на одну запись; но записи трёх
/// уровней (тип, номер, язык) могут все указывать на один и тот же узел
/// следующего уровня, и тогда работа перемножается, а не складывается: три
/// уровня по 4096 записей — это уже около семидесяти миллиардов шагов при
/// файле в сотню килобайт. У настоящих программ иконок единицы, у самых
/// богатых — десятки, так что несколько сотен шагов на весь обход — предел
/// с большим запасом.
const MAX_RESOURCE_STEPS: usize = 512;

/// Ресурс: под каким номером лежит и где искать его содержимое.
struct Resource {
    id: u32,
    rva: u32,
    size: u32,
}

/// Собирает картинки иконок и их оглавления **за один обход**.
///
/// Ресурсы лежат деревом ровно из трёх уровней: тип, номер, язык. У каждого
/// узла сначала шестнадцать байт заголовка, потом записи по восемь байт.
/// Старший бит в записи означает «дальше ещё узел», иначе это лист.
///
/// Обход один на оба типа, а не по обходу на каждый, потому что бюджет шагов
/// общий (см. `MAX_RESOURCE_STEPS`). Два прохода дали бы по полному бюджету
/// каждому — то есть тихо удвоили бы границу, ради которой он заведён.
fn collect_resources(
    b: &[u8],
    sections: &[Section],
    resource_rva: u32,
) -> (Vec<Resource>, Vec<Resource>) {
    let mut icons = Vec::new();
    let mut groups = Vec::new();
    let Some(root) = rva_to_file(sections, resource_rva) else {
        return (icons, groups);
    };

    // Бюджет общий на весь обход и передаётся во все вызовы `children`, а не
    // заводится заново на каждом уровне — иначе повторно используемый узел
    // обошёл бы поштучный предел, размножая работу через уровни дерева.
    let mut budget = MAX_RESOURCE_STEPS;

    for (type_id, type_off) in children(b, root, root, &mut budget) {
        let into = match type_id {
            RT_ICON => &mut icons,
            RT_GROUP_ICON => &mut groups,
            _ => continue,
        };
        for (name_id, name_off) in children(b, root, type_off, &mut budget) {
            for (_, lang_off) in children(b, root, name_off, &mut budget) {
                // Лист: адрес данных и их размер. `checked_add`, как и везде
                // в модуле — единственное место, где раньше складывали
                // смещение напрямую (правило заявлено в заголовке файла).
                let Some(size_off) = lang_off.checked_add(4) else {
                    continue;
                };
                let (Some(rva), Some(size)) = (u32_at(b, lang_off), u32_at(b, size_off)) else {
                    continue;
                };
                into.push(Resource { id: name_id, rva, size });
            }
        }
    }
    (icons, groups)
}

/// Содержимое ресурса.
fn resource_bytes<'a>(b: &'a [u8], sections: &[Section], res: &Resource) -> Option<&'a [u8]> {
    let start = rva_to_file(sections, res.rva)?;
    let end = start.checked_add(res.size as usize)?;
    b.get(start..end)
}

/// Записи оглавления группы: ширина картинки и номер ресурса, в котором она
/// лежит.
///
/// Оглавление устроено так: шесть байт заголовка, дальше записи по
/// четырнадцать. Ширина занимает **один байт**, поэтому число 256 в него не
/// помещается и записывается нулём.
///
/// Номер картинки, уже встречавшийся в оглавлении, пропускается: остаётся
/// первая запись. Картинка по номеру всё равно одна, и повторы ничего не
/// добавляют — только заставили бы копировать одно и то же по разу на запись,
/// а их в оглавлении до 65 535.
fn group_members(dir: &[u8]) -> Vec<(u32, u32)> {
    let Some(count) = u16_at(dir, 4) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for i in 0..count as usize {
        let Some(entry) = i.checked_mul(14).and_then(|o| o.checked_add(6)) else {
            break;
        };
        let Some(width) = dir.get(entry).copied() else {
            break;
        };
        let Some(id) = u16_at(dir, entry.saturating_add(12)) else {
            break;
        };
        if seen.insert(id) {
            out.push((if width == 0 { 256 } else { width as u32 }, id as u32));
        }
    }
    out
}

/// Записи одного узла дерева. Возвращает пары «номер, смещение».
///
/// Для узла отдаётся смещение следующего узла, для листа — смещение записи с
/// данными. Различаются они старшим битом, и вызывающий знает по уровню, что
/// именно получил.
///
/// `budget` общий на весь обход (см. `MAX_RESOURCE_STEPS`): каждая
/// рассмотренная запись стоит одну единицу, и как только он заканчивается,
/// узел возвращает уже собранное и дальше не читает — независимо от того,
/// сколько раз до этого узла уже добирались с других ветвей дерева.
fn children(b: &[u8], root: usize, node: usize, budget: &mut usize) -> Vec<(u32, usize)> {
    let mut out = Vec::new();
    let Some(named) = u16_at(b, node.saturating_add(12)) else {
        return out;
    };
    let Some(by_id) = u16_at(b, node.saturating_add(14)) else {
        return out;
    };
    // Переполнение здесь безопасно: сложение упирается в предел, а чтение по
    // запредельному смещению всё равно вернёт None и цикл прервётся.
    let total = named as usize + by_id as usize;
    for i in 0..total.min(4096) {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let entry = node.saturating_add(16).saturating_add(i.saturating_mul(8));
        let Some(id) = u32_at(b, entry) else { break };
        let Some(offset) = u32_at(b, entry.saturating_add(4)) else { break };
        out.push((id, root.saturating_add((offset & 0x7FFF_FFFF) as usize)));
    }
    out
}

/// Картинки иконки в том порядке, в каком их стоит пробовать: самая крупная
/// первой. Пусто, если файл не разобрался или иконок в нём нет.
///
/// **Выбирается группа, а не отдельная картинка, и это главное здесь.** В
/// одном файле групп может быть несколько, и Windows показывает ту, у которой
/// наименьший номер. У Wuthering Waves групп ровно две: под номером 101 лежит
/// настоящая иконка игры, под номером 123 — шаблонный логотип движка,
/// оставшийся от сборки. Перебор картинок подряд, без оглядки на группы,
/// приводил именно ко второй.
///
/// Заодно отпало правило «взять PNG размером 256»: нужная картинка Wuthering
/// Waves записана в старом формате, и по этому правилу не подходила вовсе.
/// Размер берётся из оглавления, разбирать саму картинку ради него не нужно.
///
/// **Читается не весь файл, а заголовки и одна секция с ресурсами.** Размер
/// исполняемого файла игры ничего не говорит о том, велика ли иконка:
/// `GenshinImpact.exe` занимает 444 МБ, а таблица ресурсов в нём — последние
/// полмегабайта. Раньше файл читался целиком под потолком в 100 МБ, и такая
/// игра оставалась без иконки. Теперь с начала берутся `HEADER_BYTES` ради
/// таблицы секций, затем по ней находится секция, в которую попадает адрес
/// таблицы ресурсов, и читается только она (не больше
/// `MAX_RESOURCE_SECTION_BYTES`). Любая ошибка ввода-вывода — то же «картинки
/// нет», что и у кривого файла, а не сбой.
pub fn icon_candidates_in_file(path: &Path) -> Vec<Vec<u8>> {
    read_candidates(path).unwrap_or_default()
}

/// Сколько читается с начала файла ради таблицы секций. Заголовки MS-DOS и PE
/// у настоящих программ занимают первые килобайты; 64 КБ — с большим запасом.
/// Если таблица секций не поместилась, файл считается неразобранным.
const HEADER_BYTES: u64 = 64 * 1024;

/// Потолок на секцию с ресурсами. У настоящих программ она — от десятков
/// килобайт до единиц мегабайт (у Genshin Impact полмегабайта); секция больше
/// потолка — признак испорченного заголовка, и читать её целиком незачем.
/// Тот же потолок — на сумму всех картинок, которые отдаёт разбор
/// (`copy_within_budget`).
const MAX_RESOURCE_SECTION_BYTES: u64 = 32 * 1024 * 1024;

/// Тело `icon_candidates_in_file`: `None` на любой неудаче, чтобы можно было
/// пользоваться `?` вместо вложенных проверок.
fn read_candidates(path: &Path) -> Option<Vec<Vec<u8>>> {
    let mut file = File::open(path).ok()?;
    let mut head = Vec::new();
    (&mut file).take(HEADER_BYTES).read_to_end(&mut head).ok()?;
    let (sections, resource_rva) = sections_and_resources(&head)?;

    // Секция, в которую попадает адрес таблицы ресурсов. Условие то же, что в
    // `rva_to_file`: испорченная запись пропускается, а не обрывает поиск.
    let section = sections.iter().find(|s| {
        s.virtual_address
            .checked_add(s.virtual_size)
            .is_some_and(|end| resource_rva >= s.virtual_address && resource_rva < end)
    })?;
    // Размер проверяется до чтения: секция больше потолка не читается вовсе,
    // а не обрезается — обрезанное дерево ресурсов всё равно не разобрать.
    if u64::from(section.raw_size) > MAX_RESOURCE_SECTION_BYTES {
        return None;
    }

    file.seek(SeekFrom::Start(u64::from(section.raw_offset))).ok()?;
    let mut bytes = Vec::new();
    file.take(u64::from(section.raw_size)).read_to_end(&mut bytes).ok()?;

    // Прочитанная секция лежит в памяти с нуля, поэтому в `candidates_in` она
    // уходит единственной, со смещением 0: перевод адреса в смещение и все
    // его проверки остаются теми же, что и при разборе файла целиком. Размер в
    // файле — то, что реально прочиталось: файл мог оказаться короче заявленного.
    let local = Section {
        virtual_address: section.virtual_address,
        virtual_size: section.virtual_size,
        raw_offset: 0,
        raw_size: bytes.len() as u32,
    };
    Some(candidates_in(&bytes, &[local], resource_rva))
}

/// То же, что `icon_candidates_in_file`, но по файлу, уже целиком лежащему в
/// памяти. Боевой код читает с диска только нужное и этой функцией не
/// пользуется; она остаётся для тестов — эталон, с которым сверяется чтение
/// по частям.
#[cfg(test)]
fn icon_candidates(bytes: &[u8]) -> Vec<Vec<u8>> {
    let Some((sections, resource_rva)) = sections_and_resources(bytes) else {
        return Vec::new();
    };
    candidates_in(bytes, &sections, resource_rva)
}

/// Копирует содержимое картинок по порядку, пока сумма скопированного не
/// упрётся в `MAX_RESOURCE_SECTION_BYTES`: картинка, после которой сумма
/// стала бы больше, и все за ней не берутся.
///
/// Предел нужен потому, что размер в листе ресурса — число из файла: сумма
/// размеров картинок ничем не связана с размером секции, и копировать всё
/// подряд значило бы отдать расход памяти на откуп файлу. У настоящих файлов
/// суммарный вес картинок не превышает секцию, в которой они лежат, так что
/// границу, равную её потолку, они не заденут. Копия делается только после
/// проверки, поэтому предел ограничивает и память.
fn copy_within_budget<'a>(pictures: impl Iterator<Item = &'a [u8]>) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut total = 0u64;
    for bytes in pictures {
        let Some(next) = total.checked_add(bytes.len() as u64) else {
            break;
        };
        if next > MAX_RESOURCE_SECTION_BYTES {
            break;
        }
        total = next;
        out.push(bytes.to_vec());
    }
    out
}

/// Выбор без разбора заголовков файла: секции и адрес таблицы уже найдены.
/// Вынесено отдельно ради тестов — собрать дерево ресурсов в памяти куда
/// проще, чем целый исполняемый файл.
fn candidates_in(b: &[u8], sections: &[Section], resource_rva: u32) -> Vec<Vec<u8>> {
    let (icons, groups) = collect_resources(b, sections, resource_rva);

    // Оглавления нет вовсе — редкий случай, выбирать не из чего. Берём все
    // картинки, начиная с самой тяжёлой: без оглавления размер картинки
    // иначе как разбором её самой не узнать, а вес — приемлемая замена.
    let Some(group) = groups.iter().min_by_key(|g| g.id) else {
        let mut loose: Vec<&Resource> = icons.iter().collect();
        loose.sort_by_key(|r| std::cmp::Reverse(r.size));
        return copy_within_budget(
            loose.into_iter().filter_map(|r| resource_bytes(b, sections, r)),
        );
    };

    let Some(dir) = resource_bytes(b, sections, group) else {
        return Vec::new();
    };
    let mut members = group_members(dir);
    // Сортировка устойчивая: при равной ширине порядок остаётся тем, что задан
    // в оглавлении. У Honkai: Star Rail две картинки по 256 подряд, и от этого
    // зависит, какая из них станет иконкой.
    members.sort_by_key(|(width, _)| std::cmp::Reverse(*width));
    copy_within_budget(
        members
            .into_iter()
            .filter_map(|(_, id)| icons.iter().find(|r| r.id == id))
            .filter_map(|r| resource_bytes(b, sections, r)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, SeekFrom, Write};
    use std::path::PathBuf;

    #[test]
    fn u32_at_reads_a_little_endian_number() {
        let b = [0x78, 0x56, 0x34, 0x12];
        assert_eq!(u32_at(&b, 0), Some(0x12345678));
    }

    #[test]
    fn u32_at_refuses_to_read_past_the_end() {
        // Смещение за границей не должно ронять программу: весь разбор
        // построен на том, что кривой файл даёт None, а не панику.
        let b = [0x01, 0x02];
        assert_eq!(u32_at(&b, 0), None);
        assert_eq!(u32_at(&b, 100), None);
    }

    #[test]
    fn u16_at_refuses_to_read_past_the_end() {
        let b = [0x01];
        assert_eq!(u16_at(&b, 0), None);
    }

    #[test]
    fn rva_to_file_skips_a_section_with_overflowing_bounds_and_keeps_looking() {
        // Первая секция испорчена: адрес плюс размер переполняют u32. Раньше
        // `?` в `rva_to_file` прерывал весь поиск на этом месте, и вторая,
        // исправная секция даже не проверялась — хотя искомый адрес лежит
        // именно в ней.
        let sections = [
            Section {
                virtual_address: u32::MAX - 10,
                virtual_size: 1000,
                raw_offset: 0,
                raw_size: 100,
            },
            Section {
                virtual_address: 0x1000,
                virtual_size: 0x100,
                raw_offset: 0x400,
                raw_size: 0x100,
            },
        ];
        assert_eq!(rva_to_file(&sections, 0x1010), Some(0x410));
    }

    #[test]
    fn garbage_input_does_not_panic() {
        // Главное свойство модуля: что бы ни пришло на вход, ответ либо
        // картинки, либо пусто, но никогда не паника.
        assert!(icon_candidates(&[]).is_empty());
        assert!(icon_candidates(&[0u8; 3]).is_empty());
        assert!(icon_candidates(&[0xFFu8; 1024]).is_empty());
        let almost = {
            let mut v = vec![0u8; 64];
            v[0] = b'M';
            v[1] = b'Z';
            v[0x3C] = 200; // указывает за пределы файла
            v
        };
        assert!(icon_candidates(&almost).is_empty());
    }

    /// Строит один узел дерева ресурсов: 16 байт заголовка (важно только
    /// число записей по смещению 14) и `count` одинаковых записей по 8 байт
    /// — пара «номер, смещение», где смещение уже отсчитано от корня.
    fn resource_node(count: u16, id: u32, offset: u32) -> Vec<u8> {
        let mut node = vec![0u8; 16];
        node[14..16].copy_from_slice(&count.to_le_bytes());
        for _ in 0..count {
            node.extend_from_slice(&id.to_le_bytes());
            node.extend_from_slice(&offset.to_le_bytes());
        }
        node
    }

    #[test]
    fn collect_icons_bounds_total_work_even_when_the_tree_reuses_nodes() {
        // Подлог: записи каждого уровня ссылаются не на разные узлы, а на
        // один и тот же. Дерево из трёх уровней по 32 записи разворачивается
        // не в 96 действий, а в 32*32*32 = 32768 — множитель, а не сумма.
        // У настоящих файлов такого повторного использования не бывает, но
        // формат этого не запрещает, а обход не имел общего предела.
        const N: u16 = 32;

        let root_len = 16 + N as u32 * 8;
        let name_off = root_len;
        let name_len = 16 + N as u32 * 8;
        let lang_off = name_off + name_len;
        let lang_len = 16 + N as u32 * 8;
        let leaf_off = lang_off + lang_len;

        let mut b = resource_node(N, RT_ICON, name_off);
        b.extend(resource_node(N, 0, lang_off));
        b.extend(resource_node(N, 0, leaf_off));
        b.extend_from_slice(&0u32.to_le_bytes()); // rva листа
        b.extend_from_slice(&8u32.to_le_bytes()); // размер листа

        let sections = [Section {
            virtual_address: 0,
            virtual_size: b.len() as u32,
            raw_offset: 0,
            raw_size: b.len() as u32,
        }];

        let (found, _) = collect_resources(&b, &sections, 0);
        assert!(
            found.len() < MAX_RESOURCE_STEPS,
            "обход должен быть ограничен общим бюджетом на весь разбор, а не \
             размножаться по числу совпавших узлов: получено {} записей",
            found.len()
        );
    }

    /// Узел дерева из перечисленных записей «номер, смещение от корня».
    fn node(entries: &[(u32, u32)]) -> Vec<u8> {
        let mut out = vec![0u8; 16];
        out[14..16].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        for (id, offset) in entries {
            out.extend_from_slice(&id.to_le_bytes());
            out.extend_from_slice(&offset.to_le_bytes());
        }
        out
    }

    /// Лист: адрес содержимого и его длина.
    fn leaf(rva: u32, size: u32) -> Vec<u8> {
        let mut out = vec![0u8; 16];
        out[0..4].copy_from_slice(&rva.to_le_bytes());
        out[4..8].copy_from_slice(&size.to_le_bytes());
        out
    }

    /// Оглавление группы из записей «ширина, номер картинки».
    fn group_dir(members: &[(u8, u16)]) -> Vec<u8> {
        let mut out = vec![0u8; 6];
        out[2..4].copy_from_slice(&1u16.to_le_bytes()); // тип: иконка
        out[4..6].copy_from_slice(&(members.len() as u16).to_le_bytes());
        for (width, id) in members {
            let mut entry = vec![0u8; 14];
            entry[0] = *width;
            entry[12..14].copy_from_slice(&id.to_le_bytes());
            out.extend_from_slice(&entry);
        }
        out
    }

    /// Секция, отображающая адреса в файл один в один.
    fn whole(b: &[u8]) -> [Section; 1] {
        [Section {
            virtual_address: 0,
            virtual_size: b.len() as u32,
            raw_offset: 0,
            raw_size: b.len() as u32,
        }]
    }

    /// Дерево ресурсов с двумя картинками (номера 1 и 2, содержимое `REAL` и
    /// `LOGO`) и двумя группами. Группа 123 записана **первой**, группа 101
    /// второй — нарочно наоборот против порядка по номеру, чтобы тест доказал:
    /// выбор идёт по номеру группы, а не по месту в дереве.
    fn tree(dir_123: &[(u8, u16)], dir_101: &[(u8, u16)]) -> Vec<u8> {
        tree_at(0, dir_123, dir_101)
    }

    /// То же дерево, но секция с ним начинается с адреса `base`, а не с нуля:
    /// адреса листов в нём абсолютные, а смещения между узлами — от корня.
    fn tree_at(base: u32, dir_123: &[(u8, u16)], dir_101: &[(u8, u16)]) -> Vec<u8> {
        let (icon1, icon2) = (&b"REAL"[..], &b"LOGO"[..]);
        let (d123, d101) = (group_dir(dir_123), group_dir(dir_101));
        let p_icon1 = base + 256;
        let p_icon2 = p_icon1 + icon1.len() as u32;
        let p_123 = p_icon2 + icon2.len() as u32;
        let p_101 = p_123 + d123.len() as u32;

        let mut b = Vec::new();
        b.extend(node(&[(RT_ICON, 32), (RT_GROUP_ICON, 112)])); // корень
        b.extend(node(&[(1, 64), (2, 88)])); // тип «картинка»
        b.extend(node(&[(0, 192)])); // имя картинки 1
        b.extend(node(&[(0, 208)])); // имя картинки 2
        b.extend(node(&[(123, 144), (101, 168)])); // тип «группа»
        b.extend(node(&[(0, 224)])); // имя группы 123
        b.extend(node(&[(0, 240)])); // имя группы 101
        b.extend(leaf(p_icon1, icon1.len() as u32));
        b.extend(leaf(p_icon2, icon2.len() as u32));
        b.extend(leaf(p_123, d123.len() as u32));
        b.extend(leaf(p_101, d101.len() as u32));
        assert_eq!(b.len(), 256, "узлы и листы должны занять ровно 256 байт");
        b.extend_from_slice(icon1);
        b.extend_from_slice(icon2);
        b.extend_from_slice(&d123);
        b.extend_from_slice(&d101);
        b
    }

    #[test]
    fn the_group_with_the_lowest_number_wins_over_the_one_listed_first() {
        // Случай Wuthering Waves: в файле две группы, 101 с иконкой игры и 123
        // с логотипом движка. Перебор картинок подряд, без групп, выбирал
        // логотип: первый PNG размером 256 принадлежал группе 123.
        let b = tree(&[(0, 2)], &[(0, 1)]);
        assert_eq!(candidates_in(&b, &whole(&b), 0), vec![b"REAL".to_vec()]);
    }

    #[test]
    fn inside_a_group_the_widest_picture_comes_first() {
        // Ширина берётся из оглавления, а не из самой картинки: разбирать её
        // ради размера не нужно, и для старого формата это важно — там размер
        // лежит в другом месте, чем у PNG.
        let b = tree(&[(0, 2)], &[(32, 2), (0, 1)]);
        assert_eq!(
            candidates_in(&b, &whole(&b), 0),
            vec![b"REAL".to_vec(), b"LOGO".to_vec()],
            "картинка на 256 точек должна опередить картинку на 32"
        );
    }

    #[test]
    fn without_any_group_the_heaviest_picture_comes_first() {
        // Запасной путь: оглавления нет, размер узнать неоткуда, и вес
        // остаётся единственным признаком.
        let mut b = Vec::new();
        b.extend(node(&[(RT_ICON, 24)])); // корень: только картинки
        b.extend(node(&[(1, 56), (2, 80)])); // тип «картинка»
        b.extend(node(&[(0, 104)])); // имя картинки 1
        b.extend(node(&[(0, 120)])); // имя картинки 2
        b.extend(leaf(136, 2)); // картинка 1 — два байта
        b.extend(leaf(138, 6)); // картинка 2 — шесть байт
        assert_eq!(b.len(), 136, "узлы и листы должны занять ровно 136 байт");
        b.extend_from_slice(b"XXYYYYYY");
        assert_eq!(
            candidates_in(&b, &whole(&b), 0),
            vec![b"YYYYYY".to_vec(), b"XX".to_vec()]
        );
    }

    /// Исполняемый файл на диске. В начале — заголовки с секциями из
    /// `sections` (адрес, размер в памяти, размер в файле, смещение в файле) и
    /// адресом таблицы ресурсов `resource_rva`; `body` лежит по смещению `at`.
    /// Всё между заголовками и `body` — пустота, как у настоящей игры на
    /// сотни мегабайт, где нужная секция прячется в самом конце.
    fn write_pe(
        tag: &str,
        resource_rva: u32,
        sections: &[(u32, u32, u32, u32)],
        body: &[u8],
        at: u64,
    ) -> PathBuf {
        let mut h = vec![0u8; 0x400];
        h[0..2].copy_from_slice(b"MZ");
        h[0x3C..0x40].copy_from_slice(&0x80u32.to_le_bytes()); // где настоящий заголовок
        h[0x80..0x84].copy_from_slice(b"PE\0\0");
        h[0x86..0x88].copy_from_slice(&(sections.len() as u16).to_le_bytes());
        h[0x94..0x96].copy_from_slice(&240u16.to_le_bytes()); // размер необязательного заголовка
        h[0x98..0x9A].copy_from_slice(&0x20bu16.to_le_bytes()); // 64-разрядный
        h[0x118..0x11C].copy_from_slice(&resource_rva.to_le_bytes()); // каталог ресурсов
        for (i, (va, virtual_size, raw_size, raw_offset)) in sections.iter().enumerate() {
            let s = 0x188 + i * 40; // таблица секций идёт сразу за необязательным заголовком
            h[s + 8..s + 12].copy_from_slice(&virtual_size.to_le_bytes());
            h[s + 12..s + 16].copy_from_slice(&va.to_le_bytes());
            h[s + 16..s + 20].copy_from_slice(&raw_size.to_le_bytes());
            h[s + 20..s + 24].copy_from_slice(&raw_offset.to_le_bytes());
        }

        let path = std::env::temp_dir().join(format!("gh-pe-{tag}-{}.exe", std::process::id()));
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(&h).unwrap();
        f.seek(SeekFrom::Start(at)).unwrap();
        f.write_all(body).unwrap();
        path
    }

    #[test]
    fn a_resource_section_far_from_the_start_gives_what_reading_the_whole_file_gives() {
        // Случай GenshinImpact.exe: файл на 444 МБ, а ресурсы — в последних
        // полумегабайте. Читать надо заголовки и эту секцию, остальное
        // не нужно, и результат при этом обязан совпасть с чтением целиком.
        let va = 0x2000;
        let body = tree_at(va, &[(0, 2)], &[(32, 2), (0, 1)]);
        let at = 4 * 1024 * 1024u64;
        let size = body.len() as u32;
        let path = write_pe(
            "far-end",
            va,
            &[(0x1000, 0x200, 0x200, 0x400), (va, size, size, at as u32)],
            &body,
            at,
        );

        let whole = std::fs::read(&path).unwrap();
        assert!(whole.len() as u64 > at, "ресурсы должны лежать далеко за заголовками");
        let from_file = icon_candidates_in_file(&path);
        assert_eq!(from_file, icon_candidates(&whole));
        assert_eq!(from_file, vec![b"REAL".to_vec(), b"LOGO".to_vec()]);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_resource_section_over_the_ceiling_is_refused_without_reading_it() {
        // Заголовок заявляет секцию на байт больше потолка, хотя сам файл
        // крошечный и дерево лежит прямо по заявленному смещению. Чтение
        // «сколько есть, но не больше потолка» нашло бы иконку — а должно
        // отказаться, не читая вовсе.
        let va = 0x2000;
        let body = tree_at(va, &[(0, 2)], &[(0, 1)]);
        let claimed = MAX_RESOURCE_SECTION_BYTES as u32 + 1;
        let path =
            write_pe("over-ceiling", va, &[(va, claimed, claimed, 0x400)], &body, 0x400);
        assert!(icon_candidates_in_file(&path).is_empty());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_resource_section_exactly_at_the_ceiling_is_accepted() {
        // Граница включительно, как у `hub::exceeds_hub_ceiling`. Файл при
        // этом короче заявленного: берётся то, что есть.
        let va = 0x2000;
        let body = tree_at(va, &[(0, 2)], &[(0, 1)]);
        let claimed = MAX_RESOURCE_SECTION_BYTES as u32;
        let path = write_pe("at-ceiling", va, &[(va, claimed, claimed, 0x400)], &body, 0x400);
        assert_eq!(icon_candidates_in_file(&path), vec![b"REAL".to_vec()]);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_missing_file_has_no_icon_and_does_not_panic() {
        assert!(icon_candidates_in_file(Path::new(r"C:\nope\never\missing.exe")).is_empty());
    }

    #[test]
    fn a_file_that_is_not_an_executable_has_no_icon() {
        let path = std::env::temp_dir().join(format!("gh-pe-garbage-{}.exe", std::process::id()));
        std::fs::write(&path, [0xFFu8; 4096]).unwrap();
        assert!(icon_candidates_in_file(&path).is_empty());
        std::fs::write(&path, b"MZ").unwrap(); // обрезан сразу после подписи
        assert!(icon_candidates_in_file(&path).is_empty());
        std::fs::remove_file(&path).ok();
    }

    /// Дерево ресурсов из любого числа картинок и, при желании, одной группы
    /// под номером 101. Картинка — тройка «номер, адрес содержимого, длина»;
    /// содержимое разных картинок вправе лежать друг поверх друга: формат
    /// этого не запрещает. Смещения между узлами считаются от корня, адреса
    /// листов — абсолютные, как в `tree_at`.
    fn icon_tree(icons: &[(u32, u32, u32)], group: Option<(u32, u32)>) -> Vec<u8> {
        let n = icons.len() as u32;
        let root_len = 16 + 8 * (1 + u32::from(group.is_some()));
        let icon_type = root_len;
        let icon_names = icon_type + 16 + 8 * n; // дальше n узлов-имён по 24 байта
        let after_names = icon_names + 24 * n;
        let (group_type, group_name, leaves) = if group.is_some() {
            (after_names, after_names + 24, after_names + 48)
        } else {
            (0, 0, after_names)
        };
        let group_leaf = leaves + 16 * n;

        let mut root = vec![(RT_ICON, icon_type)];
        if group.is_some() {
            root.push((RT_GROUP_ICON, group_type));
        }
        let mut b = node(&root);
        let by_id: Vec<(u32, u32)> = icons
            .iter()
            .enumerate()
            .map(|(i, (id, _, _))| (*id, icon_names + 24 * i as u32))
            .collect();
        b.extend(node(&by_id));
        for i in 0..n {
            b.extend(node(&[(0, leaves + 16 * i)]));
        }
        if group.is_some() {
            b.extend(node(&[(101, group_name)]));
            b.extend(node(&[(0, group_leaf)]));
        }
        for (_, rva, size) in icons {
            b.extend(leaf(*rva, *size));
        }
        if let Some((rva, size)) = group {
            b.extend(leaf(rva, size));
        }
        b
    }

    /// Ресурсы, у которых содержимое каждой картинки — начало одного общего
    /// `payload`: адрес у всех один, различаются номер и длина. Оглавление
    /// группы `dir`, если оно есть, лежит между деревом и `payload`. Секция
    /// начинается с адреса `base`.
    fn overlapping_icons(
        base: u32,
        icons: &[(u32, u32)],
        dir: Option<&[u8]>,
        payload: &[u8],
    ) -> Vec<u8> {
        let probe = icon_tree(&vec![(0, 0, 0); icons.len()], dir.map(|_| (0, 0)));
        let head = base + probe.len() as u32;
        let payload_at = head + dir.map_or(0, |d| d.len() as u32);
        let placed: Vec<(u32, u32, u32)> =
            icons.iter().map(|(id, size)| (*id, payload_at, *size)).collect();
        let mut b = icon_tree(&placed, dir.map(|d| (head, d.len() as u32)));
        if let Some(d) = dir {
            b.extend_from_slice(d);
        }
        b.extend_from_slice(payload);
        b
    }

    /// Сколько байт всего в найденных картинках.
    fn total_len(found: &[Vec<u8>]) -> u64 {
        found.iter().map(|p| p.len() as u64).sum()
    }

    #[test]
    fn group_members_keeps_only_the_first_entry_for_a_repeated_number() {
        let dir = group_dir(&[(32, 1), (0, 1), (16, 2), (0, 2)]);
        assert_eq!(group_members(&dir), vec![(32, 1), (16, 2)]);
    }

    #[test]
    fn a_group_repeating_one_picture_yields_it_once() {
        // Оглавление на предельные 65 535 записей, и все ведут к одной картинке:
        // копия на каждую запись раздувала бы ответ в десятки тысяч раз. В
        // сравнение идёт длина, а не сами списки — иначе провал печатал бы их
        // целиком.
        let payload = vec![7u8; 64];
        let dir = group_dir(&vec![(0u8, 1u16); 65_535]);
        let b = overlapping_icons(0, &[(1, payload.len() as u32)], Some(&dir), &payload);
        let found = candidates_in(&b, &whole(&b), 0);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0], payload);
    }

    /// Размер одной картинки в тестах про бюджет: достаточно мал, чтобы их
    /// набиралось много, и достаточно велик, чтобы без предела сумма
    /// перевалила за потолок.
    const EACH: usize = 1024 * 1024;

    #[test]
    fn a_group_stops_collecting_at_the_byte_budget() {
        // Картинки лежат друг поверх друга, и каждая в отдельности
        // укладывается в секцию, но вместе они в потолок не влезают. Бюджет
        // включительно: ровно на потолке — ещё можно, на байт больше — уже
        // нет.
        let fit = MAX_RESOURCE_SECTION_BYTES as usize / EACH;
        let payload = vec![7u8; EACH];
        let icons: Vec<(u32, u32)> = (1..=fit as u32 * 3).map(|id| (id, EACH as u32)).collect();
        let members: Vec<(u8, u16)> = icons.iter().map(|(id, _)| (0, *id as u16)).collect();
        let b = overlapping_icons(0, &icons, Some(&group_dir(&members)), &payload);
        let found = candidates_in(&b, &whole(&b), 0);
        assert_eq!(found.len(), fit);
        assert_eq!(total_len(&found), MAX_RESOURCE_SECTION_BYTES);
    }

    #[test]
    fn loose_pictures_stop_collecting_at_the_byte_budget() {
        // Тот же бюджет на запасном пути, где оглавления нет.
        let fit = MAX_RESOURCE_SECTION_BYTES as usize / EACH;
        let payload = vec![7u8; EACH];
        let icons: Vec<(u32, u32)> = (1..=fit as u32 * 3).map(|id| (id, EACH as u32)).collect();
        let b = overlapping_icons(0, &icons, None, &payload);
        let found = candidates_in(&b, &whole(&b), 0);
        assert_eq!(found.len(), fit);
        assert_eq!(total_len(&found), MAX_RESOURCE_SECTION_BYTES);
    }

    #[test]
    fn the_pictures_read_from_a_file_never_add_up_to_more_than_the_ceiling() {
        // Через настоящее чтение файла. Каждая картинка занимает больше
        // половины потолка, и целиком в секцию они укладываются только лёжа
        // друг на друге; сложенные вместе, превысили бы потолок.
        let va = 0x2000;
        let each = (MAX_RESOURCE_SECTION_BYTES / 8 * 5) as usize;
        let payload = vec![7u8; each];
        let icons = [(1, each as u32), (2, each as u32), (3, each as u32)];
        let dir = group_dir(&[(0, 1), (0, 2), (0, 3)]);
        let body = overlapping_icons(va, &icons, Some(&dir), &payload);
        let size = body.len() as u32;
        let path = write_pe("byte-budget", va, &[(va, size, size, 0x400)], &body, 0x400);

        let found = icon_candidates_in_file(&path);
        assert!(!found.is_empty(), "первая картинка укладывается в потолок и должна найтись");
        assert!(
            total_len(&found) <= MAX_RESOURCE_SECTION_BYTES,
            "картинок прочитано на {} байт при потолке {}",
            total_len(&found),
            MAX_RESOURCE_SECTION_BYTES
        );
        std::fs::remove_file(&path).ok();
    }
}
