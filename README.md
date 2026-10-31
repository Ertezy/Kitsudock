# Kitsudock

**English** · [Русский](README.ru.md)

A free desktop launcher for gacha games on Windows: Genshin Impact, Honkai: Star Rail,
Zenless Zone Zero, Wuthering Waves and Arknights: Endfield — one window instead of
several launchers.

Not affiliated with the games' developers. Game names and artwork belong to their owners.
Genshin Impact, Honkai: Star Rail and Zenless Zone Zero: © All rights reserved by HoYoverse.

## Download

### [Download Kitsudock for Windows](https://github.com/Ertezy/Kitsudock/releases/latest/download/Kitsudock-setup.exe)

The latest version, `Kitsudock-setup.exe`. Windows 10 or 11, 64-bit. Every version with its
notes is on the [Releases](https://github.com/Ertezy/Kitsudock/releases) page.

## Install

1. Run `Kitsudock-setup.exe`. It installs for your user only, no administrator rights
   needed, and downloads Microsoft WebView2 if the system doesn't have it yet.
2. The installer isn't code-signed yet, so Windows SmartScreen may show "Windows protected
   your PC". Click **More info → Run anyway**.
3. On the first start Kitsudock shows the games it found on this computer. Tick the ones you
   want and click **Add checked**. A game it missed can be added later in Settings → Games →
   **+ Add a game manually**, by pointing at the game's `.exe`.

## Update

When a new version is out, a line at the bottom of the side panel says so. Click **Update**
in it: Kitsudock downloads the new installer, installs it and starts again. Games, order and
settings are kept. Versions before the button show a **Download** link there instead; if the
update fails, the line says so and offers **Download** too.

Updating by hand still works: download the installer again from the same link and run it
over the old version.

Coming from Gacha Hub (the project's old name)? Install Kitsudock first — your games and
settings are carried over on its first start — then uninstall Gacha Hub — after Kitsudock's
first start, ticking "Delete the application data" is safe and frees the old caches.

## Uninstall

Windows Settings → Apps → Installed apps → Kitsudock → Uninstall. To remove your settings
and cached pictures too, tick "Delete the application data" in the uninstaller, or delete
`%APPDATA%\io.github.ertezy.kitsudock` and `%LOCALAPPDATA%\io.github.ertezy.kitsudock` yourself.

## Privacy

No account or telemetry. Settings, cached files and logs stay on your computer;
logs are not sent automatically. Download servers can see your IP address, just
like any website.

Data comes from GitHub Pages or your chosen address. Pictures and videos come from
game wikis, YouTube, HoYoPlay, Steam and Epic servers; store artwork may also come
from local caches. Media sources depend on the data file and installed launchers.
Video and code redemption links open in your browser. When you click **Update**, the app
requests `latest.json` and the installer from this repository's GitHub releases.

## Is it safe?

- **Game launching:** Kitsudock does not sign in to game accounts, ask for their
  passwords, modify game files or inject code into game processes. It reads local installation
  information and can read a game's executable to extract its icon. Steam and Epic
  games launch through their launch links; other games launch by running their
  `.exe`. Games requiring administrator rights use the standard Windows elevation
  prompt. The game or store launcher may ask you to sign in.
- **Network access:** the downloads and external links are described in
  [Privacy](#privacy); logs are not sent automatically.
- **Updates:** only when you click **Update**. The update is installed only if its
  signature matches the key built into the app; otherwise nothing is installed.
- **Source and builds:** the source is available under the [MIT license](LICENSE).
  Installers are built by the [release workflow](.github/workflows/release.yml) in
  GitHub Actions from this repository.
- **Windows warnings and downloads:** installers are currently unsigned, so
  SmartScreen may warn about an unrecognized app. Download only from this
  repository's [Releases page](https://github.com/Ertezy/Kitsudock/releases), and
  check that the address belongs to `github.com/Ertezy/Kitsudock` before downloading.
  The warning alone is not a verdict on safety. See the
  [code signing policy](#code-signing-policy).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org). *Not set up yet — until it is, installers are
unsigned (see [Install](#install)).*

- Only installers built by GitHub Actions from a tagged commit of this repository are
  signed, and every release is approved by hand before signing.
- Committers and reviewers: [Ertezy](https://github.com/Ertezy)
- Approvers: [Ertezy](https://github.com/Ertezy)
- Privacy policy: see [Privacy](#privacy). No telemetry or automatic log uploads;
  download servers can see your IP address, just like any website.

## Features

- **Your games in one dock.** Games are found through Steam, the Epic Games Launcher, HoYoPlay,
  the Kuro launcher and GRYPHLINK, or added by pointing at the game's `.exe`.
  Reorder them by drag in Settings → Games.
- **Play** launches through the store the game was installed from, or directly — like
  double-clicking the game's `.exe`. Kitsudock does not modify game files or
  interact with a running game.
- **Side panel** for the selected game: promo codes with expiry, current and upcoming
  banners (the carousel slides on its own), and the latest official videos.
- **Languages:** interface in English or Russian; videos in English or Japanese.
- **Backgrounds:** the official HoYoPlay background for Genshin Impact, Honkai: Star
  Rail and Zenless Zone Zero (a video when animation is on), store artwork, your own
  image or your own video.
- **Tray:** closing the window can hide it to the tray; games can be launched from the
  tray menu.
- **Launch with Windows:** starts hidden in the tray and keeps the panel's data fresh.

## How it works

```text
React + TypeScript window
          | Tauri commands
          v
Rust / Tauri 2
  game discovery and launch, settings, image cache, tray
          ^
          | hub.json
GitHub Pages <--- Kitsudock-data (GitHub Actions)
```

The [data collector](https://github.com/Ertezy/Kitsudock-data) runs hourly in GitHub
Actions. It gathers codes, banners, videos and links to official HoYoPlay
backgrounds, then publishes the result as `hub.json` on GitHub Pages. Sources have
their own refresh intervals. The app checks for fresh data on startup and every
three hours while running, including in the tray. It also checks when the window
returns after at least an hour since the last check, and when the connection
comes back.

- Games launch through Steam or Epic, or by running their `.exe`. Games that need
  administrator rights use the standard Windows elevation prompt.
- The collector parses game websites. The app reads the prepared data file and
  downloads the pictures and videos it references.
- Settings → Appearance → Animation turns off interface movement, background video
  and automatic banner scrolling through one shared setting.
- English and Russian interface text lives in separate dictionaries:
  [src/i18n/en.ts](src/i18n/en.ts) and [src/i18n/ru.ts](src/i18n/ru.ts).

## Where the data comes from

The panel's codes, banners and videos come from a separate collector that runs on
GitHub Actions and publishes one file:

- repository: https://github.com/Ertezy/Kitsudock-data
- file: https://ertezy.github.io/Kitsudock-data/hub.json

The collector reads community wikis (Fandom, wiki.gg — CC BY-SA), official Wuthering
Waves announcements (facts only: title, character, dates), the official HoYoPlay
launcher (links to the current backgrounds of Genshin Impact, Honkai: Star Rail and
Zenless Zone Zero), an open API mirror and the games' official YouTube channels. Every
code and banner links back to its source. A different address can be set in
Settings → Data → Data source URL.

## Building from source

Requirements: Node.js 20 or newer, Rust (stable, MSVC toolchain) and the Tauri 2 prerequisites
for Windows (https://tauri.app/start/prerequisites/). On a clean machine:

    winget install Rustlang.Rustup
    winget install Microsoft.VisualStudio.2022.BuildTools --override "add --wait --passive --modify Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Then:

    npm install
    npm run tauri dev      # run with hot reload
    npm run tauri build    # installer in src-tauri/target/release/bundle/nsis

Tests:

    npm test
    cd src-tauri && cargo test --lib

## Release: fresh data in the bundle

The installer carries a copy of the data file for the very first launch without internet.
Before building a release, refresh it and commit it with the release:

    npm run update-hub

## Where settings live

`%APPDATA%\io.github.ertezy.kitsudock\`:

- `config.json` — games, order and settings;
- `hub_cache.json`, `hub_cache.meta.json` — the last downloaded data file and its version tag;
- `hub.json` — optional manual override, used only when the collector cannot be reached.

Logs are kept separately, under `%LOCALAPPDATA%\io.github.ertezy.kitsudock\logs\`; open the
folder from Settings → About → Log → Show log.

## Icons

`src-tauri/icons/` holds the app icon, drawn from one kitsune artwork:

- `icon.ico` — 16–48 px show a close-up of the face, 64–256 px the whole badge; Windows
  picks the size for the taskbar and Explorer by display scaling;
- `icon.png` — the whole badge, 512 px;
- `tray-32.rgba` — the tray icon: the same close-up as raw 32×32 RGBA pixels, embedded by
  `src-tauri/src/tray.rs`.

Replace all three together when the artwork changes.

## License

MIT — see [LICENSE](LICENSE). Game names, art and trademarks belong to their owners;
Genshin Impact, Honkai: Star Rail and Zenless Zone Zero: © All rights reserved by HoYoverse.
