#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeCore, runWorkflowFile } from "@talby/core";

export function formatWelcome(): string {
  return `talby-wf cli ready (${describeCore()})`;
}

export interface CliDependencies {
  stdout: Pick<Console, "log">;
  stderr: Pick<Console, "error">;
}

export async function main(
  args: string[] = process.argv.slice(2),
  dependencies: CliDependencies = { stdout: console, stderr: console }
): Promise<number> {
  const command = args[0];

  if (!command || command === "help" || command === "--help") {
    dependencies.stdout.log(formatWelcome());
    dependencies.stdout.log(
      "Usage: twf run <workflow.yaml> [--run-dir <path>]"
    );
    return 0;
  }

  if (command !== "run") {
    dependencies.stderr.error(`Unknown command: ${command}`);
    return 1;
  }

  const workflowFilePath = args[1];

  if (!workflowFilePath) {
    dependencies.stderr.error("Missing workflow file path.");
    return 1;
  }

  const runDirectory = readRunDirectory(args.slice(2));

  try {
    const result = await runWorkflowFile(
      runDirectory === undefined
        ? {
            workflowFilePath,
            stdout: dependencies.stdout
          }
        : {
            workflowFilePath,
            runDirectory,
            stdout: dependencies.stdout
          }
    );

    dependencies.stdout.log(`Run log: ${result.logFilePath}`);
    return 0;
  } catch (error) {
    dependencies.stderr.error(
      error instanceof Error ? error.message : String(error)
    );
    return 1;
  }
}

function readRunDirectory(args: string[]): string | undefined {
  const runDirFlagIndex = args.indexOf("--run-dir");

  if (runDirFlagIndex === -1) {
    return undefined;
  }

  return args[runDirFlagIndex + 1];
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
