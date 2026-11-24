
import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

const LOG = "/tmp/opencode-silero.jsonl";
const CLAIM_DIR = "/tmp/opencode-silero-claims";

const INSTANCE_ID = randomUUID();


function cleanForSpeech(input) {
  return input
    // Убираем Markdown-блоки кода, сохраняя их содержимое
    .replace(/```[\w+-]*\s*([\s\S]*?)```/g, "$1")
    .replace(/~~~[\w+-]*\s*([\s\S]*?)~~~/g, "$1")

    // Убираем обратные кавычки
    .replace(/`([^`\n]+)`/g, "$1")

    // Ссылки: оставляем подпись, убираем URL
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "ссылка")

    // Заголовки, цитаты, списки
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*([-*_]){3,}\s*$/gm, "")

    // Текстовая запись умножения
    .replace(/\s+\*\s+/g, " умножить ")

    // Полностью удаляем маркеры форматирования
    .replace(/[*_~]/g, "")

    // Убираем HTML-теги
    .replace(/<[^>]*>/g, "")

    // Нормализуем пробелы
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Структурированное логирование в JSON Lines
function log(level, event, details = {}) {
  const record = {
    time: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    instance: INSTANCE_ID,
    ...details,
  };

  try {
    appendFileSync(LOG, JSON.stringify(record) + "\n");
  } catch (error) {
    console.error("[silero-plugin] Log error:", error);
  }
}

// Межпроцессная блокировка по ID события завершения.
// Файл создаётся атомарно: только один экземпляр получит право озвучить ответ.
function claimOnce(eventID) {
  if (!eventID) {
    throw new Error("Completion event has no ID");
  }

  mkdirSync(CLAIM_DIR, { recursive: true });

  const hash = createHash("sha256")
    .update(eventID)
    .digest("hex");

  const lockPath = join(CLAIM_DIR, `${hash}.lock`);

  const fd = openSync(lockPath, "wx", 0o600);
  closeSync(fd);
}

function createSessionState() {
  return {
    messages: new Map(),
    startedAt: Date.now(),
  };
}

// Собираем последний текстовый ответ ассистента.
// ordinal определяет порядок блоков внутри одного сообщения.
function getFinalText(state) {
  if (!state || state.messages.size === 0) {
    return "";
  }

  const lastMessage = [...state.messages.values()].at(-1);

  return [...lastMessage.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, text]) => text)
    .join("\n")
    .trim();
}

function speak(text, sessionID, completionEventID) {
  log("info", "speech_starting", {
    sessionID,
    completionEventID,
    characters: text.length,
    voice: "aidar",
    sampleRate: 24000,
  });

  const proc = spawn(
    "silero",
    ["-r", "24000", "-v", "aidar"],
    {
      stdio: ["pipe", "ignore", "pipe"],
    }
  );

  proc.on("spawn", () => {
    log("info", "silero_spawned", {
      sessionID,
      pid: proc.pid,
    });
  });

  proc.stderr.setEncoding("utf8");

  proc.stderr.on("data", (chunk) => {
    log("error", "silero_stderr", {
      sessionID,
      stderr: chunk.trim(),
    });
  });

  proc.stdin.on("error", (error) => {
    log("error", "silero_stdin_error", {
      sessionID,
      message: error.message,
      code: error.code,
    });
  });

  proc.on("error", (error) => {
    log("error", "silero_spawn_error", {
      sessionID,
      message: error.message,
      code: error.code,
    });
  });

  proc.on("close", (code, signal) => {
    log(
      code === 0 ? "info" : "error",
      "silero_finished",
      {
        sessionID,
        exitCode: code,
        signal,
      }
    );
  });

  proc.stdin.end(text);
}

export default {
  id: "silero-notify",

  setup(ctx) {
    const controller = new AbortController();
    const sessions = new Map();

    log("info", "plugin_loaded");

    void (async () => {
      for await (const event of ctx.event.subscribe({
        signal: controller.signal,
      })) {
        const data = event.data ?? {};
        const { sessionID } = data;

        // Начало нового выполнения
        if (event.type === "session.execution.started") {
          if (sessionID) {
            sessions.set(sessionID, createSessionState());

            log("info", "execution_started", {
              sessionID,
              eventID: event.id,
            });
          }

          continue;
        }

        // Получение полного текстового блока
        if (event.type === "session.text.ended") {
          const {
            assistantMessageID,
            ordinal,
            text,
          } = data;

          if (!sessionID || !assistantMessageID || !text) {
            log("warn", "invalid_text_event", {
              eventID: event.id,
            });
            continue;
          }

          let state = sessions.get(sessionID);

          if (!state) {
            state = createSessionState();
            sessions.set(sessionID, state);
          }

          if (!state.messages.has(assistantMessageID)) {
            state.messages.set(assistantMessageID, new Map());
          }

          state.messages
            .get(assistantMessageID)
            .set(ordinal, text);

          log("debug", "text_block_received", {
            sessionID,
            assistantMessageID,
            ordinal,
            characters: text.length,
            eventID: event.id,
          });

          continue;
        }

        // Единственная точка запуска озвучивания
        if (event.type === "session.execution.succeeded") {
          if (!sessionID) {
            log("warn", "completion_without_session", {
              eventID: event.id,
            });
            continue;
          }

          const state = sessions.get(sessionID);
          const text = getFinalText(state);

          sessions.delete(sessionID);

          if (!text) {
            log("warn", "completion_without_text", {
              sessionID,
              eventID: event.id,
            });
            continue;
          }

          // Атомарно захватываем право на озвучивание.
          try {
            claimOnce(event.id);
          } catch (error) {
            if (error.code === "EEXIST") {
              log("info", "duplicate_completion_ignored", {
                sessionID,
                eventID: event.id,
              });
              continue;
            }

            log("error", "claim_failed", {
              sessionID,
              eventID: event.id,
              message: error.message,
            });

            // При ошибке блокировки не запускаем потенциальный дубль.
            continue;
          }

          log("info", "execution_completed", {
            sessionID,
            eventID: event.id,
            characters: text.length,
            durationMs: state
              ? Date.now() - state.startedAt
              : null,
          });

          const speechText = cleanForSpeech(text);

          log("info", "speech_text_cleaned", {
            sessionID,
            originalCharacters: text.length,
            cleanedCharacters: speechText.length,
          });

          if (speechText) {
            speak(speechText, sessionID, event.id);
          }
          continue;
        }

        // Не озвучиваем частично завершённые ответы
        if (
          event.type === "session.execution.failed" ||
          event.type === "session.execution.interrupted"
        ) {
          if (sessionID) {
            sessions.delete(sessionID);
          }

          log("warn", "execution_not_completed", {
            sessionID,
            eventType: event.type,
            eventID: event.id,
          });
        }
      }
    })().catch((error) => {
      log("error", "event_loop_error", {
        message: error.message,
        stack: error.stack,
      });
    });

    return () => {
      controller.abort();
      log("info", "plugin_stopped");
    };
  },
};
