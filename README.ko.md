# Kitsudock

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어**

<img width="800" alt="Kitsudock demo" src="https://github.com/user-attachments/assets/a4309a5a-8c96-40aa-a709-6fa5117bfcb4" />

Windows용 무료 가챠 게임 런처입니다. 원신, 붕괴: 스타레일, 젠레스 존 제로, 명조: 워더링 웨이브,
명일방주: 엔드필드를 지원하며, 여러 런처 대신 창 하나로 끝납니다.

게임 개발사와 관련이 없습니다. 게임 이름과 아트워크의 권리는 각 권리자에게 있습니다.
Genshin Impact, Honkai: Star Rail and Zenless Zone Zero: © All rights reserved by HoYoverse.

## 다운로드

### [Windows용 Kitsudock 다운로드](https://github.com/Ertezy/Kitsudock/releases/latest/download/Kitsudock-setup.exe)

최신 버전 `Kitsudock-setup.exe`입니다. 64비트 Windows 10 또는 11이 필요합니다. 모든 버전과 변경
사항은 [Releases](https://github.com/Ertezy/Kitsudock/releases) 페이지에서 볼 수 있습니다.

## 설치

1. `Kitsudock-setup.exe`를 실행합니다. 현재 사용자에게만 설치되며 관리자 권한이 필요 없습니다.
   Microsoft WebView2가 없으면 설치 프로그램이 자동으로 내려받습니다.
2. 설치 프로그램에 아직 코드 서명이 없어서 Windows SmartScreen이 "Windows의 PC 보호" 창을 띄울 수
   있습니다. **추가 정보 → 실행**을 누르세요.
3. 처음 실행하면 Kitsudock이 이 컴퓨터에서 찾은 게임을 보여 줍니다. 원하는 게임에 체크하고
   **선택한 항목 추가**를 누르세요. 찾지 못한 게임은 나중에 설정 → 게임 → **+ 게임 직접 추가**에서
   게임의 `.exe`를 지정해 추가할 수 있습니다.

## 업데이트

새 버전이 나오면 사이드 패널 아래쪽에 알림이 표시됩니다. 거기서 **업데이트**를 누르면 Kitsudock이
새 설치 프로그램을 내려받아 설치하고 다시 시작합니다. 게임, 순서, 설정은 그대로 유지됩니다.
업데이트에 실패하면 알림에 그 사실이 표시되고 **다운로드** 링크가 함께 나타납니다.

직접 업데이트할 수도 있습니다. 같은 링크에서 설치 프로그램을 다시 내려받아 이전 버전 위에 실행하세요.

## 제거

Windows 설정 → 앱 → 설치된 앱 → Kitsudock → 제거. 설정과 캐시된 이미지까지 지우려면 제거 프로그램에서
"Delete the application data"에 체크하거나, `%APPDATA%\io.github.ertezy.kitsudock`과
`%LOCALAPPDATA%\io.github.ertezy.kitsudock`을 직접 삭제하세요.

## 개인정보

계정도, 원격 측정도 없습니다. 설정, 캐시 파일, 로그는 모두 사용자의 컴퓨터에 저장되며 로그가 자동으로
전송되지 않습니다. 다른 웹사이트와 마찬가지로 다운로드 서버는 IP 주소를 볼 수 있습니다.

데이터는 GitHub Pages나 직접 지정한 주소에서 가져옵니다. 이미지와 영상은 게임 위키, YouTube, HoYoPlay,
Steam, Epic 서버에서 가져오며, 스토어 아트워크는 로컬 캐시에서 읽기도 합니다. 영상과 코드 교환 링크는
브라우저에서 열립니다. **업데이트**를 누르면 이 저장소의 GitHub Releases에서 `latest.json`과 설치
프로그램을 가져옵니다.

## 안전한가요?

- **게임 실행:** Kitsudock은 게임 계정에 로그인하지 않고, 비밀번호를 묻지 않으며, 게임 파일을 수정하거나
  게임 프로세스에 코드를 주입하지 않습니다. 로컬 설치 정보를 읽고, 아이콘을 가져오기 위해 게임의
  `.exe`를 읽을 수 있습니다. Steam과 Epic 게임은 각자의 실행 링크로, 그 밖의 게임은 `.exe`를 실행해서
  시작합니다. 게임 전용 런처를 선택한 경우에도 같은 방식입니다. 관리자 권한이 필요한 게임은 Windows
  기본 확인 창을 띄웁니다. 게임이나 스토어 런처가 로그인을 요청할 수는 있습니다.
- **네트워크:** 다운로드와 외부 링크는 [개인정보](#개인정보)를 참고하세요. 로그는 자동으로 전송되지 않습니다.
- **업데이트:** **업데이트**를 누를 때만 진행됩니다. 서명이 앱에 내장된 키와 일치할 때만 설치되며,
  일치하지 않으면 아무것도 설치되지 않습니다.
- **소스와 빌드:** 소스 코드는 [MIT 라이선스](LICENSE)로 공개되어 있습니다. 설치 프로그램은 이 저장소의
  [릴리스 워크플로](.github/workflows/release.yml)로 GitHub Actions에서 빌드됩니다.
- **Windows 경고와 다운로드:** 현재 설치 프로그램에 서명이 없어서 SmartScreen이 "인식할 수 없는 앱"이라고
  경고할 수 있습니다. 이 저장소의 [Releases 페이지](https://github.com/Ertezy/Kitsudock/releases)에서만
  내려받고, 주소가 `github.com/Ertezy/Kitsudock`인지 확인하세요. 경고 자체가 안전성에 대한 판정은
  아닙니다. 자세한 내용은 [Code signing policy](README.md#code-signing-policy)를 참고하세요.

## 기능

- **모든 게임을 독 하나에.** Steam, Epic Games Launcher, HoYoPlay, 쿠로 런처, GRYPHLINK에서 게임을
  찾거나, 게임의 `.exe`를 지정해 추가할 수 있습니다. 순서는 설정 → 게임에서 끌어서 바꿉니다.
- **플레이**는 게임을 설치한 스토어를 통해, 또는 직접 실행합니다(게임의 `.exe`를 더블클릭하는 것과
  같습니다). Kitsudock은 게임 파일을 수정하지 않고, 실행 중인 게임과도 상호 작용하지 않습니다. 실행
  방법이 여러 개인 게임은 **플레이** 위의 줄("직접 실행 ▴")에서 직접 실행, 게임 전용 런처(HoYoPlay,
  쿠로 런처, GRYPHLINK — 그 런처로 설치한 경우), 스토어 중에서 고를 수 있으며, 선택은 게임마다
  기억됩니다.
- **사이드 패널**에는 선택한 게임의 기한이 있는 리딤 코드, 진행 중이거나 곧 시작할 배너(캐러셀이 자동으로
  넘어갑니다), 최신 공식 영상이 표시됩니다. 각 섹션은 제목을 눌러 접을 수 있고, 공식 SNS 열은 가장자리의
  탭 뒤로 숨길 수 있습니다. 접은 상태는 모든 게임에 적용되며 다시 시작해도 유지됩니다.
- **언어:** 인터페이스는 한국어, English, Русский, 简体中文, 日本語, 영상은 영어 또는 일본어입니다.
  코드 보상이나 배너 이름 같은 데이터는 영어 위키에서 가져오기 때문에 영어로 표시됩니다.
- **배경:** 원신, 붕괴: 스타레일, 젠레스 존 제로는 공식 HoYoPlay 배경(애니메이션이 켜져 있으면 영상)을
  사용합니다. 스토어 아트워크나 직접 고른 이미지, 영상도 쓸 수 있습니다.
- **트레이:** 창을 닫으면 트레이로 숨길 수 있고, 트레이 메뉴에서 게임을 실행할 수도 있습니다.
- **Windows 시작 시 실행:** 트레이에 숨은 상태로 시작해 코드와 배너를 최신으로 유지합니다.

## 데이터 출처

패널의 코드, 배너, 영상은 GitHub Actions에서 도는 별도의 수집 프로그램이 모아 파일 하나로 공개합니다.

- 저장소: https://github.com/Ertezy/Kitsudock-data
- 파일: https://ertezy.github.io/Kitsudock-data/hub.json

수집 프로그램은 커뮤니티 위키(Fandom, wiki.gg — CC BY-SA), 명조: 워더링 웨이브 공식 공지(제목, 캐릭터,
기간 같은 사실만), 공식 HoYoPlay 런처(원신, 붕괴: 스타레일, 젠레스 존 제로의 현재 배경 링크), 공개 API
미러, 각 게임의 공식 YouTube 채널을 읽습니다. 모든 코드와 배너에는 출처 링크가 있습니다. 설정 → 데이터 →
데이터 출처 주소에서 다른 주소를 지정할 수도 있습니다.

## 개발자용

구조 설명, 소스에서 빌드하기, 테스트는 [영어 README](README.md#how-it-works)를 참고하세요.

## 라이선스

MIT — [LICENSE](LICENSE)를 참고하세요. 게임 이름, 아트워크, 상표의 권리는 각 권리자에게 있습니다.
Genshin Impact, Honkai: Star Rail and Zenless Zone Zero: © All rights reserved by HoYoverse.
