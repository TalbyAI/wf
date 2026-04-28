import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const writeTools = new Set([
  "apply_patch",
  "create_file",
  "editFiles",
  "writeFile",
  "createFile"
]);

const codeExtensions = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".cts",
  ".mts",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".mdx"
]);

const eslintExtensions = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".cts",
  ".mts"
]);
const typescriptExtensions = new Set([".ts", ".cts", ".mts"]);
const markdownExtensions = new Set([".md"]);
const pathKeys = new Set(["filePath", "path", "files"]);

const main = () => {
  const payload = readHookPayload();

  if (!payload || !writeTools.has(payload.tool_name)) {
    return;
  }

  const writtenFiles = collectWrittenFiles(payload.tool_input);

  if (writtenFiles.length === 0) {
    return;
  }

  const codeFiles = writtenFiles.filter((filePath) =>
    codeExtensions.has(path.extname(filePath).toLowerCase())
  );
  const markdownFiles = writtenFiles.filter((filePath) =>
    markdownExtensions.has(path.extname(filePath).toLowerCase())
  );

  if (codeFiles.length === 0 && markdownFiles.length === 0) {
    return;
  }

  if (codeFiles.length > 0) {
    runPnpm(["fix:code:files", "--", ...toRepoRelativePaths(codeFiles)]);
  }

  if (markdownFiles.length > 0) {
    runPnpm(["fix:md:files", "--", ...toRepoRelativePaths(markdownFiles)]);
  }

  const diagnostics = [
    ...collectCodeDiagnostics(codeFiles),
    ...collectMarkdownDiagnostics(markdownFiles)
  ];

  if (diagnostics.length === 0) {
    return;
  }

  const additionalContext = [
    "Post-edit validation found remaining issues.",
    ...diagnostics.map(formatDiagnostic)
  ].join("\n");

  process.stdout.write(
    `${JSON.stringify({
      decision: "block",
      reason: "Post-edit validation failed",
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext
      }
    })}\n`
  );
};

const readHookPayload = () => {
  const input = readFileSync(0, "utf8").trim();

  if (!input) {
    return null;
  }

  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

const collectWrittenFiles = (toolInput) => {
  const collected = new Set();

  const visit = (value, key) => {
    if (typeof value === "string") {
      if (pathKeys.has(key ?? "")) {
        addNormalizedPath(collected, value);
      }

      if (value.includes("*** Begin Patch")) {
        for (const patchPath of extractPatchPaths(value)) {
          addNormalizedPath(collected, patchPath);
        }
      }

      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, key);
      }

      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      visit(nestedValue, nestedKey);
    }
  };

  visit(toolInput, null);

  return [...collected];
};

const extractPatchPaths = (patchText) => {
  const matches = patchText.matchAll(
    /^\*\*\* (?:Add|Update) File: (.+?)(?: -> .+)?$/gm
  );

  return [...matches].map((match) => match[1].trim());
};

const addNormalizedPath = (collection, rawPath) => {
  const normalizedPath = normalizePath(rawPath);

  if (!normalizedPath) {
    return;
  }

  if (!existsSync(normalizedPath)) {
    return;
  }

  collection.add(normalizedPath);
};

const normalizePath = (rawPath) => {
  if (!rawPath) {
    return null;
  }

  const rawTrimmedPath = rawPath.trim();
  const trimmedPath =
    rawTrimmedPath.startsWith('"') && rawTrimmedPath.endsWith('"')
      ? rawTrimmedPath.slice(1, -1)
      : rawTrimmedPath;

  if (!trimmedPath) {
    return null;
  }

  if (trimmedPath.startsWith("file://")) {
    return fileURLToPath(trimmedPath);
  }

  if (path.isAbsolute(trimmedPath)) {
    return path.normalize(trimmedPath);
  }

  return path.normalize(path.resolve(repoRoot, trimmedPath));
};

const toRepoRelativePaths = (filePaths) =>
  filePaths.map((filePath) =>
    path.relative(repoRoot, filePath).replaceAll("\\", "/")
  );

const runPnpm = (args) => {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8"
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
};

const collectCodeDiagnostics = (codeFiles) => {
  if (codeFiles.length === 0) {
    return [];
  }

  const diagnostics = [];
  const eslintFiles = codeFiles.filter((filePath) =>
    eslintExtensions.has(path.extname(filePath).toLowerCase())
  );

  if (eslintFiles.length > 0) {
    diagnostics.push(...collectEslintDiagnostics(eslintFiles));
  }

  diagnostics.push(
    ...collectPrettierDiagnostics(
      codeFiles,
      "Prettier",
      "Run pnpm fix:code:files -- <file> to rewrite formatting, then resolve any remaining syntax issues."
    )
  );

  const typescriptFiles = codeFiles.filter((filePath) =>
    typescriptExtensions.has(path.extname(filePath).toLowerCase())
  );

  if (typescriptFiles.length > 0) {
    diagnostics.push(...collectTypeScriptDiagnostics(typescriptFiles));
  }

  return diagnostics;
};

const collectMarkdownDiagnostics = (markdownFiles) => {
  if (markdownFiles.length === 0) {
    return [];
  }

  const result = runPnpm([
    "exec",
    "markdownlint-cli2",
    ...toRepoRelativePaths(markdownFiles)
  ]);

  if (result.status === 0) {
    return [];
  }

  return parseLineDiagnostics(
    result.stdout || result.stderr,
    markdownFiles,
    "Markdownlint",
    "Fix the reported Markdown rule violations, then rerun pnpm fix:md:files -- <file>."
  );
};

