import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { formatWelcome, main } from "./index";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

describe("cli entrypoint", () => {
  it("formats the welcome message", () => {
    expect(formatWelcome()).toBe("talby-wf cli ready (workflow runtime ready (1 built-in step))");
  });

  it("writes the welcome message and usage help", async () => {
    const log = vi.fn();

    await expect(main([], { stdout: { log }, stderr: { error: vi.fn() } })).resolves.toBe(0);

    expect(log).toHaveBeenNthCalledWith(
      1,
      "talby-wf cli ready (workflow runtime ready (1 built-in step))"
    );
    expect(log).toHaveBeenNthCalledWith(2, "Usage: twf run <workflow.yaml> [--run-dir <path>]");
  });

  it("runs the demo workflow end to end and writes run logs", async () => {
    const stdout = { log: vi.fn() };
    const stderr = { error: vi.fn() };
    const runDirectory = await mkdtemp(path.join(os.tmpdir(), "talby-cli-run-"));
    const workflowFilePath = path.resolve(currentDirectory, "examples/demo-workflow.yaml");

    await expect(
      main(["run", workflowFilePath, "--run-dir", runDirectory], { stdout, stderr })
    ).resolves.toBe(0);

    expect(stdout.log).toHaveBeenCalledWith("Hello from the Talby workflow runner.");

    const logFilePath = path.join(runDirectory, "run-log.json");
    const record = JSON.parse(await readFile(logFilePath, "utf8"));

    expect(record.status).toBe("succeeded");
    expect(record.workflowName).toBe("demo-workflow");
    expect(record.steps).toEqual([
      {
        id: "announce",
        type: "core.log",
        status: "succeeded",
        output: {
          message: "Hello from the Talby workflow runner."
        }
      }
    ]);
    expect(stderr.error).not.toHaveBeenCalled();
  });
});
