import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { stableSha256 } from "../coverage-suite/canonical-json.js";
import { BENCH_PACKAGE_VERSION as CURRENT_BENCH_PACKAGE_VERSION } from "../version.js";

export { BENCH_PACKAGE_VERSION } from "../version.js";

const execFileAsync = promisify(execFile);

export const OPENCODE_AGENT_VERSION = "1.17.13";
export const AGENT_INSTALL_WHY_TEXT =
  "this local coding agent performs bundled coding tasks through localhost using only an ephemeral ibl_ bench key.";

export interface AgentPackageSpec {
  readonly name: string;
  readonly version: string;
  readonly tarballUrl: string;
  readonly integrity: string;
  readonly unpackedSize: number;
  readonly hasLifecycleScript?: boolean;
}

export interface AgentProvisioningPlan {
  readonly agent: {
    readonly name: "opencode-ai";
    readonly version: typeof OPENCODE_AGENT_VERSION;
  };
  readonly platform: string;
  readonly arch: string;
  readonly libc?: "glibc" | "musl";
  readonly platformLabel: string;
  readonly benchVersion: string;
  readonly whyText: string;
  readonly installRoot: string;
  readonly executablePath: string;
  readonly packages: readonly AgentPackageSpec[];
  readonly consentHash: string;
}

export interface ProvisionAgentInput {
  readonly plan: AgentProvisioningPlan;
  readonly fetchTarball?: (url: string) => Promise<Buffer>;
  readonly unpackTarball?: (bytes: Buffer, destination: string) => Promise<void>;
  readonly markExecutable?: (path: string) => Promise<void>;
  readonly npmInstallFallback?: () => Promise<never>;
}

export interface ProvisionAgentResult {
  readonly status: "installed" | "already-installed";
  readonly executablePath: string;
  readonly manifestPath: string;
}

export interface AgentProvisioningFailureDetail {
  readonly agentName: string;
  readonly agentVersion: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly tarballUrl: string;
  readonly platform: string;
  readonly reason: string;
}

export class AgentProvisioningFailureError extends Error {
  constructor(readonly detail: AgentProvisioningFailureDetail) {
    super([
      `Agent provisioning failed for ${detail.packageName}@${detail.packageVersion}`,
      `platform=${detail.platform}`,
      `url=${detail.tarballUrl}`,
      `reason=${detail.reason}`,
      "Run the built-in driver instead as a separate action; the generator was not changed automatically.",
    ].join(" "));
    this.name = "AgentProvisioningFailureError";
  }
}

export interface PlanAgentProvisioningInput {
  readonly benchHome: string;
  readonly platform?: NodeJS.Platform | "test";
  readonly arch?: NodeJS.Architecture | "x64";
  readonly libc?: "glibc" | "musl";
  readonly rootPackage?: AgentPackageSpec;
  readonly platformPackage?: AgentPackageSpec;
  readonly benchVersion?: string;
  readonly whyText?: string;
}

const ROOT_PACKAGE: AgentPackageSpec = {
  name: "opencode-ai",
  version: OPENCODE_AGENT_VERSION,
  tarballUrl: "https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.17.13.tgz",
  integrity: "sha512-qUb9m6X6f9/imuDxc2tUcN+E1vx1XWjmQWJo2Pk/t+cNxqt5KGkaMF89CvJK6QQP7gx1E82gKpV7n1QiI5spxQ==",
  unpackedSize: 7865,
  hasLifecycleScript: true,
};

