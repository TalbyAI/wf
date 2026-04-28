import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { parse } from "yaml";

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
}

export interface RetryPolicy {
  attempts: number;
}

export interface WorkflowStep {
  id: string;
  type: string;
  retry: RetryPolicy;
  message?: string;
  prompt?: string;
  promptFile?: string;
  content?: string;
  path?: string;
}

export interface PromptRequest {
  workflowName: string;
  stepId: string;
  runId: string;
  attempt: number;
  prompt: string;
}

export interface PromptBackend {
  generate(request: PromptRequest): Promise<string>;
}

export interface StepExecutionContext {
  readonly workflow: WorkflowDefinition;
  readonly step: WorkflowStep;
  readonly workflowFilePath: string;
  readonly runDirectory: string;
  readonly inputs: Record<string, unknown>;
  readonly stepOutputs: Record<string, Record<string, unknown>>;
  readonly runId: string;
  readonly attempt: number;
  readonly fileSystem: Pick<FileSystem, "mkdir" | "readFile" | "writeFile">;
  readonly promptBackend: PromptBackend | undefined;
  readonly log: (message: string) => void;
  readonly recordArtifact: (artifact: WorkflowArtifactRecord) => void;
}

export interface StepExecutionResult {
  output?: Record<string, unknown>;
}

export type StepHandler = (
  context: StepExecutionContext
) => Promise<StepExecutionResult | void>;

export interface StepDefinition {
  readonly type: string;
  readonly validate?: (step: WorkflowStep) => void;
  readonly execute: StepHandler;
}

export type StepRegistry = Map<string, StepDefinition>;

export interface RunLogEntry {
  timestamp: string;
  level: "info" | "error";
  stepId?: string;
  message: string;
}

export interface WorkflowRunRecord {
  runId: string;
  workflowName: string;
  status: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  workflowFilePath: string;
  runDirectory: string;
  steps: Array<{
    id: string;
    type: string;
    status: "succeeded" | "failed";
    output?: Record<string, unknown>;
    error?: string;
  }>;
  artifacts: WorkflowArtifactRecord[];
  logs: RunLogEntry[];
}

export interface WorkflowArtifactRecord {
  stepId: string;
  path: string;
  bytes: number;
}

interface FileSystem {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
}

export interface RunWorkflowFileOptions {
  workflowFilePath: string;
  runDirectory?: string;
  inputs?: Record<string, unknown>;
  stdout?: Pick<Console, "log">;
  now?: () => Date;
  registry?: StepRegistry;
  fileSystem?: FileSystem;
  promptBackend?: PromptBackend | undefined;
}

export interface RunWorkflowFileResult {
  workflow: WorkflowDefinition;
  record: WorkflowRunRecord;
  logFilePath: string;
}

const defaultFileSystem: FileSystem = {
  mkdir,
  readFile,
  writeFile
};

const coreLogStep: StepDefinition = {
  type: "core.log",
  validate(step) {
    if (typeof step.message !== "string" || step.message.length === 0) {
      throw new Error(`Workflow step ${step.id} is missing a message.`);
    }
  },
  async execute(context) {
    const message = context.step.message;

    if (!message) {
      throw new Error(`Step "${context.step.id}" is missing a message.`);
    }

    context.log(message);

    return {
      output: {
        message
      }
    };
  }
};

const corePromptStep: StepDefinition = {
  type: "core.prompt",
  validate(step) {
    const hasInlinePrompt =
      typeof step.prompt === "string" && step.prompt.length > 0;
    const hasPromptFile =
      typeof step.promptFile === "string" && step.promptFile.length > 0;

    if (!hasInlinePrompt && !hasPromptFile) {
      throw new Error(
        `Workflow step ${step.id} must define either a prompt or promptFile.`
      );
    }

    if (hasInlinePrompt && hasPromptFile) {
      throw new Error(
        `Workflow step ${step.id} cannot define both prompt and promptFile.`
      );
    }
  },
  async execute(context) {
    if (!context.promptBackend) {
      throw new Error(
        `Step "${context.step.id}" requires a prompt backend, but none was configured.`
      );
    }

    const prompt = await readPromptText(context);
    const answer = await context.promptBackend.generate({
      workflowName: context.workflow.name,
      stepId: context.step.id,
      runId: context.runId,
      attempt: context.attempt,
      prompt
    });

    return {
      output: {
        answer
      }
    };
  }
};

