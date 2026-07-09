import { randomUUID } from "node:crypto";
import { registerOutputSchema } from "@inferock/measure/output-schemas";
import type { JsonRecord } from "../record.js";
import type {
  CoverageSuiteManifestV1,
  CoverageSuiteTask,
  LoadedCoverageSuiteManifest,
} from "./manifest.js";

export interface BenchRequestAnnotation {
  readonly runId?: string;
  readonly suiteTaskId?: string;
  readonly workloadClass?: string;
  readonly outputSchemaVersion?: string;
  readonly factualityContract?: JsonRecord;
  readonly driftCanaryProtocolVersion?: string;
}

export interface BenchRequestAnnotationSource {
  annotationForRequest(requestId: string): BenchRequestAnnotation | undefined;
}

export interface RegisteredCoverageOutputSchema {
  readonly tenantId: string;
  readonly taskId: string;
  readonly schemaVersion: string;
}

export interface SuiteTaskRequestAnnotations {
  readonly requestId: string;
  readonly headers: Record<string, string>;
  readonly annotation: BenchRequestAnnotation;
}

export class BenchRequestAnnotationRegistry implements BenchRequestAnnotationSource {
  private readonly annotations = new Map<string, BenchRequestAnnotation>();

  register(requestId: string, annotation: BenchRequestAnnotation): void {
    const normalizedRequestId = requestId.trim();
    if (!normalizedRequestId) throw new Error("Bench request annotation requires a request ID.");
    if (this.annotations.has(normalizedRequestId)) {
      throw new Error(`Bench request annotation already exists for request ID ${normalizedRequestId}.`);
    }
    this.annotations.set(normalizedRequestId, annotation);
  }

  annotationForRequest(requestId: string): BenchRequestAnnotation | undefined {
    return this.annotations.get(requestId);
  }
}

export function registerCoverageSuiteOutputSchemas(
  manifest: CoverageSuiteManifestV1 | LoadedCoverageSuiteManifest,
  input: { readonly tenantId: string },
): RegisteredCoverageOutputSchema[] {
  const tenantId = input.tenantId.trim();
  if (!tenantId) throw new Error("Coverage suite output-schema registration requires a tenant ID.");

  const registered: RegisteredCoverageOutputSchema[] = [];
  for (const task of manifest.tasks) {
    if (!task.outputSchemaVersion || !task.outputSchema) continue;
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

export function registerCoverageSuiteTaskRequestAnnotations(
  registry: BenchRequestAnnotationRegistry,
  input: {
    readonly manifest: CoverageSuiteManifestV1 | LoadedCoverageSuiteManifest;
    readonly runId: string;
    readonly taskId: string;
    readonly requestId?: string;
  },
): SuiteTaskRequestAnnotations {
  const task = input.manifest.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) throw new Error(`Coverage suite task ${input.taskId} was not found.`);
  const runId = input.runId.trim();
  if (!runId) throw new Error("Coverage suite task annotation requires a run ID.");

  const requestId = input.requestId?.trim() || randomUUID();
  const annotation = taskAnnotation(runId, task);
  registry.register(requestId, annotation);

  const headers: Record<string, string> = {
    "x-inferock-request-id": requestId,
  };
  if (task.operationIdRequired) {
    headers["x-inferock-operation-id"] = coverageSuiteOperationId(runId, task.taskId);
  }

  return { requestId, headers, annotation };
}

function taskAnnotation(runId: string, task: CoverageSuiteTask): BenchRequestAnnotation {
  const outputSchemaVersion = task.outputSchemaVersion;
  const factualityContract = factualityContractAnnotation(task);
  return {
    runId,
    suiteTaskId: task.taskId,
    ...(outputSchemaVersion ? { outputSchemaVersion } : {}),
    ...(factualityContract ? { factualityContract } : {}),
  };
}

function factualityContractAnnotation(task: CoverageSuiteTask): JsonRecord | undefined {
  const contract = task.factualityContract;
  if (!contract) return undefined;
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

function coverageSuiteOperationId(runId: string, taskId: string): string {
  return `coverage-suite-v1:${runId}:${taskId}:${randomUUID()}`;
}
