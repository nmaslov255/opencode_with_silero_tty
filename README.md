# OpenCode Silero TTS

## Вайб-говнокод плагин для OpenCode, озвучивает голосом ответы агентов.
## Передает текст через *nix контейнеры в Silero.
```bash
# Работает как-то так
AbstractAgentResponse | silero -r 24000 -v aidar

# Как добавить silero в path - сами придумайте, за меня это deepseek сделал :)
``` 

**English | Русский**


# OpenCode Silero TTS

Лёгкий локальный TTS-плагин для [OpenCode](https://opencode.ai/) на базе [Silero TTS](https://github.com/snakers4/silero-models).

Озвучивает завершённые ответы ассистента с помощью локального Silero CLI.

## Возможности

- Локальный синтез речи.
- Озвучивание только после завершения ответа.
- Защита от повторного воспроизведения.
- Очистка Markdown-разметки.
- Подробное логирование.
- Настраиваемые голос и частота дискретизации.

## Требования

- OpenCode
- Linux
- Установленный Silero CLI, доступный через `PATH`
- Работающий аудиовыход (например, PipeWire)

## Установка

Создайте директорию плагинов:

```bash
mkdir -p ~/.config/opencode/plugins
```

Скопируйте `silero.js` в:

```text
~/.config/opencode/plugins/silero.js
```

Перезапустите OpenCode.

## Настройка

Команда по умолчанию:

```bash
silero -r 24000 -v aidar
```

Для смены голоса или частоты дискретизации измените аргументы в `silero.js`.

## Логи

```bash
tail -f /tmp/opencode-silero.jsonl
```

---

A lightweight local TTS plugin for [OpenCode](https://opencode.ai/), powered by [Silero TTS](https://github.com/snakers4/silero-models).

Reads completed assistant responses aloud using the local Silero CLI.

## Features

- Local speech synthesis.
- Speaks only after response completion.
- Duplicate playback protection.
- Markdown cleanup.
- Structured logging.
- Configurable voice and sample rate.

## Requirements

- OpenCode
- Linux
- Silero CLI installed and available in `PATH`
- Working audio output (e.g. PipeWire)

## Installation

Create the plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
```

Copy `silero.js` into:

```text
~/.config/opencode/plugins/silero.js
```

Restart OpenCode.

## Configuration

Default command:

```bash
silero -r 24000 -v aidar
```

Edit the arguments in `silero.js` to change the voice or sample rate.

## Logs

```bash
tail -f /tmp/opencode-silero.jsonl
```

---

## License

MIT (if applicable).
