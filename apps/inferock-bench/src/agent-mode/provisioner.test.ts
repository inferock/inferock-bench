import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AGENT_INSTALL_WHY_TEXT,
  BENCH_PACKAGE_VERSION,
  OPENCODE_AGENT_VERSION,
  agentInstallConsentText,
  planAgentProvisioning,
  provisionAgent,
} from "./provisioner.js";

describe("agent provisioner", () => {
  it("plans pinned SRI-verified opencode tarballs in a per-user cache", () => {
    const plan = planAgentProvisioning({
      benchHome: "/tmp/inferock-home",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
    });

    expect(OPENCODE_AGENT_VERSION).toBe("1.17.13");
    expect(plan.agent.name).toBe("opencode-ai");
    expect(plan.agent.version).toBe("1.17.13");
    expect(plan.benchVersion).toBe(BENCH_PACKAGE_VERSION);
    expect(plan.whyText).toBe(AGENT_INSTALL_WHY_TEXT);
    expect(plan.platformLabel).toBe("linux-x64-glibc");
    expect(plan.packages.map((entry) => `${entry.name}@${entry.version}`)).toEqual([
      "opencode-ai@1.17.13",
      "opencode-linux-x64@1.17.13",
    ]);
    expect(plan.packages.every((entry) => entry.tarballUrl.startsWith("https://registry.npmjs.org/"))).toBe(true);
    expect(plan.packages.every((entry) => entry.integrity.startsWith("sha512-"))).toBe(true);
    expect(plan.installRoot).toBe("/tmp/inferock-home/agents/opencode-ai/1.17.13/linux-x64");
    expect(plan.executablePath).toBe("/tmp/inferock-home/agents/opencode-ai/1.17.13/linux-x64/platform/package/bin/opencode");
    expect(plan.consentHash).toMatch(/^sha256:/);
  });

  it("renders explicit install consent without treating cost or coverage as a dial", () => {
    const plan = planAgentProvisioning({
      benchHome: "/tmp/inferock-home",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
    });

    const text = agentInstallConsentText(plan);

    expect(text).toContain("opencode-ai@1.17.13");
    expect(text).toContain("opencode-linux-x64@1.17.13");
    expect(text).toContain("https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.17.13.tgz");
    expect(text).toContain(plan.consentHash);
    expect(text).toContain(`Inferock Bench ${BENCH_PACKAGE_VERSION}`);
    expect(text).toContain("Platform: linux-x64-glibc");
    expect(text).toContain("local coding agent");
    expect(text).toContain("localhost");
    expect(text).toContain("ephemeral ibl_ bench key");
    expect(text).not.toMatch(/skip|trim|lite|quality dial/i);
  });

  it("binds install consent hash to bench version and displayed why text", () => {
    const base = planAgentProvisioning({
      benchHome: "/tmp/inferock-home",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
    });
    const changedWhy = planAgentProvisioning({
      benchHome: "/tmp/inferock-home",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
      whyText: `${base.whyText} updated`,
    });
    const changedBenchVersion = planAgentProvisioning({
      benchHome: "/tmp/inferock-home",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
      benchVersion: `${BENCH_PACKAGE_VERSION}-changed`,
    });

    expect(changedWhy.consentHash).not.toBe(base.consentHash);
    expect(changedBenchVersion.consentHash).not.toBe(base.consentHash);
  });

  it("fetches and unpacks tarballs directly after SRI verification without npm lifecycle scripts", async () => {
    const benchHome = await mkdtemp(join(tmpdir(), "inferock-agent-provision-"));
    const rootTarball = Buffer.from("root package tarball");
    const platformTarball = Buffer.from("platform package tarball");
    const plan = planAgentProvisioning({
      benchHome,
      platform: "test",
      arch: "x64",
      platformPackage: {
        name: "opencode-test-x64",
        version: "1.17.13",
        tarballUrl: "https://registry.npmjs.org/opencode-test-x64/-/opencode-test-x64-1.17.13.tgz",
        integrity: sri(rootTarball),
        unpackedSize: rootTarball.length,
      },
      rootPackage: {
        name: "opencode-ai",
        version: "1.17.13",
        tarballUrl: "https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.17.13.tgz",
        integrity: sri(platformTarball),
        unpackedSize: platformTarball.length,
        hasLifecycleScript: true,
      },
    });
    const unpacked: { readonly destination: string; readonly bytes: Buffer }[] = [];
    let npmLifecycleAttempts = 0;

    const result = await provisionAgent({
      plan,
      fetchTarball: async (url) => {
        if (url.includes("opencode-test-x64")) return rootTarball;
        if (url.includes("opencode-ai")) return platformTarball;
        throw new Error(`unexpected url ${url}`);
      },
      unpackTarball: async (bytes, destination) => {
        unpacked.push({ bytes, destination });
      },
      markExecutable: async () => undefined,
      npmInstallFallback: async () => {
        npmLifecycleAttempts += 1;
        throw new Error("npm fallback must not be used");
      },
    });

    expect(result.status).toBe("installed");
    expect(unpacked.map((entry) => entry.destination)).toEqual([
      join(plan.installRoot, "root"),
      join(plan.installRoot, "platform"),
    ]);
    expect(npmLifecycleAttempts).toBe(0);
    const manifest = await readFile(join(plan.installRoot, "install-manifest.json"), "utf8");
    expect(manifest).toContain(plan.consentHash);
    expect(manifest).toContain(plan.benchVersion);
    expect(manifest).toContain(plan.whyText);
  });

  it("rejects tarballs whose bytes do not match the pinned SRI", async () => {
    const benchHome = await mkdtemp(join(tmpdir(), "inferock-agent-provision-"));
    const plan = planAgentProvisioning({
      benchHome,
      platform: "test",
      arch: "x64",
      platformPackage: {
        name: "opencode-test-x64",
        version: "1.17.13",
        tarballUrl: "https://registry.npmjs.org/opencode-test-x64/-/opencode-test-x64-1.17.13.tgz",
        integrity: sri(Buffer.from("expected")),
        unpackedSize: 8,
      },
    });

    await expect(provisionAgent({
      plan,
      fetchTarball: async () => Buffer.from("tampered"),
      unpackTarball: async () => undefined,
      markExecutable: async () => undefined,
    })).rejects.toThrow(/integrity/i);
  });
});

function sri(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
