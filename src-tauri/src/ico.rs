//! Ресурс иконки Windows — в PNG.
//!
//! Внутри исполняемого файла картинка иконки лежит в одном из двух видов:
//! готовым PNG или в старом несжатом формате (тот же заголовок, что у BMP,
//! строки снизу вверх, цвета в порядке «синий, зелёный, красный, прозрачность»).
//! Первый отдаётся как есть, второй собирается в PNG здесь.
//!
//! **Старый формат пришлось научиться читать, и вот почему.** Спека первой
//! части этапа 4 (§5.3) отказалась от него на том основании, что такого случая
//! нет ни у одной из пяти игр. Основание оказалось неверным: у Wuthering Waves
//! настоящая иконка игры лежит именно в старом формате, а PNG в том же файле —
//! шаблонный логотип движка, оставшийся от сборки. Без разбора старого формата
//! этой игре нечего показать, кроме буквы-заглушки.
//!
//! Сжатия здесь нет намеренно: PNG допускает «хранимые» блоки, то есть данные
//! без сжатия, и это позволяет собрать правильный файл без библиотеки сжатия.
//! Иконка 256×256 занимает при этом около 260 КБ — столько же, сколько у игр,
//! где PNG лежит внутри файла готовым.

/// Потолок стороны картинки. Формат иконок Windows не знает сторон больше 256,
/// но заголовок внутри ресурса — обычный, и написать там можно что угодно.
/// Без потолка испорченный файл заказал бы гигабайты памяти.
const MAX_SIDE: u32 = 1024;

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Потолок для готового PNG, который отдаётся как есть. Такую картинку никто
/// не разбирает: она ложится в кеш байт в байт и потом уходит окну. Настоящая
/// иконка 256×256 весит сотни килобайт; всё, что крупнее мегабайта или чьи
/// стороны, записанные в заголовке, больше `MAX_SIDE`, уступает место
/// следующей картинке группы.
const MAX_PNG_ICON_BYTES: usize = 1024 * 1024;

/// Число из двух байтов, младшим вперёд.
fn u16_at(b: &[u8], off: usize) -> Option<u16> {
    let s = b.get(off..off.checked_add(2)?)?;
    Some(u16::from_le_bytes([s[0], s[1]]))
}