const PLATFORM_PACKAGES: Record<string, AgentPackageSpec> = {
  "linux-x64": {
    name: "opencode-linux-x64",
    version: OPENCODE_AGENT_VERSION,
    tarballUrl: "https://registry.npmjs.org/opencode-linux-x64/-/opencode-linux-x64-1.17.13.tgz",
    integrity: "sha512-6naffcRwMLUM0kYuwJ3tRWt1/NXPybt9u8ZqTvSZwATM54+GhQmoiz8Qb9GYFTiwSJmB1rq8VoEmwh1VPzBcFw==",
    unpackedSize: 167_639_306,
  },
  "linux-arm64": {
    name: "opencode-linux-arm64",
    version: OPENCODE_AGENT_VERSION,
    tarballUrl: "https://registry.npmjs.org/opencode-linux-arm64/-/opencode-linux-arm64-1.17.13.tgz",
    integrity: "sha512-NgBu9go6DTgi2OJ04Q54kgbQFWOmv70cdBUsGr74SdXWEpi/VNIWc/5e5eYJ123ogW25uB03H5jFQx5XKsKzUQ==",
    unpackedSize: 167_029_022,
  },
  "linux-x64-musl": {
    name: "opencode-linux-x64-musl",
    version: OPENCODE_AGENT_VERSION,
    tarballUrl: "https://registry.npmjs.org/opencode-linux-x64-musl/-/opencode-linux-x64-musl-1.17.13.tgz",
    integrity: "sha512-dEfj9Q/RGnpN09e1TzpZHeEUEdvH1zqU+FlEOFHBs4cjRaH5K8eeqzqBU3/ux6i3g7Yc9UVPvb3l2kO9rH8Y9g==",
    unpackedSize: 164_370_891,
  },
  "linux-arm64-musl": {
    name: "opencode-linux-arm64-musl",
    version: OPENCODE_AGENT_VERSION,
    tarballUrl: "https://registry.npmjs.org/opencode-linux-arm64-musl/-/opencode-linux-arm64-musl-1.17.13.tgz",
    integrity: "sha512-OqBGh0gc2my1r/dtzylYNpRUWsc27G6FqtatzqJMxx5OVhm/Bdgm41E1jgYWuR8x2bGuiU4sLltfbVT6Eq6E+g==",
    unpackedSize: 162_574_375,
  },
  "darwin-x64": {
    name: "opencode-darwin-x64",
    version: OPENCODE_AGENT_VERSION,
    tarballUrl: "https://registry.npmjs.org/opencode-darwin-x64/-/opencode-darwin-x64-1.17.13.tgz",
    integrity: "sha512-/t0bYlCA570IwUIucZrT1Oo7iXjQ/G1s/lzQuAJJ4mr9CjeJ8TpZnFC1pRvACfviwO9NxXz9qIKbSQatLJK6ZA==",
    unpackedSize: 135_708_892,
  },
  "darwin-arm64": {
    name: "opencode-darwin-arm64",
    version: OPENCODE_AGENT_VERSION,
    tarballUrl: "https://registry.npmjs.org/opencode-darwin-arm64/-/opencode-darwin-arm64-1.17.13.tgz",
    integrity: "sha512-JSIDA4DUMzg2rOyUvnb4YnI4FDvPuI4Hjmlg+OoAcUCZJUGLFabPZLDfMNzEmzmRa3LWR00GFcgxVctXQ25xzg==",
    unpackedSize: 130_105_202,
  },
  "win32-x64": {
    name: "opencode-windows-x64",
    version: OPENCODE_AGENT_VERSION,
    tarballUrl: "https://registry.npmjs.org/opencode-windows-x64/-/opencode-windows-x64-1.17.13.tgz",
    integrity: "sha512-WhRcfrVCwMsEpftrnmSIwNayCDBypDPaUjHAtl+uubRP0jILDq8Ra94Jfo3BAU/4JJDqZzKGbUXYrd62/6r6Jg==",
    unpackedSize: 165_897_236,
  },
  "win32-arm64": {
    name: "opencode-windows-arm64",
    version: OPENCODE_AGENT_VERSION,
    tarballUrl: "https://registry.npmjs.org/opencode-windows-arm64/-/opencode-windows-arm64-1.17.13.tgz",
    integrity: "sha512-up2dXI0VcnDPpm2AQnaXZ0e0BajtAQpFj4RBvAxTnXK4ZgEh0OgLialTLIqQ5zBzmMPwvRQNUmRVqAFOq/UOHw==",
    unpackedSize: 161_828_888,
  },
};

export function planAgentProvisioning(input: PlanAgentProvisioningInput): AgentProvisioningPlan {
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const platformKey = input.platformPackage ? `${platform}-${arch}` : platformPackageKey(platform, arch, input.libc);
  const platformPackage = input.platformPackage ?? PLATFORM_PACKAGES[platformKey];
  if (!platformPackage) throw new Error(`No pinned opencode package for platform ${platformKey}.`);

  const installRoot = join(input.benchHome, "agents", "opencode-ai", OPENCODE_AGENT_VERSION, platformKey);
  const executableName = platform === "win32" ? "opencode.exe" : "opencode";
  const executablePath = join(installRoot, "platform", "package", "bin", executableName);
  const packages = [input.rootPackage ?? ROOT_PACKAGE, platformPackage];
  const benchVersion = input.benchVersion ?? CURRENT_BENCH_PACKAGE_VERSION;
  const whyText = input.whyText ?? AGENT_INSTALL_WHY_TEXT;
  const platformLabel = `${platform}-${arch}${input.libc ? `-${input.libc}` : ""}`;
  const consentHash = stableSha256({
    agent: { name: "opencode-ai", version: OPENCODE_AGENT_VERSION },
    benchVersion,
    whyText,
    platform: platformLabel,
    installRoot,
    packages: packages.map((entry) => ({
      name: entry.name,
      version: entry.version,
      tarballUrl: entry.tarballUrl,
      integrity: entry.integrity,
      unpackedSize: entry.unpackedSize,
    })),
  });
  return {
    agent: { name: "opencode-ai", version: OPENCODE_AGENT_VERSION },
    platform,
    arch,
    ...(input.libc ? { libc: input.libc } : {}),
    platformLabel,
    benchVersion,
    whyText,
    installRoot,
    executablePath,
    packages,
    consentHash,
  };
}

