import { describe, expect, it } from "vitest";
import { redactAgentCommand, redactAgentEnv, redactAgentLogLine } from "./redaction.js";

describe("agent redaction", () => {
  it("redacts usable bench and provider key material from logs, args, and env", () => {
    const benchKey = ["ibl", "_1234567890abcdef12345678"].join("");
    const openAiKey = ["s", "k-proj-realproviderkey1234567890"].join("");
    const anthropicKey = ["s", "k-ant-realproviderkey1234567890"].join("");

    expect(redactAgentLogLine(
      `Authorization: Bearer ${benchKey} OPENAI_API_KEY=${openAiKey} ANTHROPIC_API_KEY=${anthropicKey}`,
    )).toBe("Authorization: Bearer <redacted:ibl_...> OPENAI_API_KEY=<redacted:sk-...> ANTHROPIC_API_KEY=<redacted:sk-ant-...>");

    expect(redactAgentCommand(["opencode", "run", "--api-key", benchKey, openAiKey]).join(" "))
      .not.toContain(benchKey);
    expect(redactAgentCommand(["opencode", "run", "--api-key", benchKey, openAiKey]).join(" "))
      .not.toContain(openAiKey);

    const env = redactAgentEnv({
      INFEROCK_AGENT_LOCAL_KEY: benchKey,
      OPENAI_API_KEY: openAiKey,
      ANTHROPIC_API_KEY: anthropicKey,
      PATH: "/usr/bin",
    });
    expect(JSON.stringify(env)).not.toContain(benchKey);
    expect(JSON.stringify(env)).not.toContain(openAiKey);
    expect(JSON.stringify(env)).not.toContain(anthropicKey);
    expect(env.PATH).toBe("/usr/bin");
  });
});
