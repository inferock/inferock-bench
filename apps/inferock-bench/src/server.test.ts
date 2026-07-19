import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureGeneratedBenchKey, resolveBenchPaths } from "./config.js";
import {
  ExternalHostRefusedError,
  resolveServerBindOptions,
  startServer,
} from "./server.js";

const { serveMock } = vi.hoisted(() => ({ serveMock: vi.fn() }));

vi.mock("@hono/node-server", () => ({
  serve: serveMock,
}));

describe("server host binding", () => {
  beforeEach(() => {
    serveMock.mockReset();
  });

  it("refuses non-loopback CLI hosts by default", () => {
    expect(() => resolveServerBindOptions({
      host: "0.0.0.0",
      env: {},
    })).toThrow(ExternalHostRefusedError);
  });

  it("refuses non-loopback INFEROCK_BENCH_HOST by default", () => {
    expect(() => resolveServerBindOptions({
      env: { INFEROCK_BENCH_HOST: "192.168.1.20" },
    })).toThrow(/--allow-external-host/);
  });

  it("allows explicit external host opt-in with a network-reachable warning", async () => {
    const home = await mkdtemp(join(tmpdir(), "inferock-bench-server-"));
    const paths = resolveBenchPaths({ INFEROCK_BENCH_HOME: home });
    const config = await ensureGeneratedBenchKey({ paths, config: {} });
    const lines: string[] = [];

    await startServer({
      paths,
      config,
      host: "0.0.0.0",
      port: 4999,
      env: { INFEROCK_BENCH_HOME: home },
      log: (line) => lines.push(line),
      allowExternalHost: true,
    });

    expect(lines.join("\n")).toContain("WARNING: --allow-external-host is enabled");
    expect(lines.join("\n")).toContain("proxy and management APIs are reachable from other machines");
    expect(serveMock).toHaveBeenCalledWith(expect.objectContaining({
      hostname: "0.0.0.0",
      port: 4999,
    }));
  });
});