const coreWriteFileStep: StepDefinition = {
  type: "core.write-file",
  validate(step) {
    if (typeof step.path !== "string" || step.path.length === 0) {
      throw new Error(`Workflow step ${step.id} is missing a path.`);
    }

    if (typeof step.content !== "string" || step.content.length === 0) {
      throw new Error(`Workflow step ${step.id} is missing content.`);
    }
  },
  async execute(context) {
    const targetPath = context.step.path;
    const content = context.step.content;

    if (!targetPath) {
      throw new Error(`Step "${context.step.id}" is missing a path.`);
    }

    if (!content) {
      throw new Error(`Step "${context.step.id}" is missing content.`);
    }

    const resolvedPath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(context.runDirectory, targetPath);

    await context.fileSystem.mkdir(path.dirname(resolvedPath), {
      recursive: true
    });
    await context.fileSystem.writeFile(resolvedPath, content, "utf8");

    const artifact = {
      stepId: context.step.id,
      path: resolvedPath,
      bytes: Buffer.byteLength(content, "utf8")
    };

    context.recordArtifact(artifact);

    return {
      output: {
        path: resolvedPath,
        bytes: artifact.bytes
      }
    };
  }
};

export const builtInStepRegistry: StepRegistry = new Map([
  [coreLogStep.type, coreLogStep],
  [corePromptStep.type, corePromptStep],
  [coreWriteFileStep.type, coreWriteFileStep]
]);

export function createStepRegistry(
  stepDefinitions: Iterable<StepDefinition> = builtInStepRegistry.values()
): StepRegistry {
  return new Map(
    Array.from(stepDefinitions, (definition) => [definition.type, definition])
  );
}

export function describeCore(): string {
  return `workflow runtime ready (${builtInStepRegistry.size} built-in step)`;
}

