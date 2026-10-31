// Русский словарь. Форма — ровно как у английского (тип Dictionary);
// формулировки — те, что были в коде до перевода, кроме ошибок и пустых мест:
// их позже переписали прямым текстом — что случилось и что сделать.

import type { Dictionary } from "./en";
import { plural } from "./format";

export const ru: Dictionary = {
  language: {
    interface: "Язык интерфейса",
    video: "Язык видео",
  },
  time: {
    expired: "истёк",
    minutes: (m: number) => `${m} мин`,
    hoursMinutes: (h: number, m: number) => `${h} ч ${m} мин`,
    days: (n: number) => `${n} ${plural("ru", n, { one: "день", few: "дня", many: "дней", other: "дня" })}`,
    fresh: "данные свежие",
    dataFrom: (date: string) => `данные от ${date}`,
  },
  // Строки прежней панели (было в src/lib/panel.ts и компонентах
  // src/components/panel/*, src/components/SidePanel.tsx). Пустая панель
  // (`EmptyState`): заголовок — что случилось, подсказка — что делать;
  // причины — `lib/panel.ts`, `emptyReason`.
  panel: {
    noDataYet: "Свежих данных пока нет. Обновите, чтобы проверить снова.",
    panelEmpty: "Пока нет кодов, баннеров и видео",
    emptyQuietHint: "Новые появятся здесь сами, когда выйдут.",
    emptyStaleHint: "Данные старше недели, поэтому коды и баннеры скрыты. Они вернутся после обновления.",
    unlinkedTitle: "Для этой игры нет данных",
    unlinkedHint: "Привязать игру к данным можно в её настройках: «Коды, баннеры и видео игры».",
    // Несвязанная игра без совпадения по названию: данных для неё может не быть
    // вовсе, а может быть — у добавленной вручную или переименованной. Текст
    // верен в обоих случаях и говорит, что сделать.
    uncollectedHint: "Игра не связана с данными. Если данные для неё собираются, свяжите её в настройках игры.",
    // Список игр не загрузился (баннер ошибки над артом): игры есть, их не прочитали.
    // Крестик по умолчанию прячет окно в трей и список не перечитывает, а
    // возврат из настроек перечитывает (`closeSettings` → `load` в App.tsx).
    listFailedTitle: "Список игр не загрузился",
    listFailedHint: "Откройте настройки и вернитесь назад, чтобы загрузить список снова.",
    noGamesTitle: "Игр пока нет",
    noGamesHint: "Добавьте их в настройках: шестерёнка внизу панели.",
    sources: { remote: "из сети", override: "из локальной подмены", cache: "из кеша", bundled: "из комплекта" },
    unknownSource: "неизвестно",
    dataStatus: (source: string, freshness: string) => `Источник — ${source}, ${freshness}.`,
    settingsAndGames: "Настройки и игры",
    disclaimer: "Не связано с разработчиками игр. Материалы принадлежат правообладателям.",
    updateAvailable: (v: string) => `Вышла версия ${v}`,
    update: "Обновить",
    updating: "Скачиваю обновление…",
    updateFailed: "Не удалось обновить",
    download: "Скачать",
    codes: "Промокоды",
    noExpiry: "бессрочный",
    expiresIn: (t: string) => `сгорит через ${t}`,
    timeRemaining: (t: string) => `осталось ${t}`,
    regionOnly: (region: string) => `только ${region}`,
    copyCode: "Копировать код",
    codeCopied: (code: string) => `Код ${code} скопирован`,
    copyFailed: "Не удалось скопировать",
    codeCopyFailed: (code: string) => `Не удалось скопировать код ${code}. Попробуйте ещё раз.`,
    redeem: "Забрать на сайте",
    banners: "Баннеры",
    previousBanner: "Предыдущий баннер",
    nextBanner: "Следующий баннер",
    bannerDot: (i: number, n: number) => `Баннер ${i} из ${n}`,
    soonIn: (time: string) => `Скоро · через ${time}`,
    videos: "Видео",
    premiere: "премьера",
  },
  // Строки главного экрана, дока игр и общих обёрток (было в App.tsx,
  // PlayButton.tsx, GameDock.tsx, lib/launch.ts, lib/background.ts, lib/api.ts).
  main: {
    launch: {
      note: { steam: "Запустится через Steam", epic: "Запустится через Epic Games", exe: "Запустится напрямую" },
      viaLauncher: {
        hoyoplay: "Запустится через HoYoPlay",
        kuro: "Запустится через лаунчер Kuro",
        gryphlink: "Запустится через GRYPHLINK",
      },
      fileMissing: "файл не найден",
      // Переключатель способа под кнопкой «Играть».
      way: {
        direct: "Напрямую",
        store: { steam: "Через Steam", epic: "Через Epic Games" },
        launcher: { hoyoplay: "Через HoYoPlay", kuro: "Через лаунчер Kuro", gryphlink: "Через GRYPHLINK" },
        // Магазин не всегда пускает игру мимо себя — обещать запуск нельзя.
        directHint: (store: string) => `Может не запуститься: игре бывает нужен запуск через ${store}`,
        list: "Способ запуска",
        tab: (way: string) => `Способ запуска: ${way}`,
        saveFailed: (reason: string) => `Не удалось сохранить способ запуска. ${reason}`,
      },
      from: {
        steam: "из Steam",
        epic: "из Epic Games",
        exe: "из папки",
        hoyoplay: "из HoYoPlay",
        kuro: "из лаунчера Kuro",
        gryphlink: "из GRYPHLINK",
      },
    },
    play: "▶ Играть",
    launching: "Запускаю…",
    gameFileMissing: "Файл игры не найден",
    dockFileMissing: (title: string) => `${title} — файл игры не найден`,
    noGameSelected: "Игра не выбрана — добавьте игру в настройках.",
    // Подробность — сама фраза ошибки, с заглавной буквы: отдельным предложением.
    loadFailed: (detail: string) => `Список игр не загрузился. ${detail}`,
    relocate: "Найти заново",
    pickManually: "Указать вручную",
    background: {
      source: { video: "своё видео", picture: "своя картинка", fill: "заливка" },
      videoMissing: (source: string) => `${source}, файл видео не найден`,
      videoUnreadable: "Не удалось прочитать видео — выберите mp4 (H.264) или webm.",
      videoTooBig: "Видео больше 2560×1440 — выберите ролик поменьше.",
    },
    filters: {
      program: "Программа",
      image: "Картинка",
      video: "Видео",
    },
    refuseNonHttps: (url: string) => `Ссылка не https, поэтому не откроется: ${url}`,
    socials: {
      group: "Официальные соцсети игры",
      names: {
        hoyolab: "HoYoLAB",
        site: "Сайт игры",
        youtube: "YouTube",
        x: "X",
        discord: "Discord",
        reddit: "Reddit",
        facebook: "Facebook",
        instagram: "Instagram",
        tiktok: "TikTok",
        telegram: "Telegram",
        vk: "VK",
      },
    },
  },
  // Тексты ошибок Rust: что случилось и, где можно, что сделать; переменная
  // часть — подробность. Каждая фраза — отдельное предложение с заглавной буквы:
  // она стоит одна в плашке ошибки.
  errors: {
    unknown: "Неизвестная ошибка",
    internal: (d?: string) => (d ? `Внутренняя ошибка: ${d}` : "Внутренняя ошибка"),
    // Без подробности — отказ `with_config`: «Найти заново» не нашла игру среди
    // установленных или правку, порядок, удаление не к чему применить. Игра при
    // этом может стоять в доке, поэтому текст нейтральный. С подробностью — игры
    // нет среди найденных или в списке.
    gameNotFound: (d?: string) => (d ? `Игра не найдена: ${d}` : "Игра не найдена"),
    fileMissing: (d?: string) => (d ? `Файл не найден: ${d}` : "Файл не найден"),
    exePathMissing: (_d?: string) => "Путь к игре не указан. Укажите файл игры вручную.",
    argsUnclosedQuote: (d?: string) => `Не удалось разобрать аргументы запуска${d ? ` «${d}»` : ""}: закройте кавычку.`,
    exeStartFailed: (d?: string) => (d ? `Не удалось запустить ${d}` : "Не удалось запустить игру"),
    steamOpenFailed: (d?: string) =>
      `Не удалось открыть ${d ?? "Steam"}. Проверьте, что Steam установлен и хотя бы раз запускался.`,
    epicOpenFailed: (d?: string) => `Не удалось открыть Epic Games Launcher${d ? `: ${d}` : ""}. Проверьте, что он установлен.`,
    emptyTitle: (_d?: string) => "Название не может быть пустым",
    hubUrlNotHttps: (_d?: string) => "Адрес должен начинаться с https://",
    videoPickFailed: (d?: string) => (d ? `Не удалось открыть видео: ${d}` : "Не удалось открыть видео"),
    videoWrongFormat: (_d?: string) => "Видео должно быть в формате mp4 или webm.",
    videoFileMissing: (_d?: string) => "Файл видео не найден.",
    videoTooLarge: (d?: string) =>
      d ? `Видео тяжелее ${d} МБ — выберите файл поменьше.` : "Видео слишком тяжёлое — выберите файл поменьше.",
    cacheReadFailed: (d?: string) => (d ? `Не удалось прочитать кеш: ${d}` : "Не удалось прочитать кеш"),
    logFolderMissing: (d?: string) => (d ? `Папка журнала не найдена: ${d}` : "Папка журнала не найдена"),
    openFolderFailed: (d?: string) => (d ? `Не удалось открыть папку: ${d}` : "Не удалось открыть папку"),
    // Раньше человек видел один голый текст ошибки сохранения, без слов о том,
    // что именно не сохранилось. Теперь — как в английском: что случилось, затем
    // подробность.
    configSaveFailed: (d?: string) => (d ? `Не удалось сохранить настройки: ${d}` : "Не удалось сохранить настройки"),
    autostartFailed: (d?: string) => (d ? `Не удалось изменить автозапуск: ${d}` : "Не удалось изменить автозапуск"),
    updateNotFound: (_d?: string) => "На GitHub пока нет новой версии для установки.",
    updateFailed: (d?: string) => (d ? `Не удалось обновить: ${d}` : "Не удалось обновить"),
  },
  // Экран на месте окна, если отрисовка упала (src/components/ErrorBoundary.tsx).
  crash: {
    title: "Не удалось показать окно",
    hint: "Перезагрузите его — обычно это помогает. Игры и настройки в порядке, подробности — в журнале.",
    reload: "Перезагрузить",
  },
  // Экран настроек и первый запуск (было в Settings.tsx и
  // src/screens/settings/*).
  settings: {
    tabs: { games: "Игры", look: "Вид", behaviour: "Поведение", data: "Данные", about: "О программе" },
    back: "← Назад",
    advanced: "Дополнительно",
    save: "Сохранить",
    choose: "Выбрать…",
    launchKind: { steam: "Steam", epic: "Epic Games", exe: "напрямую" },
    firstRun: {
      title: "Что нашлось на компьютере",
      knownHint: "По этим играм есть коды, баннеры и видео.",
      restHint: "Остальное установленное. Эти игры запустятся, но кодов, баннеров и видео по ним не будет.",
      alreadyAdded: "уже добавлена",
      addChecked: "Добавить отмеченные",
      skip: "Пропустить",
      scanning: "Ищу установленные игры…",
      nothingTitle: "Установленных игр не нашлось",
      nothingHint: "Игру можно добавить вручную в настройках, на вкладке «Игры».",
      continue: "Продолжить",
      scanFailedTitle: "Не удалось проверить установленные игры",
    },
    games: {
      hint: "Порядок в списке — это порядок в доке внизу главного экрана. Перетащите строку, чтобы поменять.",
      addManually: "+ Добавить игру вручную",
      scanInstalled: "Найти установленные игры",
      defaultTitle: "Игра",
      fileMissing: "файл пропал",
      emptyTitle: "Игр пока нет",
      emptyHint: "Добавьте игру вручную или найдите установленные — кнопки ниже.",
    },
    editor: {
      name: "Название",
      gameFile: "Файл игры",
      gameFileHint: "Указанный вручную файл запускается напрямую, а не через магазин.",
      icon: "Иконка",
      iconHint: "Пусто — иконка берётся из файла игры.",
      reset: "Сбросить",
      showContentAs: "Коды, баннеры и видео игры",
      showContentAsHint: "Коды, баннеры и видео на панели слева берутся для этой игры.",
      noContent: "нет — коды, баннеры и видео не показывать",
      remove: "Удалить игру",
      removeConfirmTitle: "Удаление игры",
      removeConfirm: (title: string) => `Удалить «${title}» из списка?`,
      removeOk: "Удалить",
      removeCancel: "Отмена",
      args: "Аргументы запуска",
      argsHint: "Передаются игре как есть. Неверное значение может помешать ей запуститься.",
      argsDirectOnly: "Передаются игре только при запуске напрямую, а сейчас выбран другой способ.",
      argsPlaceholder: "например, -window",
      argsUnavailable: (source: string) => `Аргументы запуска здесь недоступны: игру открывает ${source} по собственной ссылке, и передать ей что-то дополнительное нельзя.`,
    },
    look: {
      storeArt: "Брать фоны из магазинов и лаунчеров",
      storeArtHint: "Для Genshin Impact, Honkai: Star Rail и Zenless Zone Zero берётся текущий фон официального лаунчера HoYoPlay (видео, если включена анимация), для остальных игр из Steam и Epic Games — картинка из магазина. Своя картинка или видео всегда важнее.",
      animation: "Анимация",
      // Неразрывный пробел после «Настройка»: первое слово фразы не остаётся
      // одно в конце строки, оторванным от неё.
      animationHint: "Видео фона, медленное движение картинки, увеличение иконок в доке и поворот шестерёнки. Настройка\u00a0Windows на приложение не влияет.",
      noGames: "Игр пока нет",
      noGamesHint: "Добавьте их на вкладке «Игры», и здесь появятся их фоны.",
      pickImage: "Картинка…",
      pickVideo: "Видео…",
      removeBackground: "Убрать",
    },
    behaviour: {
      closeToTray: "Крестик прячет окно в трей",
      closeToTrayHint: "Приложение продолжает работать, вернуть окно можно из значка в трее.",
      trayOnLaunch: "Уходить в трей после запуска игры",
      trayOnLaunchHint: "Окно не мешает игре.",
      autostart: "Запускать вместе с Windows",
      autostartHint: "Запускается спрятанным в трей и держит коды и баннеры свежими.",
    },
    data: {
      refreshNow: "Обновить сейчас",
      imageCache: "Кеш картинок",
      imageCacheHint: (size: string) => `Занимает ${size} МБ: иконки, фоны и картинки панели.`,
      clearCache: "Очистить кеш картинок",
      hubUrl: "Адрес источника данных",
      hubUrlHint: "Нужен только для своего источника. Обычно поле пустое.",
      hubUrlPlaceholder: "https://…",
    },
    about: {
      version: (v: string) => `Версия ${v}`,
      updateAvailable: (v: string) => `доступна ${v}`,
      download: "скачать",
      repository: "Репозиторий",
      log: "Журнал",
      logHint: (path: string) => `Лежит в ${path}. Если что-то не работает, приложите его к сообщению о проблеме.`,
      showLog: "Показать журнал",
      reportProblem: "Сообщить о проблеме",
      disclaimer: "Приложение не связано с разработчиками игр. Названия, изображения и другие материалы принадлежат правообладателям. Genshin Impact, Honkai: Star Rail и Zenless Zone Zero: © All rights reserved by HoYoverse.",
    },
  },
};
