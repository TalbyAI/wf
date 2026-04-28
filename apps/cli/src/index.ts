#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeCore } from "@talby/core";

export function formatWelcome(): string {
  return `talby-wf cli ready (${describeCore()})`;
}

export function main(stdout: Pick<Console, "log"> = console): void {
  stdout.log(formatWelcome());
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  main();
}