export async function runWorkflowFile(
  options: RunWorkflowFileOptions
): Promise<RunWorkflowFileResult> {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const stdout = options.stdout ?? console;
  const now = options.now ?? (() => new Date());
  const registry = options.registry ?? createStepRegistry();
  const promptBackend = options.promptBackend;
  const workflowFilePath = path.resolve(options.workflowFilePath);
  const inputs = options.inputs ?? {};
  const startedAt = now().toISOString();
  const rawWorkflow = await fileSystem.readFile(workflowFilePath, "utf8");
  const workflow = validateWorkflowDefinition(
    parseWorkflowDefinition(rawWorkflow),
    {
      registry,
      inputs
    }
  );
  const runId = createRunId(now());
  const runDirectory =
    options.runDirectory === undefined
      ? path.join(path.dirname(workflowFilePath), ".talby-runs", runId)
      : path.resolve(options.runDirectory);

  await fileSystem.mkdir(runDirectory, { recursive: true });

  const logs: RunLogEntry[] = [];
  const steps: WorkflowRunRecord["steps"] = [];
  const artifacts: WorkflowRunRecord["artifacts"] = [];
  const stepOutputs: Record<string, Record<string, unknown>> = {};

  const appendLog = (
    message: string,
    level: RunLogEntry["level"],
    stepId?: string
  ): void => {
    logs.push(
      stepId === undefined
        ? {
            timestamp: now().toISOString(),
            level,
            message
          }
        : {
            timestamp: now().toISOString(),
            level,
            stepId,
            message
          }
    );
  };

  appendLog(`Starting workflow ${workflow.name}.`, "info");

  let status: WorkflowRunRecord["status"] = "succeeded";

  try {
    for (const step of workflow.steps) {
      const definition = registry.get(step.type);

      if (!definition) {
        throw new Error(`No step registered for type "${step.type}".`);
      }

      appendLog(`Running step ${step.id} (${step.type}).`, "info", step.id);

      const resolvedStep = resolveWorkflowStep(step, {
        inputs,
        stepOutputs
      });

      const result = await executeStepWithRetry({
        definition,
        workflow,
        step: resolvedStep,
        workflowFilePath,
        runDirectory,
        inputs,
        stepOutputs,
        runId,
        stdout,
        fileSystem,
        promptBackend,
        artifacts,
        appendLog
      });

      if (result?.output !== undefined) {
        stepOutputs[step.id] = result.output;
      }

      steps.push(
        result?.output === undefined
          ? {
              id: step.id,
              type: step.type,
              status: "succeeded"
            }
          : {
              id: step.id,
              type: step.type,
              status: "succeeded",
              output: result.output
            }
      );

      appendLog(`Finished step ${step.id}.`, "info", step.id);
    }
  } catch (error) {
    status = "failed";

    const message = error instanceof Error ? error.message : String(error);
    const currentStep = workflow.steps[steps.length];

    steps.push({
      id: currentStep?.id ?? "unknown",
      type: currentStep?.type ?? "unknown",
      status: "failed",
      error: message
    });

    appendLog(message, "error", currentStep?.id);
  }

  appendLog(
    status === "succeeded"
      ? `Workflow ${workflow.name} completed successfully.`
      : `Workflow ${workflow.name} failed.`,
    status === "succeeded" ? "info" : "error"
  );

  const record: WorkflowRunRecord = {
    runId,
    workflowName: workflow.name,
    status,
    startedAt,
    finishedAt: now().toISOString(),
    workflowFilePath,
    runDirectory,
    steps,
    artifacts,
    logs
  };
  const logFilePath = path.join(runDirectory, "run-log.json");

  await fileSystem.writeFile(
    logFilePath,
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );

  if (status === "failed") {
    const failure = steps.findLast((step) => step.status === "failed");
    const reason = failure?.error ?? "Unknown workflow error.";

    throw new Error(
      `Workflow failed: ${reason} Inspect ${logFilePath} for details.`
    );
  }

  return {
    workflow,
    record,
    logFilePath
  };
}

export function parseWorkflowDefinition(source: string): WorkflowDefinition {
  const parsed = parse(source);

  if (!isRecord(parsed)) {
    throw new Error("Workflow file must be a YAML object.");
  }

  const name = parsed.name;
  const steps = parsed.steps;

  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Workflow name is required.");
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("Workflow steps are required.");
  }

  return {
    name,
    steps: steps.map((step, index) => parseWorkflowStep(step, index))
  };
}

export interface WorkflowValidationOptions {
  registry?: StepRegistry;
  inputs?: Record<string, unknown>;
}

export function validateWorkflowDefinition(
  workflow: WorkflowDefinition,
  options: WorkflowValidationOptions = {}
): WorkflowDefinition {
  const registry = options.registry ?? builtInStepRegistry;
  const inputs = options.inputs ?? {};
  const seenStepIds = new Set<string>();

  return {
    name: workflow.name,
    steps: workflow.steps.map((step) => {
      if (seenStepIds.has(step.id)) {
        throw new Error(
          `Workflow step ids must be unique. Duplicate id "${step.id}".`
        );
      }

      seenStepIds.add(step.id);

      const definition = registry.get(step.type);

      if (!definition) {
        throw new Error(`No step registered for type "${step.type}".`);
      }

      validateStepReferences(step, {
        inputs,
        priorStepIds: seenStepIds
      });

      const normalizedStep: WorkflowStep = {
        ...step,
        retry: normalizeRetryPolicy(step.retry)
      };

      definition.validate?.(normalizedStep);

      return normalizedStep;
    })
  };
}

export function resolveTemplate(
  template: string,
  context: {
    inputs: Record<string, unknown>;
    stepOutputs: Record<string, Record<string, unknown>>;
  }
): string {
  return template.replaceAll(/\$\{([^}]+)\}/g, (_match, expression: string) => {
    const value = resolveReference(expression.trim(), context);

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return JSON.stringify(value);
  });
}

