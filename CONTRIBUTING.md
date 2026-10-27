# Contributing / Участие в проекте

## English

Report bugs with the [bug report form](https://github.com/Ertezy/Kitsudock/issues/new?template=bug_report.yml).
Include your app and Windows versions, steps to reproduce, and expected and actual
results. Remove personal data from any logs you attach. Report security
vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

To suggest an idea, [open an issue](https://github.com/Ertezy/Kitsudock/issues/new)
and describe what you would like to do in the app and why it would help.

For setup and build instructions, see [Building from source](README.md#building-from-source).
Run these checks from the project root:

```sh
npx vitest run
npx tsc --noEmit
npm run build
cd src-tauri
cargo test
cargo build
```

The project is maintained by one person in their spare time, so replies may take a
while. Game artwork is not accepted in this repository.

## Русский

Об ошибке сообщите через [форму](https://github.com/Ertezy/Kitsudock/issues/new?template=bug_report.yml).
Укажите версии приложения и Windows, шаги воспроизведения, ожидаемый и фактический
результат. Удалите личные данные из журналов, которые прикладываете. Об уязвимостях
сообщайте приватно по инструкции в [SECURITY.md](SECURITY.md).

Чтобы предложить идею, [откройте issue](https://github.com/Ertezy/Kitsudock/issues/new)
и опишите, что вы хотите делать в приложении и чем это поможет.

Подготовка окружения и сборка описаны в [README](README.md#building-from-source).
Запустите проверки из корня проекта:

```sh
npx vitest run
npx tsc --noEmit
npm run build
cd src-tauri
cargo test
cargo build
```

Проект ведёт один человек в свободное время, поэтому ответ может прийти не сразу.
В репозиторий не принимается арт игр.