/// Число из четырёх байтов, младшим вперёд.
fn u32_at(b: &[u8], off: usize) -> Option<u32> {
    let s = b.get(off..off.checked_add(4)?)?;
    Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// Число из четырёх байтов, старшим вперёд (так в PNG).
fn u32_be_at(b: &[u8], off: usize) -> Option<u32> {
    let s = b.get(off..off.checked_add(4)?)?;
    Some(u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

/// Ширина и высота готового PNG из заголовка IHDR — первого куска после подписи
/// (байты 16..24). Нет куска IHDR на месте или файл короче — `None`.
fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    if png.get(12..16)? != b"IHDR" {
        return None;
    }
    Some((u32_be_at(png, 16)?, u32_be_at(png, 20)?))
}

/// Картинка иконки в виде PNG — или `None`, если этот ресурс нам не по зубам.
///
/// `None` здесь не беда: вызывающий переходит к следующей картинке той же
/// группы, а если не подошла ни одна — игра получает букву-заглушку.
pub fn to_png(resource: &[u8]) -> Option<Vec<u8>> {
    if resource.get(..8) == Some(&PNG_MAGIC) {
        // Слишком большой готовый PNG — не иконка: пусть вызывающий возьмёт
        // следующую картинку группы. Размер в байтах мало что говорит о
        // размере картинки: стороны берутся из заголовка и не должны быть ни
        // нулевыми, ни больше потолка, как у картинки старого формата.
        let sides_fit = png_size(resource)
            .is_some_and(|(w, h)| (1..=MAX_SIDE).contains(&w) && (1..=MAX_SIDE).contains(&h));
        return (resource.len() <= MAX_PNG_ICON_BYTES && sides_fit).then(|| resource.to_vec());
    }
    let (width, height, pixels) = decode_dib(resource)?;
    Some(encode_png(width, height, &pixels))
}

/// Разбирает картинку в старом формате в набор точек «красный, зелёный, синий,
/// прозрачность».
///
/// Поддерживается только 32 бита на точку без сжатия. Остальные глубины (с
/// палитрой, по 4, 8 и 24 бита) встречаются у мелких размеров лесенки, а нам
/// нужен самый крупный — он такой всегда. Ради полноты разбирать их незачем:
/// не подошла эта картинка — вызывающий возьмёт следующую.
fn decode_dib(b: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let header_size = u32_at(b, 0)?;
    // Заголовки бывают длиннее сорока байт (расширенные версии), но начало у
    // всех одинаковое, и дальше заголовка мы ничего оттуда не читаем.
    if header_size < 40 {
        return None;
    }
    let width = u32_at(b, 4)?;
    // Высота записана удвоенной: сначала сама картинка, за ней маска
    // прозрачности той же высоты.
    let stored_height = u32_at(b, 8)?;
    let bit_count = u16_at(b, 14)?;
    let compression = u32_at(b, 16)?;
    let palette_entries = u32_at(b, 32)?;

    if bit_count != 32 || compression != 0 {
        return None;
    }
    let height = stored_height / 2;
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return None;
    }

    let row_bytes = width.checked_mul(4)? as usize;
    let start = (header_size as usize).checked_add((palette_entries as usize).checked_mul(4)?)?;
    let image = b.get(start..start.checked_add(row_bytes.checked_mul(height as usize)?)?)?;

    let mut pixels = Vec::with_capacity(image.len());
    // Строки записаны снизу вверх, поэтому читаем их с конца.
    for y in (0..height as usize).rev() {
        let row = image.get(y * row_bytes..(y + 1) * row_bytes)?;
        for point in row.chunks_exact(4) {
            pixels.extend_from_slice(&[point[2], point[1], point[0], point[3]]);
        }
    }

    // Картинка с полностью нулевой прозрачностью была бы невидимой целиком.
    // Такие встречаются: до появления прозрачности её место занимала отдельная
    // маска, и часть картинок так и осталась с ней. Берём прозрачность оттуда.
    if pixels.chunks_exact(4).all(|p| p[3] == 0) {
        apply_mask(b, start + row_bytes * height as usize, width, height, &mut pixels);
    }
    Some((width, height, pixels))
}

/// Накладывает отдельную маску прозрачности: один бит на точку, единица —
/// «здесь пусто». Строки, как и у картинки, идут снизу вверх, и каждая
/// дополняется до четырёх байт.
///
/// Маски может не оказаться на месте — тогда картинка остаётся полностью
/// непрозрачной. Это хуже правильных краёв, но лучше пустого места.
fn apply_mask(b: &[u8], start: usize, width: u32, height: u32, pixels: &mut [u8]) {
    let row_bytes = width.div_ceil(32) as usize * 4;
    for point in pixels.chunks_exact_mut(4) {
        point[3] = 255;
    }
    let Some(mask) = b.get(start..start.saturating_add(row_bytes * height as usize)) else {
        return;
    };
    for y in 0..height as usize {
        let row = &mask[(height as usize - 1 - y) * row_bytes..][..row_bytes];
        for x in 0..width as usize {
            if row[x / 8] & (0x80 >> (x % 8)) != 0 {
                pixels[(y * width as usize + x) * 4 + 3] = 0;
            }
        }
    }
}

/// Собирает PNG из точек «красный, зелёный, синий, прозрачность».
fn encode_png(width: u32, height: u32, pixels: &[u8]) -> Vec<u8> {
    let mut raw = Vec::with_capacity(pixels.len() + height as usize);
    for row in pixels.chunks(width as usize * 4) {
        // Каждая строка начинается с номера способа предсказания. Ноль —
        // «никакого», строка записана как есть.
        raw.push(0);
        raw.extend_from_slice(row);
    }

    let mut header = Vec::with_capacity(13);
    header.extend_from_slice(&width.to_be_bytes());
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]); // 8 бит на канал, цвет с прозрачностью

    let mut out = Vec::from(PNG_MAGIC);
    chunk(b"IHDR", &header, &mut out);
    chunk(b"IDAT", &stored_deflate(&raw), &mut out);
    chunk(b"IEND", &[], &mut out);
    out
}

