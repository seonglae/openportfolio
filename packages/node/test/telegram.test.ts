import { describe, expect, it } from "vitest";
import {
  TELEGRAM_MAX_CHARS,
  clampMessage,
  createNotifier,
  formatNeedsReading,
  formatSettled,
  sendTelegram,
  telegramConfigFromEnv,
  unannounced,
} from "../src/notify/telegram.ts";

const TOKEN = "123456:secret-token-value";
const CONFIG = { botToken: TOKEN, chatId: "42" };

type Sent = { url: string; body: Record<string, unknown> };

function stubFetch(status = 200) {
  const sent: Sent[] = [];
  const impl = async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: status < 300, status };
  };
  return { impl: impl as unknown as typeof fetch, sent };
}

describe("reading the channel from the worker environment", () => {
  it("needs both the token and the chat", () => {
    const warnings: string[] = [];
    const env = { OPENPORTFOLIO_TELEGRAM_BOT_TOKEN: TOKEN, OPENPORTFOLIO_TELEGRAM_CHAT_ID: "42" };
    expect(telegramConfigFromEnv(env, (m) => warnings.push(m))).toEqual(CONFIG);
    expect(warnings).toHaveLength(0);
  });

  it("treats nothing configured as no channel, silently", () => {
    const warnings: string[] = [];
    expect(telegramConfigFromEnv({}, (m) => warnings.push(m))).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  // Half a configuration is a typo. Saying nothing would look like a quiet week.
  it("names half a configuration instead of sending nothing for months", () => {
    const warnings: string[] = [];
    expect(telegramConfigFromEnv({ OPENPORTFOLIO_TELEGRAM_BOT_TOKEN: TOKEN }, (m) => warnings.push(m))).toBeNull();
    expect(warnings[0]).toContain("OPENPORTFOLIO_TELEGRAM_CHAT_ID");
    expect(warnings[0]).not.toContain(TOKEN);
  });
});

describe("sending", () => {
  it("posts plain text to the configured chat", async () => {
    const { impl, sent } = stubFetch();
    await sendTelegram(CONFIG, "hello_world *not bold*", { fetchImpl: impl, baseUrl: "https://tg.test" });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`https://tg.test/bot${TOKEN}/sendMessage`);
    expect(sent[0].body.chat_id).toBe("42");
    expect(sent[0].body.text).toBe("hello_world *not bold*");
    // Markdown mode would reject the message above over its underscore.
    expect(sent[0].body.parse_mode).toBeUndefined();
  });

  // The token is in the URL, so an error that quotes the URL leaks it to a log.
  it("never puts the token in an error", async () => {
    const { impl } = stubFetch(401);
    await expect(sendTelegram(CONFIG, "x", { fetchImpl: impl })).rejects.toThrow("telegram 401");
    const failing = (async (url: string) => {
      throw new TypeError(`fetch failed for ${url}`);
    }) as unknown as typeof fetch;
    const err = await sendTelegram(CONFIG, "x", { fetchImpl: failing }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("keeps a long message under Telegram's limit rather than having it refused", () => {
    const long = "x".repeat(TELEGRAM_MAX_CHARS + 500);
    const clamped = clampMessage(long);
    expect(clamped.length).toBe(TELEGRAM_MAX_CHARS);
    expect(clamped.endsWith("...")).toBe(true);
    expect(clampMessage("short")).toBe("short");
  });
});

describe("dispatch", () => {
  it("is null with no channel, so the caller skips the formatting too", () => {
    expect(createNotifier({}, { warn: () => {} })).toBeNull();
  });

  it("sends through every configured channel", async () => {
    const { impl, sent } = stubFetch();
    const env = { OPENPORTFOLIO_TELEGRAM_BOT_TOKEN: TOKEN, OPENPORTFOLIO_TELEGRAM_CHAT_ID: "42" };
    const notify = createNotifier(env, { fetchImpl: impl });
    expect(notify).not.toBeNull();
    if (notify) await notify("settled");
    expect(sent.map((s) => s.body.text)).toEqual(["settled"]);
  });

  // A notification is never worth a sync.
  it("swallows a channel outage into a warning", async () => {
    const { impl } = stubFetch(502);
    const warnings: string[] = [];
    const env = { OPENPORTFOLIO_TELEGRAM_BOT_TOKEN: TOKEN, OPENPORTFOLIO_TELEGRAM_CHAT_ID: "42" };
    const notify = createNotifier(env, { fetchImpl: impl, warn: (m) => warnings.push(m) });
    if (notify) await expect(notify("x")).resolves.toBeUndefined();
    expect(warnings).toEqual(["  ! notify: telegram 502"]);
  });

  it("announces a due item once, not on every hourly sweep", () => {
    const seen = new Set<string>();
    expect(unannounced(seen, ["a", "b"])).toEqual(["a", "b"]);
    expect(unannounced(seen, ["a", "b", "c"])).toEqual(["c"]);
    expect(unannounced(seen, ["a"])).toEqual([]);
  });
});

describe("formatting", () => {
  it("says what was said, what happened, and the score", () => {
    const text = formatSettled([
      { subject: "BTC above 100k by Friday", probability: 0.7, outcome: false, brier: 0.49 },
      { subject: "VWRL above 120", probability: 0.4, outcome: true, brier: 0.36 },
    ]);
    expect(text).toBe(
      [
        "openportfolio: 2 calls settled",
        "- BTC above 100k by Friday: said 70%, did not happen, Brier 0.490",
        "- VWRL above 120: said 40%, happened, Brier 0.360",
      ].join("\n"),
    );
  });

  it("uses the singular for one call", () => {
    const text = formatSettled([{ subject: "s", probability: 0.5, outcome: true, brier: 0.25 }]);
    expect(text.split("\n")[0]).toBe("openportfolio: 1 call settled");
  });

  it("lists decisions and prose forecasts in their own sections, and leaves out an empty one", () => {
    const both = formatNeedsReading(
      [{ key: "k", title: "Revisit the bond sleeve", triggerCondition: "after the CPI print" }],
      [{ subject: "Rate cut in March", resolutionCriterion: "the central bank cuts at the March meeting" }],
    );
    expect(both).toContain("1 deferred decision past the trigger date:");
    expect(both).toContain("- Revisit the bond sleeve (trigger: after the CPI print)");
    expect(both).toContain("1 forecast no parser can settle:");

    const onlyDecisions = formatNeedsReading([{ key: "k", title: "t", triggerCondition: "c" }], []);
    expect(onlyDecisions).not.toContain("forecast");
  });
});
