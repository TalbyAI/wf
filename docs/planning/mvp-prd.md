# Workflow Runner MVP PRD

## Problem Statement

The current repository has an MVP idea but no implementation plan that
is framed as a product requirement. The immediate problem is to turn a
promising CLI-first workflow runner concept into a concrete, buildable
scope that keeps the first release small, machine-executable, and
reviewable. The product needs to prove that YAML-authored workflows can
drive TypeScript-built steps, wire outputs across steps with a single
interpolation model, and generate useful planning artifacts without
taking on long-running orchestration, approval gates, or a plugin
ecosystem too early.

## Solution

Deliver a CLI-first workflow runner MVP where YAML is the source of
truth for workflow definition and built-in TypeScript step handlers
execute those definitions linearly. The MVP will support exactly two
end-to-end workflows: idea to PRD draft, and PRD to task list draft. It
will provide fail-fast validation for workflow shape and references,
stable step ids, a shared `${...}` resolver for inputs and prior
outputs, a small built-in step catalog, explicit per-step retry
settings, and inspectable run artifacts. The result should let a user
author a short-lived workflow, run it in one session, and persist
generated documents when desired.

## User Stories

1. As a workflow author, I want to define a workflow in YAML, so that
    the workflow remains readable and versionable.
2. As a workflow author, I want each step to have a stable id, so that
    later steps can reference earlier outputs predictably.
3. As a workflow author, I want each step to declare a single
    namespaced type, so that runtime behavior is explicit and auditable.
4. As a workflow author, I want to pass workflow inputs into step fields
    with one interpolation syntax, so that authoring stays consistent.
5. As a workflow author, I want to reference prior step outputs with the
    same interpolation syntax, so that data wiring has one mental model.
6. As a workflow author, I want invalid references to fail before
    execution starts, so that broken workflows do not partially run.
7. As a workflow author, I want duplicate or missing step ids to be
    rejected early, so that workflow structure stays safe.
8. As a workflow author, I want required step fields to be validated up
    front, so that runtime failures are reduced.
9. As a workflow author, I want linear step execution only in the MVP,
    so that I can rely on a small, understandable execution model.
10. As a workflow author, I want to avoid branching and pause-resume
     features in the MVP, so that the first engine remains simple enough
     to ship.
11. As a workflow author, I want prompt content to be defined inline or
     loaded from files, so that small and large prompts are both
     practical.
12. As a workflow author, I want generated text to be returned in a
     normalized JSON shape, so that downstream steps can consume it
     consistently.
13. As a workflow author, I want prompt results to stay in memory until
     I explicitly write them out, so that document workflows are concise.
14. As a workflow author, I want a dedicated file-writing step, so that
     persistence is explicit rather than hidden inside prompt execution.
15. As a workflow author, I want a logging step, so that workflows can
     emit helpful operator-facing messages.
16. As a workflow author, I want a small retry policy per step, so that
     transient failures can be handled without complex recovery logic.
17. As a workflow author, I want retry defaults to be simple and
     predictable, so that workflow behavior is easy to reason about.
18. As a CLI user, I want to run a workflow in one command, so that the
     tool feels scriptable from day one.
19. As a CLI user, I want to provide workflow inputs at runtime, so that
     the same workflow can be reused across multiple runs.
20. As a CLI user, I want execution logs to be inspectable, so that I
     can understand what happened during a run.
21. As a CLI user, I want written artifacts to land in a predictable
     location or path, so that generated outputs are easy to review.
22. As a CLI user, I want the runner to stay single-session for the MVP,
     so that I know workflows should be short-lived and restartable.
23. As a CLI user, I want failures to stop the run immediately, so that
     partial success does not hide problems.
24. As a maintainer, I want built-in steps to be registered through one
     catalog, so that supported capabilities are explicit.
25. As a maintainer, I want step execution to use a shared contract, so
     that adding future built-ins does not fragment runtime behavior.
26. As a maintainer, I want reference resolution to be centralized, so
     that interpolation behavior is consistent across fields and prompts.
27. As a maintainer, I want workflow validation to be separate from
     execution, so that correctness checks are testable in isolation.
28. As a maintainer, I want the prompt backend boundary to stay narrow,
     so that future backend replacement does not leak across the engine.
29. As a maintainer, I want run context to capture inputs, outputs,
     artifacts, retries, and logs, so that step handlers share one
     execution surface.
30. As a maintainer, I want step outputs to remain JSON objects, so that
     data contracts stay machine-friendly.
31. As a maintainer, I want the first workflow to turn an idea into a
     PRD draft, so that the core prompt-and-persist path is proven.
32. As a maintainer, I want the second workflow to turn a PRD into a
     task list draft, so that chained document generation is proven.
33. As a maintainer, I want the MVP to exclude third-party step
     libraries, so that extension design can wait until the core engine
     is stable.
34. As a maintainer, I want schema-backed structured outputs deferred
     until after the MVP, so that the first release does not stall on
     stronger typing features.
35. As a reviewer, I want the engine behavior to be deterministic at the
     control-flow level, so that code review can focus on a small
     execution surface.
