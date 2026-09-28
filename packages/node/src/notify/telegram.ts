// Telegram, as a place the workers can tell a human something.
//
// The bot token is a channel credential and gets the venue-credential rule: it
// lives in the worker process environment and nowhere else. The backend never
// receives it, no table stores it, and no mutation takes it as an argument. A
// deployment with no token configured simply has no channel.
//
// Plain text only, no parse_mode. Subjects and criteria are free text a person
// or an agent typed, and Markdown or HTML mode rejects the whole message over
// one unescaped underscore, which is the failure nobody sees because the point
// of the message was that nobody was looking.

const DEFAULT_BASE_URL = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;
// Telegram's own ceiling for one message.
export const TELEGRAM_MAX_CHARS = 4096;
const TRUNCATION_MARK = "\n...";
const PERCENT = 100;
const BRIER_DIGITS = 3;

type EnvLike = Record<string, string | undefined>;

export type TelegramConfig = { botToken: string; chatId: string };

export type TelegramOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type Notify = (text: string) => Promise<void>;

// Both or neither. Half a configuration is a typo, not an opt-out, so it is
// named once at startup instead of silently sending nothing for months.
export function telegramConfigFromEnv(
  env: EnvLike = process.env,
  warn: (message: string) => void = console.warn,
): TelegramConfig | null {
  const botToken = env.OPENPORTFOLIO_TELEGRAM_BOT_TOKEN;
  const chatId = env.OPENPORTFOLIO_TELEGRAM_CHAT_ID;
  if (botToken && chatId) return { botToken, chatId };
  if (botToken || chatId) {
    warn("Telegram needs both OPENPORTFOLIO_TELEGRAM_BOT_TOKEN and OPENPORTFOLIO_TELEGRAM_CHAT_ID; not sending");
  }
  return null;
}

export function clampMessage(text: string): string {
  if (text.length <= TELEGRAM_MAX_CHARS) return text;
  return text.slice(0, TELEGRAM_MAX_CHARS - TRUNCATION_MARK.length) + TRUNCATION_MARK;
}

// The token is part of the request URL, so no error from here may carry the
// URL or the underlying fetch error, either of which can quote it into a log.
export async function sendTelegram(config: TelegramConfig, text: string, opts: TelegramOptions = {}): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? DEFAULT_BASE_URL}/bot${config.botToken}/sendMessage`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text: clampMessage(text), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new Error("telegram unreachable");
  }
  if (!res.ok) throw new Error(`telegram ${res.status}`);
}

// Every configured channel, each one failing on its own. A notification is
// never worth a sync: an outage at the channel logs a line and the pass goes
// on. Null when nothing is configured, so a caller can skip formatting too.
export function createNotifier(
  env: EnvLike = process.env,
  opts: TelegramOptions & { warn?: (message: string) => void } = {},
): Notify | null {
  const warn = opts.warn ?? console.warn;
  const telegram = telegramConfigFromEnv(env, warn);
  if (!telegram) return null;
  return async (text: string) => {
    try {
      await sendTelegram(telegram, text, opts);
    } catch (e) {
      warn(`  ! notify: ${(e as Error).message}`);
    }
  };
}

// Keys not announced before, remembered as they are returned. A due item stays
// due until someone deals with it, and the sweep that finds it runs every hour.
export function unannounced(seen: Set<string>, keys: readonly string[]): string[] {
  const fresh: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(key);
  }
  return fresh;
}

export type SettledCall = { subject: string; probability: number; outcome: boolean; brier: number };

export function formatSettled(calls: readonly SettledCall[]): string {
  const lines = [`openportfolio: ${calls.length} ${plural(calls.length, "call")} settled`];
  for (const call of calls) {
    const said = `${Math.round(call.probability * PERCENT)}%`;
    const happened = call.outcome ? "happened" : "did not happen";
    lines.push(`- ${call.subject}: said ${said}, ${happened}, Brier ${call.brier.toFixed(BRIER_DIGITS)}`);
  }
  return lines.join("\n");
}

export type OverdueDecision = { key: string; title: string; triggerCondition: string };
export type UnparsedForecast = { subject: string; resolutionCriterion: string };

// What the agent worker is about to hand a CLI. Sent before the CLI runs, so a
// person hears about it even when every provider in the chain fails.
export function formatNeedsReading(
  decisions: readonly OverdueDecision[],
  forecasts: readonly UnparsedForecast[],
): string {
  const lines = ["openportfolio: due for a judgement"];
  if (decisions.length > 0) {
    lines.push("", `${decisions.length} deferred ${plural(decisions.length, "decision")} past the trigger date:`);
    for (const decision of decisions) lines.push(`- ${decision.title} (trigger: ${decision.triggerCondition})`);
  }
  if (forecasts.length > 0) {
    lines.push("", `${forecasts.length} ${plural(forecasts.length, "forecast")} no parser can settle:`);
    for (const forecast of forecasts) lines.push(`- ${forecast.subject} (criterion: ${forecast.resolutionCriterion})`);
  }
  return lines.join("\n");
}

function plural(n: number, word: string): string {
  if (n === 1) return word;
  return `${word}s`;
}
