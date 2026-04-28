import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  builtInStepRegistry,
  createStepRegistry,
  describeCore,
  parseWorkflowDefinition,
  runWorkflowFile,
  type StepDefinition
} from "./index";

describe("core package", () => {
  it("describes the runtime", () => {
    expect(describeCore()).toBe("workflow runtime ready (1 built-in step)");
  });

  it("parses a simple workflow", () => {
    expect(
      parseWorkflowDefinition(
        `name: demo\nsteps:\n  - id: hello\n    type: core.log\n    message: hi\n`
      )
    ).toEqual({
      name: "demo",
      steps: [
        {
          id: "hello",
          type: "core.log",
          message: "hi"
        }
      ]
    });
  });

  it("fails fast, writes inspectable logs, and stops on step failure", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "talby-core-"));
    const workflowFilePath = path.join(tempRoot, "workflow.yaml");
    const runDirectory = path.join(tempRoot, "run");
    const failingStep: StepDefinition = {
      type: "core.fail",
      async execute() {
        throw new Error("boom");
      }
    };

    await writeFile(
      workflowFilePath,
      [
        "name: failing-demo",
        "steps:",
        "  - id: first",
        "    type: core.log",
        "    message: before failure",
        "  - id: second",
        "    type: core.fail",
        "  - id: third",
        "    type: core.log",
        "    message: should not run",
        ""
      ].join("\n"),
      "utf8"
    );

    await expect(
      runWorkflowFile({
        workflowFilePath,
        runDirectory,
        stdout: { log() {} },
        registry: createStepRegistry([
          ...builtInStepRegistry.values(),
          failingStep
        ])
      })
    ).rejects.toThrow(
      `Workflow failed. Inspect ${path.join(runDirectory, "run-log.json")} for details.`
    );

    const record = JSON.parse(
      await readFile(path.join(runDirectory, "run-log.json"), "utf8")
    );

    expect(record.status).toBe("failed");
    expect(record.steps).toEqual([
      {
        id: "first",
        type: "core.log",
        status: "succeeded",
        output: {
          message: "before failure"
        }
      },
      {
        id: "second",
        type: "core.fail",
        status: "failed",
        error: "boom"
      }
    ]);
    expect(
      record.logs.some((entry: { message: string }) =>
        entry.message.includes("should not run")
      )
    ).toBe(false);
  });
});
