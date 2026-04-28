# Workflow Runner MVP Issues

Draft issue breakdown for the Workflow Runner MVP. These are tracer-bullet
vertical slices derived from the PRD and intended to become GitHub issues once
repository remote wiring is available.

## 1. Bootstrap CLI runner with one demo step

**Type:** AFK  
**Blocked by:** None - can start immediately  
**User stories covered:** 1, 2, 3, 9, 18, 20, 22, 23, 24, 25, 29, 35

What to build:

Create the initial TypeScript CLI application, workflow loader, shared run
context, and built-in step registry. Prove the full execution path with a small
workflow that runs a `core.log` step and emits inspectable logs.

Acceptance criteria:

- [x] The repository has a runnable TypeScript CLI entry point for
      workflow execution.
- [x] A YAML workflow with at least one `core.log` step can run end to end.
- [x] The runtime creates inspectable run logs and fails the run
      immediately on step failure.
- [x] The built-in step registry uses namespaced step types and a shared
      execution contract.
- [x] A smoke or integration test covers the CLI path for the demo workflow.

## 2. Add fail-fast validation and `${...}` resolution

**Type:** AFK  
**Blocked by:** 1. Bootstrap CLI runner with one demo step  
**User stories covered:** 4, 5, 6, 7, 8, 16, 17, 26, 27, 30, 37

What to build:

Add pre-execution workflow validation and centralized interpolation so authors
can safely reference workflow inputs and prior step outputs with one resolver.
Reject malformed workflows before any step executes.

Acceptance criteria:

- [x] Validation rejects duplicate step ids, missing required fields,
      and invalid step types.
- [x] Validation rejects invalid `${inputs.*}` and
      `${steps.*.output.*}` references before execution starts.
- [x] Retry defaults are applied during validation in a predictable way.
- [x] Interpolation is centralized and works across supported step fields.
- [x] Unit tests cover valid workflows and the expected validation failures.

## 3. Ship `core.prompt` with a narrow backend adapter

**Type:** AFK  
**Blocked by:** 2. Add fail-fast validation and `${...}` resolution  
**User stories covered:** 11, 12, 13, 16, 17, 25, 28, 29, 30

What to build:

Implement the prompt step with inline and file-based prompt content, a narrow
backend adapter boundary, normalized JSON output, and retry-aware execution.
Prompt results stay in memory for downstream steps until explicitly persisted.

Acceptance criteria:

- [x] `core.prompt` accepts inline prompt text and prompt content loaded
      from a file.
- [x] Prompt execution goes through a narrow adapter interface rather
      than leaking backend details into the runner.
- [x] Successful prompt execution returns a JSON object shaped as
      `{ answer: string }`.
- [x] Retry behavior for transient prompt failures follows the validated
      step retry policy.
- [x] Tests use a fake or stub backend and verify output normalization
      plus in-memory output handoff.

## 4. Make persistence explicit with `core.write-file`

**Type:** AFK  
**Blocked by:** 3. Ship `core.prompt` with a narrow backend adapter  
**User stories covered:** 14, 20, 21, 23, 29, 36

What to build:

Implement explicit artifact persistence through `core.write-file` so generated
content can be written to predictable paths and inspected after a run.

Acceptance criteria:

- [ ] `core.write-file` can persist content from prior step outputs
      using the shared resolver.
- [ ] Written artifacts land in predictable, reviewable paths.
- [ ] Run metadata records artifact details so users can inspect what
      was produced.
- [ ] File write failures stop the run and surface a clear CLI-visible error.
- [ ] Tests cover successful writes and write failures.

## 5. Polish operator-facing `core.log`

**Type:** AFK  
**Blocked by:** 2. Add fail-fast validation and `${...}` resolution  
**User stories covered:** 15, 20, 29, 36

What to build:

Finish the operator-facing logging step so it resolves templates like other
steps and produces readable execution messages without mutating workflow state.

Acceptance criteria:

- [ ] `core.log` resolves `${...}` references in log messages.
- [ ] Log output is visible during runs and preserved in inspectable
      run artifacts.
- [ ] The log step does not mutate workflow outputs beyond the shared
      logging surface.
- [ ] Tests verify readable log output and interpolation behavior.

## 6. Deliver idea-to-PRD workflow end to end

**Type:** AFK  
**Blocked by:** 4. Make persistence explicit with `core.write-file`,
5. Polish operator-facing `core.log`  
**User stories covered:** 18, 19, 20, 21, 23, 31, 36, 38

What to build:

Add the first real workflow that turns an idea input into a PRD draft using the
CLI, prompt step, logging, and explicit file writing.

Acceptance criteria:

- [ ] A sample workflow accepts an idea input at runtime and generates
      a PRD draft.
- [ ] The workflow uses built-in steps only and runs linearly in one session.
- [ ] The generated PRD can be inspected in memory during the run and
      written to disk explicitly.
- [ ] A smoke or integration test covers the complete idea-to-PRD flow.

## 7. Deliver PRD-to-task-list workflow end to end

**Type:** AFK  
**Blocked by:** 6. Deliver idea-to-PRD workflow end to end  
**User stories covered:** 18, 19, 20, 21, 23, 32, 36, 38

What to build:

Add the second real workflow that converts a PRD input into a task list draft,
proving chained document-generation workflows on the same runtime path.

Acceptance criteria:

- [ ] A sample workflow accepts PRD content as input and generates a
      task list draft.
- [ ] The workflow reuses the same CLI execution model, resolver, logs,
      and artifact handling.
- [ ] Generated task output is inspectable and can be persisted explicitly.
- [ ] A smoke or integration test covers the full PRD-to-task-list flow.

## Notes

- The repository is currently planning-only, so these issues assume a
  greenfield implementation.
- The PRD notes that automatic GitHub issue submission was previously
  blocked by missing remote wiring.
- If remote wiring is added, each section above can be converted
  directly into a GitHub issue body.
