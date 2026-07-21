// Copied from apps/proxy/src/sse.ts for inferock-bench Track C.

export interface SseMessage {
  readonly event?: string;
  readonly data: string;
}

export class SseAccumulator {
  #buffer = "";

  push(chunk: string): SseMessage[] {
    this.#buffer += chunk;
    const messages: SseMessage[] = [];

    while (true) {
      const normalized = this.#buffer.replace(/\r\n/g, "\n");
      const boundary = normalized.indexOf("\n\n");
      if (boundary === -1) break;

      const frame = normalized.slice(0, boundary);
      this.#buffer = normalized.slice(boundary + 2);
      const message = parseFrame(frame);
      if (message) messages.push(message);
    }

    return messages;
  }

  end(): SseMessage[] {
    const frame = this.#buffer.trimEnd();
    this.#buffer = "";
    const message = parseFrame(frame);
    return message ? [message] : [];
  }
}

function parseFrame(frame: string): SseMessage | undefined {
  if (frame.length === 0) return undefined;

  const data: string[] = [];
  let event: string | undefined;
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = stripOptionalFieldSpace(line.slice("event:".length));
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(stripOptionalFieldSpace(line.slice("data:".length)));
    }
  }

  if (data.length === 0) return undefined;
  return { ...(event ? { event } : {}), data: data.join("\n") };
}

function stripOptionalFieldSpace(value: string): string {
  return value.startsWith(" ") ? value.slice(1) : value;
}
