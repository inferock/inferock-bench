import { randomUUID } from "node:crypto";
import { roundUsd } from "@inferock/measure/pricing";
import { AgentProvisioningFailureError, planAgentProvisioning, provisionAgent, } from "../agent-mode/provisioner.js";
import { estimateCoverageSuite, } from "./estimate.js";
import { runAgentCoverageSuite, } from "./agent-runner.js";
import { runBuiltInCoverageSuite, } from "./runner.js";
import { createCombinedSpeedTestReceiptBundle } from "./provider-scope.js";
export async function runProviderParallelCoverageSuite(input) {
    const runId = input.runId ?? `speedtest_${randomUUID()}`;
    const startedAt = input.startedAt ?? new Date().toISOString();
    const consentedAt = input.consentedAt ?? startedAt;
    const providers = uniqueProviders(input.estimate.selectedModels.map((model) => model.provider));
    const enclosingParallelProviderCount = providers.length;
    const agentExecutable = input.estimate.generator === "agent"
        ? await resolveAgentExecutable(input)
        : undefined;
    const jobs = providers.map(async (provider) => {
        const providerRunId = providers.length === 1 ? runId : `${runId}/${provider}`;
        const providerEstimate = estimateForProvider(input, provider);
        if (agentExecutable) {
            const result = await runAgentCoverageSuite({
                runId: providerRunId,
                provider,
                suite: input.suite,
                baseline: input.baseline,
                estimate: providerEstimate,
                config: input.config,
                env: input.env,
                store: input.store,
                providerFetch: input.providerFetch,
                benchHome: input.benchHome,
                executablePath: agentExecutable.executablePath,
                agentSource: agentExecutable.source,
                agentVersion: agentExecutable.version,
                ...(input.agentInstallConsentHash ? { acceptedAgentInstallHash: input.agentInstallConsentHash } : {}),
                agentProcessRunner: input.agentProcessRunner,
                log: input.log,
                startedAt,
                consentedAt,
                abortSignal: input.abortSignal,
                onProgress: input.onProgress
                    ? async (event) => input.onProgress?.({ ...event, provider })
                    : undefined,
            });
            return withProviderScope(result, provider, enclosingParallelProviderCount);
        }
        const result = await runBuiltInCoverageSuite({
            runId: providerRunId,
            suite: input.suite,
            baseline: input.baseline,
            estimate: providerEstimate,
            config: input.config,
            env: input.env,
            store: input.store,
            providerFetch: input.providerFetch,
            log: input.log,
            startedAt,
            consentedAt,
            abortSignal: input.abortSignal,
            onProgress: input.onProgress
                ? async (event) => input.onProgress?.({ ...event, provider })
                : undefined,
        });
        return withProviderScope(result, provider, enclosingParallelProviderCount);
    });
    const providerResults = await Promise.all(jobs);
    const receipt = providerResults.length === 1
        ? providerResults[0].receipt
        : createCombinedSpeedTestReceiptBundle({
            runId,
            startedAt,
            endedAt: new Date().toISOString(),
            providerReceipts: providerResults.map((result) => result.receipt),
            parallelProviderCount: providerResults.length,
            acceptedEstimate: input.estimate,
        });
    return {
        runId,
        providerResults,
        receipt,
    };
}
function withProviderScope(result, provider, enclosingParallelProviderCount) {
    return {
        ...result,
        receipt: {
            ...result.receipt,
            run: {
                ...result.receipt.run,
                providerId: provider,
            },
            providerScope: {
                provider,
                selectedProviders: [provider],
                parallelProviderCount: enclosingParallelProviderCount,
                localContentionPossible: enclosingParallelProviderCount > 1,
            },
        },
    };
}
function estimateForProvider(input, provider) {
    const selectedModels = input.estimate.selectedModels.filter((model) => model.provider === provider);
    const estimatedUsd = input.estimate.estimatedUsdByModel
        .filter((model) => model.provider === provider)
        .reduce((total, model) => total + model.estimatedUsd, 0);
    const ratio = input.estimate.estimatedUsd > 0 ? estimatedUsd / input.estimate.estimatedUsd : 1;
    const spendCapUsd = Math.max(0.000001, roundUsd(input.estimate.spendCapUsd * ratio));
    return estimateCoverageSuite({
        selectedModels,
        suite: input.suite,
        baseline: input.baseline,
        generator: input.estimate.generator,
        spendCapUsd,
        eventTime: new Date().toISOString(),
    });
}
async function resolveAgentExecutable(input) {
    if (input.agentCommand) {
        return {
            executablePath: input.agentCommand,
            source: "user-supplied",
        };
    }
    const plan = planAgentProvisioning({ benchHome: input.benchHome });
    if (!input.agentInstallConsentHash) {
        throw new Error(`Agent install consent hash is required. Expected ${plan.consentHash}.`);
    }
    if (input.agentInstallConsentHash !== plan.consentHash) {
        throw new Error(`Accepted agent install hash does not match the current install plan. Expected ${plan.consentHash}.`);
    }
    let installed;
    try {
        installed = await (input.agentProvisioner ?? ((nextPlan) => provisionAgent({ plan: nextPlan })))(plan);
    }
    catch (error) {
        if (error instanceof AgentProvisioningFailureError)
            throw error;
        const packageSpec = plan.packages[0];
        throw new AgentProvisioningFailureError({
            agentName: plan.agent.name,
            agentVersion: plan.agent.version,
            packageName: packageSpec.name,
            packageVersion: packageSpec.version,
            tarballUrl: packageSpec.tarballUrl,
            platform: `${plan.platform}-${plan.arch}${plan.libc ? `-${plan.libc}` : ""}`,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
    return {
        executablePath: installed.executablePath,
        source: "auto-provisioned",
        version: plan.agent.version,
    };
}
function uniqueProviders(providers) {
    return [...new Set(providers)];
}
//# sourceMappingURL=provider-parallel-runner.js.map