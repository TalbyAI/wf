import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  builtInStepRegistry,
  createStepRegistry,
  describeCore,
  parseWorkflowDefinition,
  runWorkflowFile,
  validateWorkflowDefinition,
  resolveTemplate,
  type StepDefinition
} from "./index";

describe("core package", () => {
  it("describes the runtime", () => {
    expect(describeCore()).toBe("workflow runtime ready (3 built-in step)");
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
          retry: {
            attempts: 1
          },
          message: "hi"
        }
      ]
    });
  });

  it("validates prompt steps require exactly one prompt source", () => {
    expect(() =>
      validateWorkflowDefinition(
        parseWorkflowDefinition(
          [
            "name: missing-prompt-source",
            "steps:",
            "  - id: ask",
            "    type: core.prompt",
            ""
          ].join("\n")
        )
      )
    ).toThrow("Workflow step ask must define either a prompt or promptFile.");

    expect(() =>
      validateWorkflowDefinition(
        parseWorkflowDefinition(
          [
            "name: duplicate-prompt-source",
            "steps:",
            "  - id: ask",
            "    type: core.prompt",
            "    prompt: inline",
            "    promptFile: ./prompt.txt",
            ""
          ].join("\n")
        )
      )
    ).toThrow("Workflow step ask cannot define both prompt and promptFile.");
  });

  it("validates duplicate ids, missing inputs, and invalid step references before execution", () => {
    expect(() =>
      validateWorkflowDefinition(
        parseWorkflowDefinition(
          [
            "name: duplicate-ids",
            "steps:",
            "  - id: repeat",
            "    type: core.log",
            "    message: first",
            "  - id: repeat",
            "    type: core.log",
            "    message: second",
            ""
          ].join("\n")
        )
      )
    ).toThrow('Workflow step ids must be unique. Duplicate id "repeat".');

    expect(() =>
      validateWorkflowDefinition(
        parseWorkflowDefinition(
          [
            "name: missing-input",
            "steps:",
            "  - id: announce",
            "    type: core.log",
            "    message: Hello ${inputs.idea}",
            ""
          ].join("\n")
        )
      )
    ).toThrow('Workflow step announce references missing input "inputs.idea".');

    expect(() =>
      validateWorkflowDefinition(
        parseWorkflowDefinition(
          [
            "name: missing-step-output",
            "steps:",
            "  - id: announce",
            "    type: core.log",
            "    message: ${steps.missing.output.answer}",
            ""
          ].join("\n")
        ),
        {
          inputs: {}
        }
      )
    ).toThrow(
      'Workflow step announce references step "missing" before it is available.'
    );
  });

  it("applies retry defaults during validation", () => {
    expect(
      validateWorkflowDefinition(
        parseWorkflowDefinition(
          [
            "name: retry-demo",
            "steps:",
            "  - id: default-retry",
            "    type: core.log",
            "    message: once",
            "  - id: explicit-retry",
            "    type: core.log",
            "    message: twice",
            "    retry:",
            "      attempts: 2",
            ""
          ].join("\n")
        )
      )
    ).toEqual({
      name: "retry-demo",
      steps: [
        {
          id: "default-retry",
          type: "core.log",
          retry: {
            attempts: 1
          },
          message: "once"
        },
        {
          id: "explicit-retry",
          type: "core.log",
          retry: {
            attempts: 2
          },
          message: "twice"
        }
      ]
    });
  });

  it("resolves templates from inputs and prior step outputs", () => {
    expect(
      resolveTemplate(
        "Idea: ${inputs.idea} / Draft: ${steps.generate.output.answer}",
        {
          inputs: {
            idea: "workflow runner"
          },
          stepOutputs: {
            generate: {
              answer: "draft ready"
            }
          }
        }
      )
    ).toBe("Idea: workflow runner / Draft: draft ready");
  });

  it("retries a step using the validated retry policy", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "talby-core-retry-"));
    const workflowFilePath = path.join(tempRoot, "workflow.yaml");
    const runDirectory = path.join(tempRoot, "run");
    let attempts = 0;
    const flakyStep: StepDefinition = {
      type: "core.flaky",
      async execute(context) {
        attempts = context.attempt;

        if (context.attempt < 2) {
          throw new Error("try again");
        }

        context.log(`attempt ${context.attempt}`);

        return {
          output: {
            attempts: context.attempt
          }
        };
      }
    };

    await writeFile(
      workflowFilePath,
      [
        "name: retry-run",
        "steps:",
        "  - id: flaky",
        "    type: core.flaky",
        "    retry:",
        "      attempts: 2",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runWorkflowFile({
      workflowFilePath,
      runDirectory,
      stdout: { log() {} },
      registry: createStepRegistry([...builtInStepRegistry.values(), flakyStep])
    });

    expect(attempts).toBe(2);
    expect(result.record.steps).toEqual([
      {
        id: "flaky",
        type: "core.flaky",
        status: "succeeded",
        output: {
          attempts: 2
        }
      }
    ]);
    expect(
      result.record.logs.some(
        (entry) => entry.message === "Retrying step flaky (2/2)."
      )
    ).toBe(true);
  });

  it("runs an inline prompt step and hands normalized output to downstream steps", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "talby-core-prompt-")
    );
    const workflowFilePath = path.join(tempRoot, "workflow.yaml");
    const runDirectory = path.join(tempRoot, "run");
    const prompts: string[] = [];

    await writeFile(
      workflowFilePath,
      [
        "name: prompt-inline",
        "steps:",
        "  - id: ask",
        "    type: core.prompt",
        "    prompt: Draft ${inputs.idea}",
        "  - id: echo",
        "    type: core.log",
        "    message: ${steps.ask.output.answer}",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runWorkflowFile({
      workflowFilePath,
      runDirectory,
      inputs: {
        idea: "workflow runner"
      },
      stdout: { log() {} },
      promptBackend: {
        async generate(request) {
          prompts.push(request.prompt);

          return `answer:${request.prompt}`;
        }
      }
    });

    expect(prompts).toEqual(["Draft workflow runner"]);
    expect(result.record.steps).toEqual([
      {
        id: "ask",
        type: "core.prompt",
        status: "succeeded",
        output: {
          answer: "answer:Draft workflow runner"
        }
      },
      {
        id: "echo",
        type: "core.log",
        status: "succeeded",
        output: {
          message: "answer:Draft workflow runner"
        }
      }
    ]);
  });

  it("loads prompt content from a file before calling the backend", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "talby-core-prompt-file-")
    );
    const workflowFilePath = path.join(tempRoot, "workflow.yaml");
    const promptFilePath = path.join(tempRoot, "prompt.txt");
    const runDirectory = path.join(tempRoot, "run");

    await writeFile(promptFilePath, "Prompt ${inputs.idea}", "utf8");
    await writeFile(
      workflowFilePath,
      [
        "name: prompt-file",
        "steps:",
        "  - id: ask",
        "    type: core.prompt",
        "    promptFile: ./prompt.txt",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runWorkflowFile({
      workflowFilePath,
      runDirectory,
      inputs: {
        idea: "from file"
      },
      stdout: { log() {} },
      promptBackend: {
        async generate(request) {
          return request.prompt;
        }
      }
    });

    expect(result.record.steps).toEqual([
      {
        id: "ask",
        type: "core.prompt",
        status: "succeeded",
        output: {
          answer: "Prompt from file"
        }
      }
    ]);
  });

  it("retries prompt execution using the validated retry policy", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "talby-core-prompt-retry-")
    );
    const workflowFilePath = path.join(tempRoot, "workflow.yaml");
    const runDirectory = path.join(tempRoot, "run");
    let attempts = 0;

    await writeFile(
      workflowFilePath,
      [
        "name: prompt-retry",
        "steps:",
        "  - id: ask",
        "    type: core.prompt",
        "    prompt: retry me",
        "    retry:",
        "      attempts: 2",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runWorkflowFile({
      workflowFilePath,
      runDirectory,
      stdout: { log() {} },
      promptBackend: {
        async generate() {
          attempts += 1;

          if (attempts === 1) {
            throw new Error("temporary prompt failure");
          }

          return "prompt ok";
        }
      }
    });

    expect(attempts).toBe(2);
    expect(result.record.steps).toEqual([
      {
        id: "ask",
        type: "core.prompt",
        status: "succeeded",
        output: {
          answer: "prompt ok"
        }
      }
    ]);
    expect(
      result.record.logs.some(
        (entry) => entry.message === "Retrying step ask (2/2)."
      )
    ).toBe(true);
  });

  it("writes an artifact from prior step output and records artifact metadata", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "talby-core-write-file-")
    );
    const workflowFilePath = path.join(tempRoot, "workflow.yaml");
    const runDirectory = path.join(tempRoot, "run");

    await writeFile(
      workflowFilePath,
      [
        "name: write-file-demo",
        "steps:",
        "  - id: ask",
        "    type: core.prompt",
        "    prompt: Draft ${inputs.idea}",
        "  - id: persist",
        "    type: core.write-file",
        "    path: outputs/result.txt",
        "    content: ${steps.ask.output.answer}",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runWorkflowFile({
      workflowFilePath,
      runDirectory,
      inputs: {
        idea: "workflow runner"
      },
      stdout: { log() {} },
      promptBackend: {
        async generate(request) {
          return `answer:${request.prompt}`;
        }
      }
    });

    const artifactPath = path.join(runDirectory, "outputs", "result.txt");

    expect(await readFile(artifactPath, "utf8")).toBe(
      "answer:Draft workflow runner"
    );
    expect(result.record.steps).toEqual([
      {
        id: "ask",
        type: "core.prompt",
        status: "succeeded",
        output: {
          answer: "answer:Draft workflow runner"
        }
      },
      {
        id: "persist",
        type: "core.write-file",
        status: "succeeded",
        output: {
          path: artifactPath,
          bytes: Buffer.byteLength("answer:Draft workflow runner", "utf8")
        }
      }
    ]);
    expect(result.record.artifacts).toEqual([
      {
        stepId: "persist",
        path: artifactPath,
        bytes: Buffer.byteLength("answer:Draft workflow runner", "utf8")
      }
    ]);
  });

  it("fails when a write-file step cannot persist its artifact", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "talby-core-write-file-fail-")
    );
    const workflowFilePath = path.join(tempRoot, "workflow.yaml");
    const runDirectory = path.join(tempRoot, "run");

    await writeFile(
      workflowFilePath,
      [
        "name: write-file-fail",
        "steps:",
        "  - id: persist",
        "    type: core.write-file",
        "    path: outputs/result.txt",
        "    content: blocked",
        ""
      ].join("\n"),
      "utf8"
    );

    await expect(
      runWorkflowFile({
        workflowFilePath,
        runDirectory,
        stdout: { log() {} },
        fileSystem: {
          mkdir,
          readFile,
          async writeFile(filePath, data, options) {
            if (
              typeof filePath === "string" &&
              filePath.endsWith(path.join("outputs", "result.txt"))
            ) {
              throw new Error("disk full");
            }

            return writeFile(filePath, data, options);
          }
        }
      })
    ).rejects.toThrow(
      `Workflow failed: disk full Inspect ${path.join(runDirectory, "run-log.json")} for details.`
    );

    const record = JSON.parse(
      await readFile(path.join(runDirectory, "run-log.json"), "utf8")
    );

    expect(record.steps).toEqual([
      {
        id: "persist",
        type: "core.write-file",
        status: "failed",
        error: "disk full"
      }
    ]);
    expect(record.artifacts).toEqual([]);
  });

  it("runs interpolation through the shared resolver before a log step executes", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "talby-core-resolve-")
    );
    const workflowFilePath = path.join(tempRoot, "workflow.yaml");
    const runDirectory = path.join(tempRoot, "run");
    const stdout = { log() {} };

    await writeFile(
      workflowFilePath,
      [
        "name: resolver-demo",
        "steps:",
        "  - id: first",
        "    type: core.log",
        "    message: Idea ${inputs.idea}",
        "  - id: second",
        "    type: core.log",
        "    message: Previous ${steps.first.output.message}",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runWorkflowFile({
      workflowFilePath,
      runDirectory,
      inputs: {
        idea: "alpha"
      },
      stdout
    });

    expect(result.record.steps).toEqual([
      {
        id: "first",
        type: "core.log",
        status: "succeeded",
        output: {
          message: "Idea alpha"
        }
      },
      {
        id: "second",
        type: "core.log",
        status: "succeeded",
        output: {
          message: "Previous Idea alpha"
        }
      }
    ]);
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
      `Workflow failed: boom Inspect ${path.join(runDirectory, "run-log.json")} for details.`
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
