# Workflow Runner Setup Plan

This document captures the agreed repository setup for the Workflow Runner MVP.
It is a build-ready plan only. It does not implement the workspace.

## Goal

Create a small pnpm workspace that supports a CLI-first Workflow Runner MVP with:

- `apps/cli` as the executable shell.
- `packages/core` as the runtime library.
- root-level quality commands for code and Markdown.
- shared root configuration with minimal package overrides.
- `vite` and `vitest` as the main TS toolchain.
- `tsdown` for CLI packaging.

## Chosen Decisions

- Use a pnpm workspace with exactly two workspaces to start: `apps/cli` and `packages/core`.
- Keep the root package private and use it as the orchestration layer.
- Use `vite` and `vitest` across the workspace pragmatically rather than forcing identical package behavior.
- Use `tsdown` to package `apps/cli`.
- Use `vite` library mode for `packages/core`.
- Keep shared config in root files and let packages extend or reference them with minimal local overrides.
- Make root scripts the primary operator interface.
- Keep Markdown checks at the root.
- Keep shared tooling dependencies at the root unless a package later needs to invoke a tool directly.
- Use passthrough file arguments after `--` for targeted fix commands.

## Target Repository Shape

```text
.
|- apps/
|  |- cli/
|  |  |- package.json
|  |  |- tsconfig.json
|  |  |- tsdown.config.ts
|  |  |- vitest.config.ts
|  |  \- src/
|  |     \- index.ts
|- packages/
|  |- core/
|  |  |- package.json
|  |  |- tsconfig.json
|  |  |- vite.config.ts
|  |  |- vitest.config.ts
|  |  \- src/
|  |     \- index.ts
|- docs/
|  \- planning/
|- package.json
|- pnpm-workspace.yaml
|- tsconfig.base.json
|- tsconfig.json
|- eslint.config.mjs
|- .prettierrc.json
|- .prettierignore
|- .markdownlint-cli2.jsonc
\- .gitignore
```

## Package Roles

### Root

- Private workspace root.
- Owns shared dev tooling and shared config.
- Exposes operator-facing scripts such as `check`, `fix`, `check:md`, and `fix:md`.
- Orchestrates package-level code checks and fixes where package-specific behavior exists.

### `apps/cli`

- Thin Node CLI entry package.
- Depends on `packages/core` for engine behavior.
- Uses `tsdown` for packaging executable output.
- Uses `vitest` for CLI-focused tests.
- Should avoid accumulating runtime logic that belongs in `packages/core`.

### `packages/core`

- Owns the workflow loader, validator, resolver, runner, step registry, and related runtime modules.
- Uses `vite` library mode for package build output.
- Uses `vitest` for unit and integration-style runtime tests.
- Provides a clean import surface for the CLI.

## Tooling Model

### TypeScript

- Root owns the base TS config.
- Root `check:code` runs `tsc --noEmit` first and fails the sequence immediately on error.
- Packages extend the root config and keep only package-specific compiler options locally.
- Package-local `typescript` should be added only if a package later needs to invoke `tsc` directly.

### ESLint

- Root owns the shared ESLint config.
- Root `check:code` runs ESLint in check mode after TypeScript passes.
- Root `fix:code` runs ESLint in fix mode after TypeScript passes.
- Package overrides should be minimal and only added when app and library needs diverge.

### Prettier

- Root owns shared formatting config.
- Root `check:code` runs Prettier in check mode after ESLint passes.
- Root `fix:code` runs Prettier in write mode after ESLint fix mode passes.
- Markdown formatting can stay under `fix:md` and `fix:md:files` instead of mixing into code commands.

### Markdown Lint

- Root owns Markdown lint configuration.
- Markdown checks remain repo-wide rather than package-specific.
- Targeted Markdown fixes should use passthrough file arguments after `--`.

### Vite

- `packages/core` uses Vite library mode as the main package build path.
- The workspace standardizes on the Vite tool family without pretending the CLI is a web app.

### Vitest

- Shared test runner across the workspace.
- `packages/core` uses it for runtime-focused tests.
- `apps/cli` uses it for CLI smoke and integration-oriented tests.

### Tsdown

- `apps/cli` uses `tsdown` for packaging the executable.
- This keeps CLI packaging aligned with Node executable concerns instead of overloading Vite for release output.

## Script Contract

The root package should become the main operator entrypoint.

### Root scripts to add

```json
{
  "check": "pnpm check:code && pnpm check:md",
  "fix": "pnpm fix:code && pnpm fix:md",
  "check:code": "tsc --noEmit && eslint . && prettier --check .",
  "fix:code": "tsc --noEmit && eslint . --fix && prettier --write .",
  "fix:code:files": "eslint --fix && prettier --write",
  "check:md": "markdownlint-cli2 \"**/*.md\"",
  "fix:md": "markdownlint-cli2 --fix \"**/*.md\"",
  "fix:md:files": "markdownlint-cli2 --fix"
}
```

