import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const supportedExtensions = /\.(?:[cm]?[jt]s|json|jsonc|ya?ml|mdx)$/i;
const eslintExtensions = /\.(?:[cm]?[jt]s)$/i;
const files = process.argv.slice(2);
const pnpmExecPath = process.env.npm_execpath;

if (files.length === 0) {
  console.error(
    "No code files provided. Usage: pnpm fix:code:files -- <files...>"
  );
  process.exit(1);
}

const invalidPaths = files.filter((filePath) => !existsSync(filePath));

if (invalidPaths.length > 0) {
  console.error(`Missing files: ${invalidPaths.join(", ")}`);
  process.exit(1);
}

const codeFiles = files.filter((filePath) =>
  supportedExtensions.test(filePath)
);

const eslintFiles = codeFiles.filter((filePath) =>
  eslintExtensions.test(filePath)
);

if (codeFiles.length !== files.length) {
  const unsupported = files.filter(
    (filePath) => !supportedExtensions.test(filePath)
  );
  console.error(`Unsupported code file extensions: ${unsupported.join(", ")}`);
  process.exit(1);
}

const run = (args) => {
  if (!pnpmExecPath) {
    console.error("Unable to resolve pnpm via npm_execpath.");
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [pnpmExecPath, ...args], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (eslintFiles.length > 0) {
  run(["exec", "eslint", "--fix", ...eslintFiles]);
}

run(["exec", "prettier", "--write", ...codeFiles]);