function parseWorkflowStep(step: unknown, index: number): WorkflowStep {
  if (!isRecord(step)) {
    throw new Error(`Workflow step ${index + 1} must be an object.`);
  }

  const id = step.id;
  const type = step.type;

  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`Workflow step ${index + 1} is missing an id.`);
  }

  if (typeof type !== "string" || type.length === 0) {
    throw new Error(`Workflow step ${id} is missing a type.`);
  }

  const message = readOptionalStepString(step, id, "message");
  const prompt = readOptionalStepString(step, id, "prompt");
  const promptFile = readOptionalStepString(step, id, "promptFile");
  const content = readOptionalStepString(step, id, "content");
  const stepPath = readOptionalStepString(step, id, "path");

  return {
    id,
    type,
    retry: parseRetryPolicy(step.retry, id),
    ...(message === undefined ? {} : { message }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(promptFile === undefined ? {} : { promptFile }),
    ...(content === undefined ? {} : { content }),
    ...(stepPath === undefined ? {} : { path: stepPath })
  };
}

function readOptionalStepString(
  step: Record<string, unknown>,
  stepId: string,
  fieldName: "message" | "prompt" | "promptFile" | "content" | "path"
): string | undefined {
  const value = step[fieldName];

  if (value !== undefined && typeof value !== "string") {
    throw new Error(`Workflow step ${stepId} has an invalid ${fieldName}.`);
  }

  return value;
}

function parseRetryPolicy(value: unknown, stepId: string): RetryPolicy {
  if (value === undefined) {
    return { attempts: 1 };
  }

  if (!isRecord(value)) {
    throw new Error(`Workflow step ${stepId} has an invalid retry policy.`);
  }

  const attempts = value.attempts;

  if (
    attempts !== undefined &&
    (typeof attempts !== "number" ||
      !Number.isInteger(attempts) ||
      attempts < 1)
  ) {
    throw new Error(
      `Workflow step ${stepId} has an invalid retry attempt count.`
    );
  }

  return {
    attempts: typeof attempts === "number" ? attempts : 1
  };
}

function normalizeRetryPolicy(retry: RetryPolicy | undefined): RetryPolicy {
  return {
    attempts: retry?.attempts ?? 1
  };
}

function validateStepReferences(
  step: WorkflowStep,
  context: {
    inputs: Record<string, unknown>;
    priorStepIds: ReadonlySet<string>;
  }
): void {
  for (const expression of collectReferences(step)) {
    validateReference(expression, step.id, context);
  }
}

function collectReferences(value: unknown): string[] {
  if (typeof value === "string") {
    return Array.from(value.matchAll(/\$\{([^}]+)\}/g), (match) => {
      const expression = match[1];

      return expression === undefined ? "" : expression.trim();
    }).filter((expression) => expression.length > 0);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReferences(item));
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key]) => key !== "id" && key !== "type" && key !== "retry")
      .flatMap(([, nestedValue]) => collectReferences(nestedValue));
  }

  return [];
}

function validateReference(
  expression: string,
  stepId: string,
  context: {
    inputs: Record<string, unknown>;
    priorStepIds: ReadonlySet<string>;
  }
): void {
  const segments = expression.split(".");

  if (segments[0] === "inputs") {
    if (segments.length < 2) {
      throw new Error(
        `Workflow step ${stepId} has an invalid reference "${expression}".`
      );
    }

    if (!hasPath(context.inputs, segments.slice(1))) {
      throw new Error(
        `Workflow step ${stepId} references missing input "${expression}".`
      );
    }

    return;
  }

  if (segments[0] === "steps") {
    if (segments.length < 4 || segments[2] !== "output") {
      throw new Error(
        `Workflow step ${stepId} has an invalid reference "${expression}".`
      );
    }

    const referencedStepId = segments[1];

    if (
      referencedStepId === undefined ||
      !context.priorStepIds.has(referencedStepId)
    ) {
      throw new Error(
        `Workflow step ${stepId} references step "${referencedStepId ?? "unknown"}" before it is available.`
      );
    }

    return;
  }

  throw new Error(
    `Workflow step ${stepId} has an invalid reference "${expression}".`
  );
}

