## Final Plan

The minimal PoC should be a CLI-first workflow runner that reuses the repo’s existing prompt and agent assets instead of inventing a new end-to-end automation stack. Workflow definitions live in YAML. Step implementations live in TypeScript. The YAML is the source of truth, and it uses stable step ids plus Kestra-style input/output references such as `${steps.createPrd.output.path}`. The runner should stay single-session for v1, with no persisted resume support, so the first workflows must be machine-executable and short-lived.

The recommended PoC scope is two workflows only: idea → PRD draft, and PRD → task list draft. That is enough to prove the core engine shape, step output wiring, and YAML authoring model without dragging in pause/resume, human approval gates, or PR lifecycle complexity. The most relevant repo assets to wrap are tdp.create-tasks.prompt.md, tdp.implement-tasks.prompt.md, tdp.review.prompt.md, plan-squad.agent.md, and the routing summary in TEAM-CHEAT-SHEET.md.

**Decisions**
- Reuse existing prompts and agents first; do not build a standalone workflow ecosystem yet.
- Target Copilot CLI first, but keep a thin runner abstraction so VS Code can be added later.
- Use YAML for workflows and TypeScript for steps.
- Start with a small first-class step catalog, with custom TS only as an escape hatch.
- Model each step with explicit inputs, outputs, and YAML-defined ids.
- Use structured JSON outputs with lightweight per-step schemas and simple reference syntax.
- Keep v1 single-session only.
- Exclude human pause points from v1.
- Implement only idea → PRD and PRD → tasks in the first PoC.

**Minimal runtime shape**
1. `workflow.yaml` loader and validator.
2. Step registry in TS, likely `prompt`, `agent`, `shell`, `transform`, and `write-file`.
3. Reference resolver for `${steps.<id>.output...}`.
4. Shared run context object with workflow inputs, step outputs, temp artifacts, and logs.
5. Thin Copilot CLI adapter so prompt and agent steps can invoke existing repo assets consistently.
6. Output artifact conventions so one step can hand a file path or structured payload to the next.

**Key tradeoffs**
- YAML-first keeps authoring and review simple, but richer branching will eventually push logic into TS.
- Single-session execution cuts engine complexity sharply, but it disqualifies approval-heavy flows until resume exists.
- Reusing current prompts speeds delivery, but it couples the PoC to today’s prompt contract quality.
- Lightweight schemas catch common mistakes early, but they are not a full compile-time safety net.

**Main risks**
- Prompt outputs may not be structured enough unless each wrapped step normalizes them into stable JSON.
- File-path handoffs between steps can become brittle if prompt artifacts are not written predictably.
- Without resume, users may expect longer workflows than the engine should responsibly support.
- If custom TS handlers become common too early, YAML stops being the real control plane.

**Concrete next steps**
1. Define the YAML schema and the reference syntax.
2. Define the TS step contract: `input`, `execute`, `outputSchema`.
3. Implement the minimal step catalog.
4. Build one workflow for idea → PRD.
5. Build one workflow for PRD → tasks.
6. Add a sample run log and artifact folder structure so outputs are inspectable.

If you want, I can save this decision record next as either:
1. A new design note, for example `docs/specs/copilot-workflow-poc.md`
2. A repo-local prompt or agent design file
3. A `.tasks.md` implementation plan derived from this design