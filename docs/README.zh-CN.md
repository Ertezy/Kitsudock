# Kitsudock

[English](../README.md) · [Русский](README.ru.md) · **简体中文** · [日本語](README.ja.md) · [한국어](README.ko.md)

<img width="800" alt="Kitsudock demo" src="https://github.com/user-attachments/assets/a4309a5a-8c96-40aa-a709-6fa5117bfcb4" />

一款免费的 Windows 抽卡游戏启动器：支持原神、崩坏：星穹铁道、绝区零、鸣潮和明日方舟：终末地——
用一个窗口代替好几个启动器。

与游戏开发商无关。游戏名称和美术素材归其权利人所有。
Genshin Impact, Honkai: Star Rail and Zenless Zone Zero: © All rights reserved by HoYoverse.

## 下载

### [下载 Windows 版 Kitsudock](https://github.com/Ertezy/Kitsudock/releases/latest/download/Kitsudock-setup.exe)

最新版本 `Kitsudock-setup.exe`。需要 64 位 Windows 10 或 11。所有版本及更新说明见
[Releases](https://github.com/Ertezy/Kitsudock/releases) 页面。

## 安装

1. 运行 `Kitsudock-setup.exe`。只为当前用户安装，不需要管理员权限；如果系统里还没有
   Microsoft WebView2，安装程序会自动下载。
2. 安装程序暂时还没有代码签名，所以 Windows SmartScreen 可能会显示“Windows 已保护你的电脑”。
   点击 **更多信息 → 仍要运行** 即可。
3. 首次启动时，Kitsudock 会列出在这台电脑上找到的游戏。勾选需要的游戏，然后点击
   **添加所选**。没找到的游戏可以之后在 设置 → 游戏 → **+ 手动添加游戏** 中添加，
   只需指定游戏的 `.exe` 文件。

## 更新

有新版本时，侧边栏底部会显示提示。点击其中的 **更新**：Kitsudock 会下载新的安装程序、
完成安装并重新启动。游戏、顺序和设置都会保留。如果更新失败，提示中会说明原因，并提供
**下载** 链接。

也可以手动更新：用同一个链接重新下载安装程序，直接覆盖旧版本安装。

## 卸载

Windows 设置 → 应用 → 已安装的应用 → Kitsudock → 卸载。如果还想删除设置和缓存的图片，
请在卸载程序中勾选 “Delete the application data”，或者自己删除
`%APPDATA%\io.github.ertezy.kitsudock` 和 `%LOCALAPPDATA%\io.github.ertezy.kitsudock`。

## 隐私

没有账号，也没有遥测。设置、缓存文件和日志都保存在你的电脑上，日志不会被自动发送。
和访问任何网站一样，下载服务器能看到你的 IP 地址。

数据来自 GitHub Pages 或你自己设置的地址。图片和视频来自游戏 Wiki、YouTube、HoYoPlay、
Steam 和 Epic 的服务器；商店宣传图也可能来自本地缓存。视频和兑换码链接会在浏览器中打开。
点击 **更新** 时，应用会从本仓库的 GitHub Releases 获取 `latest.json` 和安装程序。

## 安全吗？

- **启动游戏：** Kitsudock 不会登录游戏账号，不会索要密码，不会修改游戏文件，也不会向游戏
  进程注入代码。它读取本地的安装信息，并可能读取游戏的 `.exe` 来提取图标。Steam 和 Epic
  的游戏通过它们的启动链接启动；其他游戏直接运行 `.exe` 启动，选择用游戏自己的启动器时，
  也是同样的方式。需要管理员权限的游戏会弹出 Windows 的标准确认窗口。游戏或商店的启动器
  可能会要求你登录。
- **网络访问：** 所有下载和外部链接见 [隐私](#隐私)；日志不会被自动发送。
- **更新：** 只在你点击 **更新** 时进行。只有签名与应用内置的密钥一致时才会安装，否则什么都
  不会安装。
- **源代码和构建：** 源代码以 [MIT 许可证](../LICENSE) 公开。安装程序由本仓库的
  [发布工作流](../.github/workflows/release.yml) 在 GitHub Actions 中构建。
- **Windows 警告与下载：** 安装程序目前没有签名，SmartScreen 可能会提示这是无法识别的应用。
  请只从本仓库的 [Releases 页面](https://github.com/Ertezy/Kitsudock/releases) 下载，并在
  下载前确认地址属于 `github.com/Ertezy/Kitsudock`。这个警告本身并不代表软件不安全。
  详见 [Code signing policy](../README.md#code-signing-policy)。

## 功能

- **所有游戏都在一个游戏栏里。** 可以通过 Steam、Epic Games Launcher、HoYoPlay、库洛启动器
  和 GRYPHLINK 自动找到游戏，也可以指定游戏的 `.exe` 手动添加。在 设置 → 游戏 中拖动即可调整顺序。
- **开始游戏** 会通过安装游戏的商店启动，或者直接启动——就像双击游戏的 `.exe`。Kitsudock 不会
  修改游戏文件，也不会与运行中的游戏交互。如果游戏有多种启动方式，可以用 **开始游戏** 上方的
  那一行（“直接启动 ▴”）切换：直接启动、通过游戏自己的启动器（HoYoPlay、库洛启动器、
  GRYPHLINK——如果游戏是通过它安装的），或者通过商店；每款游戏会分别记住你的选择。
- **侧边栏** 显示所选游戏的内容：带有效期的兑换码、当前和即将开启的卡池（轮播会自动切换），
  以及最新的官方视频。每个分区都可以点击标题收起，官方社交媒体栏可以收到边缘的小标签后面；
  收起的状态对所有游戏生效，重启后也会保留。
- **语言：** 界面支持简体中文、English、Русский、日本語 和 한국어；视频支持英语或日语。
  兑换码奖励、卡池名称等数据来自英文 Wiki，保持英文。
- **主题与颜色：** 深色、浅色或跟随 Windows。背景、面板、文字、“开始游戏”按钮、标签、图标和边框
  这七种主要颜色都可以在 设置 → 外观 中修改，一个按钮即可恢复主题自带的颜色。
- **背景：** 原神、崩坏：星穹铁道和绝区零使用官方 HoYoPlay 的背景（开启动画时为视频），
  也可以使用商店宣传图、自己的图片或视频。
- **托盘：** 关闭窗口时可以隐藏到托盘，也可以从托盘菜单启动游戏。
- **开机启动：** 启动后隐藏在托盘中，让兑换码和卡池保持最新。

## 数据从哪里来

侧边栏中的兑换码、卡池和视频由一个独立的收集程序整理。它运行在 GitHub Actions 上，
并发布为一个文件：

- 仓库：https://github.com/Ertezy/Kitsudock-data
- 文件：https://ertezy.github.io/Kitsudock-data/hub.json

收集程序读取社区 Wiki（Fandom、wiki.gg——CC BY-SA）、鸣潮的官方公告（仅事实：标题、角色、
时间）、官方 HoYoPlay 启动器（原神、崩坏：星穹铁道和绝区零当前背景的链接）、一个公开的
API 镜像，以及各游戏的官方 YouTube 频道。每个兑换码和卡池都附有来源链接。可以在
设置 → 数据 → 数据源地址 中改用其他地址。

## 开发者

架构说明、从源代码构建和测试，请参阅 [英文 README](../README.md#how-it-works)。

## 许可证

MIT——见 [LICENSE](../LICENSE)。游戏名称、美术素材和商标归其权利人所有；
Genshin Impact, Honkai: Star Rail and Zenless Zone Zero: © All rights reserved by HoYoverse.