These entries are intentionally schematic. The final implementation may need narrower globbing and explicit ignore coverage, but the contract should stay the same.

## Script Behavior Rules

- `check` runs `check:code` and then `check:md`.
- `fix` runs `fix:code` and then `fix:md`.
- `check:code` sequence order is fixed: TypeScript, then ESLint, then Prettier check mode.
- `fix:code` sequence order is fixed: TypeScript, then ESLint fix mode, then Prettier write mode.
- The first failing command in a sequence stops the overall script.
- `fix:code:files` accepts file paths via passthrough arguments after `--`.
- `fix:md:files` accepts file paths via passthrough arguments after `--`.

### Example targeted usage

```bash
pnpm fix:code:files -- apps/cli/src/index.ts packages/core/src/index.ts
pnpm fix:md:files -- docs/planning/mvp-prd.md docs/planning/mvp-issues.md
```

## Dependency Placement

### Root devDependencies

Place the shared toolchain at the root:

- `typescript`
- `eslint`
- `prettier`
- `markdownlint-cli2`
- `vite`
- `vitest`
- `tsdown`

Possible supporting packages will depend on the chosen config style, but likely include:

- TypeScript ESLint packages.
- Any Node-focused ESLint globals or parser helpers required by the final config.

### Package dependencies

- `apps/cli` should depend on `packages/core`.
- `apps/cli` should only add package-local devDependencies if its packaging or test setup cannot cleanly rely on the root toolchain.
- `packages/core` should stay lean and add local dependencies only when they are runtime or package-specific.

## Config Files To Add

### Root config

- `pnpm-workspace.yaml`
  - Include `apps/*` and `packages/*`.
- `tsconfig.base.json`
  - Shared compiler options for the workspace.
- `tsconfig.json`
  - Root project entry for typechecking and editor alignment.
- `eslint.config.mjs`
  - Shared lint rules for root, CLI, and core.
- `.prettierrc.json`
  - Shared formatting rules.
- `.prettierignore`
  - Ignore build outputs, coverage, generated artifacts, and lockfile exceptions if needed.
- `.markdownlint-cli2.jsonc`
  - Shared Markdown lint behavior.

### `apps/cli` config

- `apps/cli/package.json`
  - CLI package metadata, bin entry, and local scripts only if needed.
- `apps/cli/tsconfig.json`
  - Extends root TS config.
- `apps/cli/tsdown.config.ts`
  - CLI packaging configuration.
- `apps/cli/vitest.config.ts`
  - CLI test configuration.

### `packages/core` config

- `packages/core/package.json`
  - Library package metadata and any local scripts if needed.
- `packages/core/tsconfig.json`
  - Extends root TS config.
- `packages/core/vite.config.ts`
  - Library mode build configuration.
- `packages/core/vitest.config.ts`
  - Runtime test configuration.

## Ordered Implementation Sequence

1. Convert the root package into a private workspace orchestrator.
2. Add `pnpm-workspace.yaml` with `apps/*` and `packages/*`.
3. Add shared root config files for TypeScript, ESLint, Prettier, and Markdown linting.
4. Install root-level dev tooling: TypeScript, ESLint, Prettier, Markdown lint, Vite, Vitest, and Tsdown.
5. Replace the current placeholder root scripts with the agreed `check`, `fix`, `check:code`, `fix:code`, `fix:code:files`, `check:md`, `fix:md`, and `fix:md:files` contract.
6. Create `apps/cli` with a thin executable entrypoint, package metadata, TS config, Tsdown config, and Vitest config.
7. Create `packages/core` with package metadata, TS config, Vite library config, Vitest config, and a placeholder public entrypoint.
8. Wire `apps/cli` to depend on `packages/core`.
9. Confirm that root `check:code` and `fix:code` work across the workspace with fail-fast sequencing.
10. Confirm that targeted fix commands accept passthrough file paths after `--`.
11. Only after the setup layer is stable, begin implementing the workflow runtime described in the MVP PRD.

## Validation Targets For The Setup Phase

- `pnpm install` resolves a clean workspace with root-owned tooling.
- `pnpm check` succeeds on an empty scaffold.
- `pnpm fix` succeeds on an empty scaffold.
- `pnpm fix:code:files -- <paths...>` applies fixes only to the provided code files.
- `pnpm fix:md:files -- <paths...>` applies fixes only to the provided Markdown files.
- `apps/cli` can package a minimal executable through `tsdown`.
- `packages/core` can build in Vite library mode.
- `vitest` can run at least one placeholder test in each workspace.

## Deliberate Non-Goals For Setup

- Do not introduce extra workspace packages yet.
- Do not create a dedicated config package yet.
- Do not add Turborepo, Nx, or another task runner yet.
- Do not implement runtime modules yet.
- Do not optimize release publishing yet.

## Follow-On After Setup

Once this setup is in place, the first implementation slice should still follow the MVP planning docs:

- bootstrap the CLI runner;
- establish the shared runtime contracts in `packages/core`;
- add fail-fast validation and `${...}` resolution;
- then build the sample workflows.