/// Кусок файла PNG: длина, название, данные, проверочная сумма.
fn chunk(kind: &[u8; 4], data: &[u8], out: &mut Vec<u8>) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    out.extend_from_slice(&crc32(&[kind, data]).to_be_bytes());
}

/// Поток сжатия, в котором ничего не сжато: заголовок, дальше «хранимые»
/// блоки по 65535 байт, в конце проверочная сумма исходных данных.
fn stored_deflate(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0x78, 0x01];
    let mut blocks = data.chunks(65_535).peekable();
    if blocks.peek().is_none() {
        out.extend_from_slice(&[1, 0, 0, 0xFF, 0xFF]);
    }
    while let Some(block) = blocks.next() {
        out.push(u8::from(blocks.peek().is_none()));
        out.extend_from_slice(&(block.len() as u16).to_le_bytes());
        out.extend_from_slice(&(!(block.len() as u16)).to_le_bytes());
        out.extend_from_slice(block);
    }
    out.extend_from_slice(&adler32(data).to_be_bytes());
    out
}

/// Проверочная сумма кусков файла PNG. Считается по нескольким отрезкам сразу,
/// чтобы не склеивать ради неё копию данных в четверть мегабайта.
fn crc32(parts: &[&[u8]]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for part in parts {
        for byte in *part {
            crc ^= *byte as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
    }
    !crc
}

/// Проверочная сумма потока сжатия — другая, своя.
fn adler32(data: &[u8]) -> u32 {
    let mut low: u32 = 1;
    let mut high: u32 = 0;
    for byte in data {
        low = (low + *byte as u32) % 65_521;
        high = (high + low) % 65_521;
    }
    (high << 16) | low
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Картинка в старом формате: заголовок в сорок байт и точки снизу вверх.
    fn dib(width: u32, height: u32, bit_count: u16, points: &[[u8; 4]]) -> Vec<u8> {
        let mut b = vec![0u8; 40];
        b[0..4].copy_from_slice(&40u32.to_le_bytes());
        b[4..8].copy_from_slice(&width.to_le_bytes());
        b[8..12].copy_from_slice(&(height * 2).to_le_bytes());
        b[14..16].copy_from_slice(&bit_count.to_le_bytes());
        for point in points {
            b.extend_from_slice(point);
        }
        b
    }

    /// Точки из собранного PNG. Блоки «хранимые», поэтому строки лежат в файле
    /// как есть — и тест видит именно те числа, которые получил разбор.
    fn points_of(png: &[u8], width: usize, height: usize) -> Vec<u8> {
        let start = png
            .windows(4)
            .position(|w| w == b"IDAT")
            .expect("в файле должен быть кусок с точками")
            + 4
            + 2 // заголовок потока сжатия
            + 5; // заголовок хранимого блока
        let mut out = Vec::new();
        for y in 0..height {
            let row = start + y * (width * 4 + 1);
            out.extend_from_slice(&png[row + 1..row + 1 + width * 4]);
        }
        out
    }

    /// PNG без картинки: подпись, кусок IHDR с заданными сторонами, дальше нули
    /// до `len` байт (но не короче самого заголовка).
    fn png_with(width: u32, height: u32, len: usize) -> Vec<u8> {
        let mut png = Vec::from(PNG_MAGIC);
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&width.to_be_bytes());
        png.extend_from_slice(&height.to_be_bytes());
        png.resize(len.max(png.len()), 0);
        png
    }

    fn png_of_len(len: usize) -> Vec<u8> {
        png_with(256, 256, len)
    }

    #[test]
    fn a_png_resource_is_passed_through_untouched() {
        let mut png = png_with(256, 256, 0);
        png.extend_from_slice(b"whatever follows");
        assert_eq!(to_png(&png), Some(png.clone()));
    }

    #[test]
    fn a_png_with_sides_up_to_the_cap_is_passed_through() {
        for (w, h) in [(1, 1), (16, 16), (256, 256), (MAX_SIDE, 1), (1, MAX_SIDE), (MAX_SIDE, MAX_SIDE)] {
            let png = png_with(w, h, 0);
            assert_eq!(to_png(&png), Some(png.clone()), "{w}x{h}");
        }
    }

    #[test]
    fn a_png_with_a_side_over_the_cap_or_zero_is_refused() {
        // Малый файл, но заголовок обещает огромную картинку: окну её отдавать
        // нельзя, разворачиваться она будет уже в нём.
        for (w, h) in [
            (MAX_SIDE + 1, 256),
            (256, MAX_SIDE + 1),
            (MAX_SIDE + 1, MAX_SIDE + 1),
            (u32::MAX, 1),
            (1, u32::MAX),
            (0, 256),
            (256, 0),
        ] {
            assert_eq!(to_png(&png_with(w, h, 0)), None, "{w}x{h}");
        }
    }

    #[test]
    fn a_png_without_a_readable_header_is_refused() {
        // Подпись одна, короче заголовка, и на месте IHDR что-то другое.
        let full = png_with(256, 256, 0);
        assert_eq!(to_png(&PNG_MAGIC), None);
        for cut in [8, 12, 16, 20, 23] {
            assert_eq!(to_png(&full[..cut]), None, "обрезано до {cut} байт");
        }
        let mut other_chunk = full.clone();
        other_chunk[12..16].copy_from_slice(b"IDAT");
        assert_eq!(to_png(&other_chunk), None);
    }

    #[test]
    fn a_png_refused_for_its_sides_hands_the_icon_over_to_the_next_candidate() {
        let next = dib(2, 2, 32, &[[1, 2, 3, 255]; 4]);
        let candidates = [png_with(MAX_SIDE + 1, 256, 0), next.clone()];
        let picked = candidates.iter().find_map(|c| to_png(c)).expect("следующая картинка подошла");
        assert_eq!(picked, to_png(&next).unwrap());
    }

    #[test]
    fn a_png_resource_up_to_the_cap_is_passed_through_and_one_byte_more_is_refused() {
        let at_cap = png_of_len(MAX_PNG_ICON_BYTES);
        // Без assert_eq!: при отказе он напечатал бы мегабайт байтов.
        assert!(to_png(&at_cap).as_deref() == Some(&at_cap[..]), "на пределе — как есть");
        assert!(to_png(&png_of_len(MAX_PNG_ICON_BYTES + 1)).is_none(), "на байт больше — отказ");
    }

    #[test]
    fn a_refused_png_hands_the_icon_over_to_the_next_candidate() {
        // Как в `icons::resolve`: первая картинка, которую удалось привести к
        // PNG, и становится иконкой; слишком большая уступает следующей.
        let next = dib(2, 2, 32, &[[1, 2, 3, 255]; 4]);
        let candidates = [png_of_len(MAX_PNG_ICON_BYTES + 1), next.clone()];
        let picked = candidates.iter().find_map(|c| to_png(c)).expect("следующая картинка подошла");
        assert_eq!(picked, to_png(&next).unwrap());
        assert_eq!(picked.get(16..24), Some(&[0, 0, 0, 2, 0, 0, 0, 2][..]));
    }

    #[test]
    fn the_old_format_turns_into_a_png_with_the_same_size() {
        let b = dib(2, 2, 32, &[[1, 2, 3, 255]; 4]);
        let png = to_png(&b).expect("картинка 32 бита должна разбираться");
        assert_eq!(png.get(..8), Some(&PNG_MAGIC[..]));
        // Ширина и высота в заголовке IHDR, старшим байтом вперёд.
        assert_eq!(png.get(16..24), Some(&[0, 0, 0, 2, 0, 0, 0, 2][..]));
    }

    #[test]
    fn rows_are_flipped_and_colours_reordered() {
        // Снизу вверх: первой записана нижняя строка. Внутри точки порядок
        // «синий, зелёный, красный», на выходе должен стать «красный,
        // зелёный, синий».
        let bottom = [10, 20, 30, 255];
        let top = [40, 50, 60, 255];
        let b = dib(1, 2, 32, &[bottom, top]);
        let png = to_png(&b).expect("картинка должна разбираться");
        assert_eq!(
            points_of(&png, 1, 2),
            vec![60, 50, 40, 255, 30, 20, 10, 255],
            "верхняя строка должна идти первой, а цвета — в обратном порядке"
        );
    }

    #[test]
    fn a_fully_transparent_picture_takes_its_transparency_from_the_mask() {
        // Прозрачность у всех точек нулевая, значит смотреть надо на маску.
        // Маска: одна строка на точку, четыре байта на строку, старший бит —
        // левая точка. Верхняя строка лежит в маске последней.
        let mut b = dib(1, 2, 32, &[[9, 9, 9, 0], [9, 9, 9, 0]]);
        b.extend_from_slice(&[0x80, 0, 0, 0]); // нижняя точка — пусто
        b.extend_from_slice(&[0x00, 0, 0, 0]); // верхняя точка — видно
        let png = to_png(&b).expect("картинка должна разбираться");
        let points = points_of(&png, 1, 2);
        assert_eq!(points[3], 255, "верхняя точка должна остаться видимой");
        assert_eq!(points[7], 0, "нижнюю точку маска объявила пустой");
    }

    #[test]
    fn a_picture_with_real_transparency_keeps_it() {
        // Проверка, что маска не применяется, когда прозрачность настоящая:
        // иначе разбор затирал бы её целиком.
        let b = dib(1, 2, 32, &[[9, 9, 9, 0], [9, 9, 9, 128]]);
        let png = to_png(&b).expect("картинка должна разбираться");
        assert_eq!(points_of(&png, 1, 2), vec![9, 9, 9, 128, 9, 9, 9, 0]);
    }

    #[test]
    fn depths_other_than_thirty_two_are_refused() {
        // Мелкие размеры лесенки бывают с палитрой. Нам нужен самый крупный,
        // он всегда 32-битный, поэтому остальные просто пропускаются.
        assert_eq!(to_png(&dib(2, 2, 8, &[[0, 0, 0, 0]; 4])), None);
        assert_eq!(to_png(&dib(2, 2, 24, &[[0, 0, 0, 0]; 4])), None);
    }

    #[test]
    fn a_truncated_picture_is_refused_without_panicking() {
        let full = dib(4, 4, 32, &[[1, 2, 3, 255]; 16]);
        for cut in [0, 8, 40, 60] {
            assert_eq!(to_png(&full[..cut]), None, "обрезано до {cut} байт");
        }
    }

    #[test]
    fn an_absurd_size_is_refused_before_any_memory_is_asked_for() {
        let mut b = dib(1, 1, 32, &[[0, 0, 0, 0]]);
        b[4..8].copy_from_slice(&100_000u32.to_le_bytes());
        assert_eq!(to_png(&b), None);
    }

    #[test]
    fn checksums_match_the_published_examples() {
        // Обе суммы имеют общеизвестные значения для строки «123456789»:
        // если бы они считались неверно, PNG не открыла бы ни одна программа.
        assert_eq!(crc32(&[b"123456789"]), 0xCBF4_3926);
        assert_eq!(adler32(b"123456789"), 0x091E_01DE);
    }

    #[test]
    fn the_compression_stream_splits_into_blocks_and_marks_only_the_last() {
        let data = vec![7u8; 70_000];
        let stream = stored_deflate(&data);
        assert_eq!(stream[0..2], [0x78, 0x01], "заголовок потока");
        assert_eq!(stream[2], 0, "первый блок не последний");
        assert_eq!(stream[3..5], 65_535u16.to_le_bytes(), "длина первого блока");
        let second = 2 + 5 + 65_535;
        assert_eq!(stream[second], 1, "второй блок последний");
        assert_eq!(stream[second + 1..second + 3], 4_465u16.to_le_bytes());
    }
}