36. As a reviewer, I want workflow artifacts and logs to be visible
     after a run, so that generated planning outputs can be inspected
     without debugging the runtime.
37. As a future contributor, I want deep modules around validation,
     resolution, and execution, so that changes can be made safely
     without spreading logic everywhere.
38. As a future contributor, I want at least one integration path that
     exercises a full workflow run, so that the assembled system remains
     trustworthy as it evolves.

## Implementation Decisions

- Build the MVP around six main modules: a workflow definition loader, a
  workflow validator, a reference and template resolver, a linear
  workflow runner, a built-in step registry, and a prompt backend
  adapter with a deliberately narrow interface.
- Treat the workflow definition loader and validator as separate
  concerns. Loading should parse and normalize author input; validation
  should enforce required fields, step id rules, reference correctness,
  and retry defaults before execution begins.
- Make the reference and template resolver a deep module. It should own
  all `${...}` expansion across workflow fields and prompt content so
  interpolation semantics are not duplicated in step handlers.
- Keep the workflow runner linear and fail-fast. It should execute steps
  in order, persist outputs into shared run context, apply step-level
  retry policy, and stop on unrecoverable errors.
- Define a single step execution contract that accepts the normalized
  step definition plus run context and returns a JSON object output.
- Limit the built-in catalog to `core.prompt`, `core.write-file`, and
  `core.log` for the MVP.
- Keep `core.prompt` responsible only for text generation and normalized
  output production. It should return an object shaped like
  `{ answer: string }` rather than embedding persistence behavior.
- Keep `core.write-file` responsible for persistence of artifacts
  generated by prior steps. This preserves step separation and makes
  file side effects explicit in workflow YAML.
- Keep `core.log` lightweight and operator-facing. It should resolve
  interpolations like other fields and emit readable run messages
  without mutating workflow state beyond logs.
- Use one concrete prompt backend in the MVP, but keep the call site
  contained to a narrow adapter layer so future backend generalization
  is possible without rewriting the runner.
- Model run context as the shared source for workflow inputs, prior step
  outputs, artifact metadata, retry state, and logs.
- Prefer file-based prompt assets for non-trivial prompts while
  retaining inline prompt text for simple workflows.
- Pass generated document content directly between steps during a run
  rather than introducing a separate read-file step in the MVP.
- Keep artifact conventions explicit so generated outputs can remain in
  memory, be logged, or be written to disk depending on workflow
  intent.
- Provide two sample workflows as first-class product deliverables: one
  that produces a PRD draft from an idea input and one that produces a
  task list draft from a PRD input.
- Keep the CLI surface intentionally narrow. The initial command set
  only needs enough behavior to run a workflow with inputs and expose
  where outputs and logs were written.
- Exclude local step libraries, third-party step packages, conditional
  flow control, loops, pause-resume behavior, and persisted execution
  state from MVP design and implementation.
- Defer schema-driven step inputs and outputs until after the MVP. The
  first release should rely on validation of required fields and
  normalized JSON object outputs instead.

## Testing Decisions

- Good tests should verify observable behavior, not internal
  implementation details. For this MVP that means validating parse and
  validation outcomes, resolved values, step outputs, CLI-visible
  failure modes, produced logs, and written artifacts rather than
  private helper calls.
- The workflow validator should be tested with valid and invalid YAML
  shapes, duplicate step ids, missing required fields, invalid
  references, and retry default handling.
- The reference and template resolver should be tested as an isolated
  deep module because it is central to both execution correctness and
  author experience.
- The linear runner should be tested with short fixture workflows that
  prove ordering, context propagation, retry behavior, stop-on-failure
  semantics, and artifact visibility.
- Each built-in step should have behavior-focused tests: prompt output
  normalization, file writing behavior, and log emission behavior.
- The CLI entry path should have at least one end-to-end smoke test that
  runs a small workflow fixture with provided inputs and asserts visible
  outputs and artifacts.
- Prompt backend interactions should be isolated behind a fake or
  stubbed adapter in tests so runtime behavior can be verified without
  depending on live backend calls.
- There is no existing test prior art in the current repository. The
  MVP should establish the initial testing style and keep it consistent
  across unit-level deep modules and one or two integration fixtures.

## Out of Scope

- Human approval gates.
- Conditional branches, loops, and other non-linear control flow.
- Persisted resume support or long-running workflow orchestration.
- Third-party step packages and local step library loading.
- Rich structured outputs backed by explicit schemas.
- Multiple prompt providers or a pluggable backend marketplace.
- A separate read-file step for document handoff.
- Distributed execution, remote agents, or multi-user coordination.
- Production-grade workflow observability beyond basic logs and
  inspectable artifacts.

## Further Notes

- The repository currently contains planning only and no implementation
  modules yet, so this PRD assumes a greenfield MVP build.
- The strongest deep-module candidates are the validator, resolver, and
  linear runner because they concentrate core behavior behind stable
  interfaces.
- The main product risk remains prompt output quality for downstream
  automation until stronger structured contracts are added after MVP.
- Automatic GitHub issue submission could not be completed from the
  current repository state because the git configuration has no remote
  wiring. This PRD therefore serves as the issue-ready draft.
