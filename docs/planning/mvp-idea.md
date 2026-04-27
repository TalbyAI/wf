# Idea of MVP

The minimal PoC should be a CLI-first workflow runner with YAML
workflows and TypeScript step implementations. The YAML is the source
of truth. Each step has a stable id, a single `type` such as
`core.prompt` or `core.write-file`, and `${...}` references for wiring
inputs from workflow inputs and prior step outputs. The runner should
stay single-session for v1, with no persisted resume support, so the
first workflows must be machine-executable and short-lived.

The recommended PoC scope is two workflows only: idea → PRD draft, and
PRD → task list draft. That is enough to prove the core engine shape,
step output wiring, prompt templating, and YAML authoring model without
dragging in pause/resume, human approval gates, branching control flow,
or third-party step libraries.

## Decisions

- Use YAML for workflows and TypeScript for built-in step
  implementations.
- Allow only built-in steps in MVP. Local step libraries and third-party
  step packages are post-MVP.
- Name built-in steps with a single namespaced `type` field such as
  `core.prompt`, `core.write-file`, and `core.log`.
- Keep the first runtime small and linear. No branching, conditions,
  loops, or pause/resume in MVP.
- Model each step with explicit ids and JSON object outputs.
- Validate references and required fields before execution where
  possible, and fail fast on invalid workflows.
- Use the same `${...}` syntax everywhere, including workflow fields and
  prompt templates.
- Start with a simple prompt step that only generates text and returns
  `{ "answer": "..." }`.
- Keep persistence separate: `core.write-file` saves artifacts written
  by prior steps.
- Let prompt templates come from inline YAML text or referenced files,
  with file-based prompts preferred for non-trivial assets.
- Pass generated document content directly between steps in MVP instead
  of introducing a separate read-file step.
- Support a small explicit retry policy per step, with a simple default
  such as `0` or `1` retry.
- Hard-code a single execution backend in MVP. A provider adapter
  boundary can be introduced later if needed.
- Post-MVP, add per-step input and output schemas for stronger
  validation and better UX.
- Implement only idea → PRD and PRD → tasks in the first PoC.

## Minimal runtime shape

1. `workflow.yaml` loader plus fail-fast validation for step ids,
   references, and required inputs.
2. Built-in step registry keyed by namespaced `type` values such as
   `core.prompt`, `core.write-file`, and `core.log`.
3. Reference and template resolver for `${steps.<id>.output...}` and
   `${inputs.<name>}` across workflow fields and prompt bodies.
4. Shared run context object with workflow inputs, step outputs,
   artifacts, retry settings, and logs.
5. One concrete prompt execution backend wired directly into
   `core.prompt` for MVP.
6. Artifact conventions so prompt output can either stay in memory as
   JSON or be persisted by `core.write-file` when needed.

## Key tradeoffs

- Built-in-only steps keep the MVP deterministic and reviewable, but
  they defer ecosystem design and extension points.
- Linear execution cuts engine complexity sharply, but it disqualifies
  conditional or approval-heavy workflows until later.
- A pure `core.prompt` plus separate `core.write-file` keeps step
  boundaries clean, but it makes document workflows slightly more
  verbose.
- Passing content directly between steps avoids an early read-file step,
  but larger artifacts live in memory until explicitly written.
- Hard-coding one backend speeds delivery, but future backend support
  will require a later refactor.
- Keeping prompt output as `{ "answer": "..." }` is simple for MVP,
  but richer machine-readable contracts are deferred to post-MVP
  schemas.

## Main risks

- Prompt outputs may be too weak for downstream automation until
  schema-backed structured outputs arrive post-MVP.
- Large document handoffs can make in-memory step outputs bulky if
  workflows chain too much content without writing artifacts.
- Using `${...}` inside prompt bodies keeps one mental model, but
  escaping literal template text must stay simple and predictable.
- Hard-coded backend behavior may leak into step semantics if the
  runtime boundary is not kept narrow.
- Without resume, users may expect longer workflows than the engine
  should responsibly support.

## Concrete next steps

1. Define the MVP YAML shape for workflow inputs, linear steps,
   retries, and namespaced step `type` values.
2. Define the TS built-in step contract around `execute(step, context)`
   with JSON object outputs.
3. Implement `${...}` resolution and fail-fast workflow validation.
4. Implement the initial built-in catalog: `core.prompt`,
   `core.write-file`, and `core.log`.
5. Wire `core.prompt` to one concrete backend and normalize its output
   to `{ "answer": "..." }`.
6. Build one workflow for idea → PRD.
7. Build one workflow for PRD → tasks.
8. Add a sample run log and artifact folder structure so outputs are
   inspectable.
