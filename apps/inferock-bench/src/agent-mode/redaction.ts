const SECRET_ENV_NAMES = new Set([
  "INFEROCK_AGENT_LOCAL_KEY",
  "INFEROCK_BENCH_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "INFEROCK_BENCH_OPENAI_API_KEY",
  "INFEROCK_BENCH_ANTHROPIC_API_KEY",
  "AUTHORIZATION",
]);

export function redactAgentLogLine(line: string): string {
  return redactSecretTokens(
    line.replace(
      /\b([A-Z0-9_]*(?:API_KEY|AUTHORIZATION|TOKEN|SECRET|LOCAL_KEY)[A-Z0-9_]*)=([^\s]+)/gi,
      (_match, name: string, value: string) => `${name}=${redactionForSecret(value)}`,
    ).replace(
      /\bAuthorization:\s*Bearer\s+([^\s]+)/gi,
      (_match, value: string) => `Authorization: Bearer ${redactionForSecret(value)}`,
    ),
  );
}

export function redactAgentCommand(args: readonly string[]): string[] {
  return args.map((arg) => redactAgentLogLine(arg));
}

export function redactAgentEnv(env: Record<string, string | undefined>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    redacted[key] = SECRET_ENV_NAMES.has(key.toUpperCase())
      ? redactionForSecret(value)
      : redactAgentLogLine(value);
  }
  return redacted;
}

function redactSecretTokens(value: string): string {
  return value
    .replace(/\bibl_[A-Za-z0-9_-]{8,}\b/g, "<redacted:ibl_...>")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, "<redacted:sk-ant-...>")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "<redacted:sk-...>");
}

function redactionForSecret(value: string): string {
  if (/^ibl_/i.test(value)) return "<redacted:ibl_...>";
  if (/^sk-ant-/i.test(value)) return "<redacted:sk-ant-...>";
  if (/^sk-/i.test(value)) return "<redacted:sk-...>";
  return "<redacted:secret>";
}
