import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  type: string;
  message?: string;
}

export interface StepExecutionContext {
  readonly workflow: WorkflowDefinition;
  readonly step: WorkflowStep;
  readonly runId: string;
  readonly log: (message: string) => void;
}

export interface StepExecutionResult {
  output?: Record<string, unknown>;
}

export type StepHandler = (
  context: StepExecutionContext
) => Promise<StepExecutionResult | void>;

export interface StepDefinition {
  readonly type: string;
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
  logs: RunLogEntry[];
}

interface FileSystem {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
}

export interface RunWorkflowFileOptions {
  workflowFilePath: string;
  runDirectory?: string;
  stdout?: Pick<Console, "log">;
  now?: () => Date;
  registry?: StepRegistry;
  fileSystem?: FileSystem;
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

export const builtInStepRegistry: StepRegistry = new Map([
  [coreLogStep.type, coreLogStep]
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
  const workflowFilePath = path.resolve(options.workflowFilePath);
  const startedAt = now().toISOString();
  const rawWorkflow = await fileSystem.readFile(workflowFilePath, "utf8");
  const workflow = parseWorkflowDefinition(rawWorkflow);
  const runId = createRunId(now());
  const runDirectory =
    options.runDirectory !== undefined
      ? path.resolve(options.runDirectory)
      : path.join(path.dirname(workflowFilePath), ".talby-runs", runId);

  await fileSystem.mkdir(runDirectory, { recursive: true });

  const logs: RunLogEntry[] = [];
  const steps: WorkflowRunRecord["steps"] = [];

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

      const result = await definition.execute({
        workflow,
        step,
        runId,
        log(message) {
          stdout.log(message);
          appendLog(message, "info", step.id);
        }
      });

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
    logs
  };
  const logFilePath = path.join(runDirectory, "run-log.json");

  await fileSystem.writeFile(
    logFilePath,
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );

  if (status === "failed") {
    throw new Error(`Workflow failed. Inspect ${logFilePath} for details.`);
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

  const message = step.message;

  if (message !== undefined && typeof message !== "string") {
    throw new Error(`Workflow step ${id} has an invalid message.`);
  }

  return message === undefined
    ? {
        id,
        type
      }
    : {
        id,
        type,
        message
      };
}

function createRunId(now: Date): string {
  return now.toISOString().replace(/[.:]/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