const collectEslintDiagnostics = (eslintFiles) => {
  const result = runPnpm([
    "exec",
    "eslint",
    "--format",
    "json",
    ...toRepoRelativePaths(eslintFiles)
  ]);

  if (!result.stdout.trim()) {
    return [];
  }

  let parsedResults;

  try {
    parsedResults = JSON.parse(result.stdout);
  } catch {
    return [
      {
        tool: "ESLint",
        file: toRepoRelativePaths([eslintFiles[0]])[0],
        message:
          "ESLint reported issues but the JSON output could not be parsed.",
        fixHint:
          "Run pnpm exec eslint --format json <file> to inspect the raw diagnostics."
      }
    ];
  }

  return parsedResults.flatMap((entry) =>
    entry.messages
      .filter((message) => message.severity === 2)
      .map((message) => ({
        tool: "ESLint",
        file: path.relative(repoRoot, entry.filePath).replaceAll("\\", "/"),
        message: `${message.message} (${message.ruleId ?? "no rule id"} at ${message.line}:${message.column})`,
        fixHint:
          "Apply the rule fix manually in the edited file or the directly related import/type file, then rerun pnpm fix:code:files -- <file>."
      }))
  );
};

const collectPrettierDiagnostics = (files, tool, fixHint) => {
  const result = runPnpm([
    "exec",
    "prettier",
    "--check",
    ...toRepoRelativePaths(files)
  ]);

  if (result.status === 0) {
    return [];
  }

  const diagnostics = [];
  const unmatchedFiles = new Set(
    files.map((filePath) => toRepoRelativePaths([filePath])[0])
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const warnPattern = /^\[warn\] (.+)$/;

  for (const line of output.split(/\r?\n/)) {
    const warnMatch = warnPattern.exec(line);

    if (!warnMatch) {
      continue;
    }

    const reportedPath = warnMatch[1].trim().replaceAll("\\", "/");

    if (reportedPath.startsWith("Code style issues")) {
      continue;
    }

    if (!unmatchedFiles.has(reportedPath)) {
      continue;
    }

    unmatchedFiles.delete(reportedPath);
    diagnostics.push({
      tool,
      file: reportedPath,
      message: "Formatting still differs from Prettier output.",
      fixHint
    });
  }

  if (diagnostics.length > 0) {
    return diagnostics;
  }

  return files.map((filePath) => ({
    tool,
    file: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
    message: "Formatting validation failed.",
    fixHint
  }));
};

const collectTypeScriptDiagnostics = (typescriptFiles) => {
  const result = runPnpm(["exec", "tsc", "--noEmit", "--pretty", "false"]);

  if (result.status === 0) {
    return [];
  }

  const allowedFiles = new Set([
    ...typescriptFiles,
    ...collectDirectImports(typescriptFiles)
  ]);

  return parseTypeScriptDiagnostics(
    `${result.stdout}\n${result.stderr}`,
    allowedFiles
  );
};

const collectDirectImports = (typescriptFiles) => {
  const relatedFiles = new Set();
  const importFromPattern =
    /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']/gm;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/gm;

  for (const filePath of typescriptFiles) {
    const source = readFileSync(filePath, "utf8");
    const importMatches = [
      ...source.matchAll(importFromPattern),
      ...source.matchAll(dynamicImportPattern)
    ];

    for (const match of importMatches) {
      const specifier = match[1] ?? match[2];

      if (!specifier?.startsWith(".")) {
        continue;
      }

      for (const candidate of resolveImportCandidates(filePath, specifier)) {
        if (existsSync(candidate)) {
          relatedFiles.add(candidate);
          break;
        }
      }
    }
  }

  return [...relatedFiles];
};

const resolveImportCandidates = (fromFilePath, specifier) => {
  const basePath = path.resolve(path.dirname(fromFilePath), specifier);
  const extensions = ["", ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];
  const indexExtensions = [
    path.join("index.ts"),
    path.join("index.mts"),
    path.join("index.cts"),
    path.join("index.js"),
    path.join("index.mjs"),
    path.join("index.cjs")
  ];

  return [
    ...extensions.map((extension) => `${basePath}${extension}`),
    ...indexExtensions.map((indexFile) => path.join(basePath, indexFile))
  ].map((candidate) => path.normalize(candidate));
};

const parseTypeScriptDiagnostics = (output, allowedFiles) => {
  const diagnostics = [];
  const lines = output.split(/\r?\n/);
  const diagnosticPattern = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

  for (const line of lines) {
    const match = line.match(diagnosticPattern);

    if (!match) {
      continue;
    }

    const diagnosticFile = normalizePath(match[1]);

    if (!diagnosticFile || !allowedFiles.has(diagnosticFile)) {
      continue;
    }

    diagnostics.push({
      tool: "TypeScript",
      file: path.relative(repoRoot, diagnosticFile).replaceAll("\\", "/"),
      message: `${match[4]} at ${match[2]}:${match[3]} - ${match[5]}`,
      fixHint:
        "Fix the type error in the edited file or the directly imported module, then rerun pnpm fix:code:files -- <file>."
    });
  }

  return diagnostics;
};

const parseLineDiagnostics = (output, files, tool, fixHint) => {
  const fileMap = new Map(
    files.map((filePath) => [
      path.relative(repoRoot, filePath).replaceAll("\\", "/"),
      filePath
    ])
  );

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      for (const relativeFilePath of fileMap.keys()) {
        if (!line.includes(relativeFilePath)) {
          continue;
        }

        return [
          {
            tool,
            file: relativeFilePath,
            message:
              line.replace(relativeFilePath, "").replace(/^[:\s-]+/, "") ||
              "Validation failed.",
            fixHint
          }
        ];
      }

      return [];
    });
};

const formatDiagnostic = ({ tool, file, message, fixHint }) =>
  `${tool}: ${file}: ${message} Fix: ${fixHint}`;

main();
