import { randomUUID } from "node:crypto";
import { registerOutputSchema } from "@inferock/measure/output-schemas";
export class BenchRequestAnnotationRegistry {
    annotations = new Map();
    register(requestId, annotation) {
        const normalizedRequestId = requestId.trim();
        if (!normalizedRequestId)
            throw new Error("Bench request annotation requires a request ID.");
        if (this.annotations.has(normalizedRequestId)) {
            throw new Error(`Bench request annotation already exists for request ID ${normalizedRequestId}.`);
        }
        this.annotations.set(normalizedRequestId, annotation);
    }
    annotationForRequest(requestId) {
        return this.annotations.get(requestId);
    }
}
export function registerCoverageSuiteOutputSchemas(manifest, input) {
    const tenantId = input.tenantId.trim();
    if (!tenantId)
        throw new Error("Coverage suite output-schema registration requires a tenant ID.");
    const registered = [];
    for (const task of manifest.tasks) {
        if (!task.outputSchemaVersion || !task.outputSchema)
            continue;
        registerOutputSchema({
            tenantId,
            schemaVersion: task.outputSchemaVersion,
            schema: task.outputSchema,
        });
        registered.push({
            tenantId,
            taskId: task.taskId,
            schemaVersion: task.outputSchemaVersion,
        });
    }
    return registered;
}
export function registerCoverageSuiteTaskRequestAnnotations(registry, input) {
    const task = input.manifest.tasks.find((entry) => entry.taskId === input.taskId);
    if (!task)
        throw new Error(`Coverage suite task ${input.taskId} was not found.`);
    const runId = input.runId.trim();
    if (!runId)
        throw new Error("Coverage suite task annotation requires a run ID.");
    const requestId = input.requestId?.trim() || randomUUID();
    const annotation = taskAnnotation(runId, task);
    registry.register(requestId, annotation);
    const headers = {
        "x-inferock-request-id": requestId,
    };
    if (task.operationIdRequired) {
        headers["x-inferock-operation-id"] = coverageSuiteOperationId(runId, task.taskId);
    }
    return { requestId, headers, annotation };
}
function taskAnnotation(runId, task) {
    const outputSchemaVersion = task.outputSchemaVersion;
    const factualityContract = factualityContractAnnotation(task);
    return {
        runId,
        suiteTaskId: task.taskId,
        ...(outputSchemaVersion ? { outputSchemaVersion } : {}),
        ...(factualityContract ? { factualityContract } : {}),
    };
}
function factualityContractAnnotation(task) {
    const contract = task.factualityContract;
    if (!contract)
        return undefined;
    return {
        contractId: contract.contractId,
        mode: contract.mode,
        expectedAnswer: contract.expectedAnswer,
        matchType: contract.matchType,
        authoritative: contract.authoritative,
        ...(contract.aliases ? { aliases: [...contract.aliases] } : {}),
        ...(contract.numericTolerance !== undefined ? { numericTolerance: contract.numericTolerance } : {}),
        ...(contract.sensitive !== undefined ? { sensitive: contract.sensitive } : {}),
    };
}
function coverageSuiteOperationId(runId, taskId) {
    return `coverage-suite-v1:${runId}:${taskId}:${randomUUID()}`;
}
//# sourceMappingURL=runner-annotations.js.map