export function agentInstallConsentText(plan: AgentProvisioningPlan): string {
  return [
    `Inferock Bench ${plan.benchVersion} will download ${plan.agent.name}@${plan.agent.version} as a local coding agent.`,
    `Platform: ${plan.platformLabel}`,
    `Install path: ${plan.installRoot}`,
    `Why: ${plan.whyText}`,
    ...plan.packages.map((entry) =>
      `Package: ${entry.name}@${entry.version} ${entry.tarballUrl} ${entry.integrity} unpacked=${entry.unpackedSize} bytes`
    ),
    `Consent hash: ${plan.consentHash}`,
  ].join("\n");
}

export async function provisionAgent(input: ProvisionAgentInput): Promise<ProvisionAgentResult> {
  const manifestPath = join(input.plan.installRoot, "install-manifest.json");
  if (await verifiedInstallExists(input.plan, manifestPath)) {
    return {
      status: "already-installed",
      executablePath: input.plan.executablePath,
      manifestPath,
    };
  }

  await rm(input.plan.installRoot, { recursive: true, force: true });
  await mkdir(input.plan.installRoot, { recursive: true });

  for (const [index, packageSpec] of input.plan.packages.entries()) {
    try {
      const bytes = await (input.fetchTarball ?? fetchTarball)(packageSpec.tarballUrl);
      assertIntegrity(bytes, packageSpec);
      const destination = join(input.plan.installRoot, index === 0 ? "root" : "platform");
      await mkdir(destination, { recursive: true });
      await (input.unpackTarball ?? unpackTarballWithSystemTar)(bytes, destination);
    } catch (error) {
      throw agentProvisioningFailure(input.plan, packageSpec, error);
    }
  }

  try {
    await (input.markExecutable ?? ((path) => chmod(path, 0o755)))(input.plan.executablePath);
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: "inferock-agent-install-manifest-v1",
      agent: input.plan.agent,
      benchVersion: input.plan.benchVersion,
      whyText: input.plan.whyText,
      installedAt: new Date().toISOString(),
      consentHash: input.plan.consentHash,
      executablePath: input.plan.executablePath,
      packages: input.plan.packages,
      provisioner: "sri-verified-tarball-unpack-v1",
    }, null, 2)}\n`, "utf8");
  } catch (error) {
    throw agentProvisioningFailure(input.plan, input.plan.packages.at(-1) ?? input.plan.packages[0]!, error);
  }

  return {
    status: "installed",
    executablePath: input.plan.executablePath,
    manifestPath,
  };
}

function platformPackageKey(
  platform: NodeJS.Platform | "test",
  arch: NodeJS.Architecture | "x64",
  libc: "glibc" | "musl" | undefined,
): string {
  if (platform === "linux" && libc === "musl") return `${platform}-${arch}-musl`;
  return `${platform}-${arch}`;
}

async function verifiedInstallExists(plan: AgentProvisioningPlan, manifestPath: string): Promise<boolean> {
  try {
    const [manifestRaw] = await Promise.all([
      readFile(manifestPath, "utf8"),
      stat(plan.executablePath),
    ]);
    const manifest = JSON.parse(manifestRaw) as { consentHash?: unknown; executablePath?: unknown };
    return manifest.consentHash === plan.consentHash && manifest.executablePath === plan.executablePath;
  } catch {
    return false;
  }
}

async function fetchTarball(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download agent package ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function assertIntegrity(bytes: Buffer, packageSpec: AgentPackageSpec): void {
  const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (actual !== packageSpec.integrity) {
    throw new Error(`Agent package integrity mismatch for ${packageSpec.name}@${packageSpec.version}.`);
  }
}

function agentProvisioningFailure(
  plan: AgentProvisioningPlan,
  packageSpec: AgentPackageSpec,
  error: unknown,
): AgentProvisioningFailureError {
  return new AgentProvisioningFailureError({
    agentName: plan.agent.name,
    agentVersion: plan.agent.version,
    packageName: packageSpec.name,
    packageVersion: packageSpec.version,
    tarballUrl: packageSpec.tarballUrl,
    platform: `${plan.platform}-${plan.arch}${plan.libc ? `-${plan.libc}` : ""}`,
    reason: error instanceof Error ? error.message : String(error),
  });
}

async function unpackTarballWithSystemTar(bytes: Buffer, destination: string): Promise<void> {
  const tarballPath = join(destination, "package.tgz");
  await writeFile(tarballPath, bytes);
  await execFileAsync("tar", ["-xzf", tarballPath, "-C", destination]);
  await rm(tarballPath, { force: true });
}
