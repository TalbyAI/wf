import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const files = process.argv.slice(2);
const pnpmExecPath = process.env.npm_execpath;

if (files.length === 0) {
  console.error(
    "No Markdown files provided. Usage: pnpm fix:md:files -- <files...>"
  );
  process.exit(1);
}

const invalidPaths = files.filter((filePath) => !existsSync(filePath));

if (invalidPaths.length > 0) {
  console.error(`Missing files: ${invalidPaths.join(", ")}`);
  process.exit(1);
}

const markdownFiles = files.filter((filePath) => filePath.endsWith(".md"));

if (markdownFiles.length !== files.length) {
  const unsupported = files.filter((filePath) => !filePath.endsWith(".md"));
  console.error(`Unsupported Markdown targets: ${unsupported.join(", ")}`);
  process.exit(1);
}

if (!pnpmExecPath) {
  console.error("Unable to resolve pnpm via npm_execpath.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [pnpmExecPath, "exec", "markdownlint-cli2", "--fix", ...markdownFiles],
  {
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