function resolveWorkflowStep(
  step: WorkflowStep,
  context: {
    inputs: Record<string, unknown>;
    stepOutputs: Record<string, Record<string, unknown>>;
  }
): WorkflowStep {
  return resolveValue(step, context) as WorkflowStep;
}

function resolveValue(
  value: unknown,
  context: {
    inputs: Record<string, unknown>;
    stepOutputs: Record<string, Record<string, unknown>>;
  }
): unknown {
  if (typeof value === "string") {
    return resolveTemplate(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, context));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        if (key === "id" || key === "type" || key === "retry") {
          return [key, nestedValue];
        }

        return [key, resolveValue(nestedValue, context)];
      })
    );
  }

  return value;
}

async function executeStepWithRetry(options: {
  definition: StepDefinition;
  workflow: WorkflowDefinition;
  step: WorkflowStep;
  workflowFilePath: string;
  runDirectory: string;
  inputs: Record<string, unknown>;
  stepOutputs: Record<string, Record<string, unknown>>;
  runId: string;
  stdout: Pick<Console, "log">;
  fileSystem: Pick<FileSystem, "mkdir" | "readFile" | "writeFile">;
  promptBackend: PromptBackend | undefined;
  artifacts: WorkflowArtifactRecord[];
  appendLog: (
    message: string,
    level: RunLogEntry["level"],
    stepId?: string
  ) => void;
}): Promise<StepExecutionResult | void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.step.retry.attempts; attempt += 1) {
    try {
      return await options.definition.execute({
        workflow: options.workflow,
        step: options.step,
        workflowFilePath: options.workflowFilePath,
        runDirectory: options.runDirectory,
        inputs: options.inputs,
        stepOutputs: options.stepOutputs,
        runId: options.runId,
        attempt,
        fileSystem: options.fileSystem,
        promptBackend: options.promptBackend,
        log(message) {
          options.stdout.log(message);
          options.appendLog(message, "info", options.step.id);
        },
        recordArtifact(artifact) {
          options.artifacts.push(artifact);
        }
      });
    } catch (error) {
      lastError = error;

      if (attempt >= options.step.retry.attempts) {
        break;
      }

      options.appendLog(
        `Retrying step ${options.step.id} (${attempt + 1}/${options.step.retry.attempts}).`,
        "info",
        options.step.id
      );
    }
  }

  throw lastError;
}

function resolveReference(
  expression: string,
  context: {
    inputs: Record<string, unknown>;
    stepOutputs: Record<string, Record<string, unknown>>;
  }
): unknown {
  const segments = expression.split(".");

  if (segments[0] === "inputs") {
    return readPath(context.inputs, segments.slice(1));
  }

  if (segments[0] === "steps" && segments[2] === "output") {
    const stepId = segments[1];

    if (stepId === undefined) {
      throw new Error(`Invalid reference "${expression}".`);
    }

    return readPath(context.stepOutputs[stepId], segments.slice(3));
  }

  throw new Error(`Invalid reference "${expression}".`);
}

function hasPath(value: unknown, segments: string[]): boolean {
  let current = value;

  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return false;
    }

    current = current[segment];
  }

  return true;
}

function readPath(value: unknown, segments: string[]): unknown {
  let current = value;

  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      throw new Error(`Missing value for reference segment "${segment}".`);
    }

    current = current[segment];
  }

  return current;
}

function createRunId(now: Date): string {
  return now.toISOString().replaceAll(/[.:]/g, "-");
}

async function readPromptText(context: StepExecutionContext): Promise<string> {
  if (context.step.prompt) {
    return context.step.prompt;
  }

  const promptFile = context.step.promptFile;

  if (!promptFile) {
    throw new Error(`Step "${context.step.id}" is missing prompt content.`);
  }

  const promptFilePath = path.resolve(
    path.dirname(context.workflowFilePath),
    promptFile
  );
  const promptTemplate = await context.fileSystem.readFile(
    promptFilePath,
    "utf8"
  );

  return resolveTemplate(promptTemplate, {
    inputs: context.inputs,
    stepOutputs: context.stepOutputs
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
