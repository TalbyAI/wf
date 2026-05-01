# Effect Library Integration Blueprint

**Status:** Architecture locked, ready for implementation  
**Scope:** Talby Workflow Framework core alpha line (engine-first + Effect runtime)  
**Release Train:** `0.1.0-alpha` then `0.2.0-alpha`; API may evolve before `1.0.0`

## Terminology alignment with Core Design

`docs/planning/core-design.md` is normative for core model terminology.
Within this blueprint, interpret terms using the following mapping:

- `StepDefinition` corresponds to an atomic `ExecutableDefinition`.
- Step instance identifiers (for example `stepId`) correspond to `ExecutableNode.id`.
- Step type identifiers correspond to the versioned executable type id referenced by `ExecutableNode`.

When this blueprint and Core Design differ in naming, Core Design naming takes precedence.

---

## Decision Summary

| Decision | Choice | Rationale |
| --- | --- | --- |
| **Architecture** | Effect-first core with a public `WorkflowEngine` abstraction | Pluggable execution model with stable orchestration contract |
| **Failure Contract** | Success channel returns only schema-compliant workflow output record; failures live in Effect fail channel (`FrameworkError`) | Keeps success path clean and type-safe while preserving diagnostics |
| **Execution Context** | Engine-owned `WorkflowExecutionContext` dependency with command API (`recordDiagnostic`, `recordArtifact`, `readState`); atomic outputs are published from handler return values | Consistent behavior across in-memory and durable engines |
| **Persistence Strategy** | Engine decides persistence backend (in-memory default engine, optional Redis/Postgres engines) | Supports both lightweight and robust deployments |
| **Timeout/Cancellation** | Per-step override ships in `0.1.0-alpha`; precedence is `step > workflow > engine defaults`; engine may enforce hard safety ceilings; if cancellation and timeout race, cancellation wins and timeout is recorded as secondary diagnostic | Predictable workflow semantics with operator guardrails |
| **Public API Surface** | Usability-first default APIs with hidden requirements (`... , never`) plus advanced lower-level APIs with explicit requirements | Smooth adoption without blocking advanced integrations |
| **Data Governance** | Persist broad non-sensitive diagnostics by default; prompts, secrets, and raw step payloads are opt-in and redacted by policy | Balances operability with privacy/compliance risk control |
| **Compatibility** | Thin promise-based compatibility layer in `0.1.0-alpha` and `0.2.0-alpha`; remove before `1.0.0` | Reduces migration friction while keeping cleanup deadline explicit |
| **Wrapper Package** | Separate simplified package remains on-demand only | Avoids premature maintenance burden |

---

## Decision Record (Locked)

| ID | Date | Decision | Status | Notes |
| --- | --- | --- | --- | --- |
| DR-001 | 2026-04-30 | Per-step timeout override ships in `0.1.0-alpha` | Locked | Removed prior phase/checklist contradiction |
| DR-002 | 2026-04-30 | Success result contains output only; failure details stay in `FrameworkError` | Locked | Success path now schema-focused |
| DR-003 | 2026-04-30 | `WorkflowExecutionContext` is engine-owned and stores diagnostics/intermediate state | Locked | Engine decides persistence strategy |
| DR-004 | 2026-04-30 | Core exposes public `WorkflowEngine`; default engine is in-memory | Locked | Durable engines may use Redis/Postgres |
| DR-005 | 2026-04-30 | Handlers use context command API (`recordDiagnostic`, `recordArtifact`, `readState`); atomic output publication is engine-managed from handler return values | Locked | Prevents uncontrolled shared-state writes while keeping output publication unambiguous |
| DR-006 | 2026-04-30 | Default API hides Effect requirements; advanced API exposes explicit requirements | Locked | Balances ergonomics and extensibility |
| DR-007 | 2026-04-30 | Timeout precedence is `step > workflow > engine defaults`; engine may enforce hard ceilings; cancellation wins timeout races | Locked | Ensures predictable behavior across engines and deterministic public error projection |
| DR-008 | 2026-04-30 | Data governance persists broad non-sensitive diagnostics; sensitive fields are opt-in + redacted | Locked | Baseline privacy/compliance policy |
| DR-009 | 2026-04-30 | Promise compatibility shim exists only in `0.1.0-alpha` and `0.2.0-alpha` | Locked | Planned removal before `1.0.0` |
| DR-010 | 2026-04-30 | Early releases are alpha (`0.1.0-alpha`, `0.2.0-alpha`) | Locked | Allows intentional API evolution pre-1.0 |

---

## Core API Design (Minimal, Pseudo-Code)

### Entry Points

Core exports engine-first APIs plus temporary compatibility wrappers:

```typescript
// Main construction
createWorkflowEngine(config?) => WorkflowEngine

// Primary usage (default engine hides requirements)
WorkflowEngine.runWorkflowFile(path, options?) => Effect<WorkflowOutputRecord, FrameworkError, never>
WorkflowEngine.validateWorkflow(source, options?) => Effect<ValidationReport, FrameworkError, never>

// Advanced usage (explicit requirements)
runWorkflowEffect(path, options?) => Effect<WorkflowOutputRecord, FrameworkError, Requirements>

// Alpha-only compatibility wrapper (deprecated)
legacyRunWorkflow(path, options?) => Promise<WorkflowOutputRecord>

options = {
  timeout?: { default, stepOverrides? },
  cancellation?: { signal, stepExceptions? },
  retryPolicy?: ...,
  promptBackend?: ...,
  executionContext?: WorkflowExecutionContext
}
```

### Result and Error Shape

Success payload is output-only. Error channel carries failure details.

Internal runtime state may still include `Success`, `Failure`, `Skipped`, and `Cancelled` for node/workflow semantics.
Public API projection keeps this boundary explicit:

- success channel returns workflow output only,
- `Failure` and `Cancelled` are surfaced in the fail channel as `FrameworkError` variants,
- if cancellation and timeout race, `Cancelled` is surfaced publicly and timeout is recorded only as secondary diagnostic context,
- `Cancelled` is terminal for public workflow execution and cannot return a success payload,
- outputs generated before cancellation are retained only as internal execution-context diagnostics/artifacts,
- `Skipped` remains an internal execution-context detail by default.
- `Skipped` means intentionally not executed by workflow semantics and does not imply failure on its own.
- Workflows may still succeed with `Skipped` nodes when the declared output contract is satisfied.

Diagnostic events referenced by execution context data should follow this minimum conformance set:

- `runId`
- `nodeId`
- `nodeType`
- `state`
- `timestamp`
- `reasonCode`
- `executionPath`
- `eventRole` (`primary` or `secondary`)

Optional but recommended:

- `reasonMessage`
- `parentNodeId`

`executionPath` must be encoded as an ordered array of `nodeId` values from the workflow root to the current node.
`timestamp` must be encoded as an RFC 3339 / ISO 8601 UTC instant (for example, `2026-05-01T11:22:13.123Z`).
`nodeType` must use the canonical versioned executable type identifier (for example, `core.log@1`), not an engine-local free-form label.

```typescript
WorkflowOutputRecord = {
  workflowName,
  runId,
  duration,
  output // validated against workflow output schema
}

FrameworkError = discriminated union of:
  ValidationError,
  ExecutionError,
  TimeoutError,
  CancellationError,
  PromptError,
  PersistenceError,
  ...

// Error variants may include contextual pointers
ExecutionError = {
  kind: "ExecutionError",
  message,
  failedStep?,
  diagnosticsRef? // points to WorkflowExecutionContext data/artifact
}
```

### Execution Context and Handlers

Internal handlers use Effect and interact with context through command methods.
Atomic node output publication is engine-managed from the handler success return value.

```typescript
StepHandler<T> = (context) => Effect<T, FrameworkError, Dependencies>

WorkflowExecutionContext = {
  readState(key): Effect<unknown, FrameworkError, never>,
  recordDiagnostic(event): Effect<void, FrameworkError, never>,
  recordArtifact(artifact): Effect<void, FrameworkError, never>
}

StepDefinition = {
  id, type, handler,
  timeout?, canBeCancelled?, retryPolicy?
}
```

---

## Package Structure

```text
packages/core/
├── src/
│   ├── engine/
│   │   ├── WorkflowEngine.ts
│   │   ├── defaultEngine.ts
│   │   └── compat.ts
│   ├── context/
│   │   ├── WorkflowExecutionContext.ts
│   │   ├── inMemoryContext.ts
│   │   └── policies.ts
│   ├── handlers/
│   │   ├── executeStep.ts
│   │   ├── resolvePrompt.ts
│   │   ├── validateWorkflow.ts
│   │   └── recordArtifact.ts
│   ├── policies/
│   │   ├── timeout.ts
│   │   ├── cancellation.ts
│   │   ├── retry.ts
│   │   └── data-governance.ts
│   ├── runtime.ts
│   ├── errors.ts
│   ├── types.ts
│   ├── index.ts
│   └── index.test.ts
├── package.json
└── tsconfig.json
```

---

## Implementation Phases

### Phase 1: Engine-First Effect Core (`0.1.0-alpha`)

1. **Effect and Runtime Foundation**
   - Add `effect` to core package
   - Build runtime/layer composition for default engine

2. **Public Engine Contract**
   - Introduce `WorkflowEngine` interface
   - Keep `runWorkflowFile` convenience API over default engine

3. **Output-Only Success Contract**
   - Return `Effect<WorkflowOutputRecord, FrameworkError, ...>`
   - Remove error fields from success payload

4. **Execution Context Command API**
   - Add `recordDiagnostic`, `recordArtifact`, `readState`
   - Publish atomic node output from handler success return values and validate against node `outputSchema`
   - In-memory default engine stores context in memory (optional audit logging)

5. **Timeout/Cancellation Baseline**
   - Ship per-step timeout override in `0.1.0-alpha`
   - Implement precedence rule: `step > workflow > engine defaults`
   - If timeout and cancellation race, surface `CancellationError` and record timeout as secondary diagnostic context
   - Allow engine hard safety ceilings

6. **Alpha Compatibility Shim**
   - Add thin promise-based compat path
   - Mark as deprecated immediately

### Phase 2: Engine Hardening (`0.2.0-alpha`)

1. Improve cancellation propagation and retry interactions
2. Stabilize governance/redaction policies for durable engines
3. Add advanced APIs with explicit Effect requirements
4. Keep compatibility shim, but gate new features behind engine-first API

### Phase 3: Documentation and Beta Readiness

1. Publish API reference for engine-first and advanced APIs
2. Migration guide from current promise API to engine-first Effect API
3. Examples for in-memory and durable context strategies
4. Benchmarks (runtime overhead, context persistence impact)

### Phase 4: `1.0` Prep and Wrapper Decision

1. Remove alpha compatibility shim before `1.0.0`
2. Confirm wrapper-package demand based on concrete internal use case

---

## Test Strategy

### Coverage by Concern

| Concern | Test Type | Notes |
| --- | --- | --- |
| **Effect Semantics** | Unit | Handler composition, error propagation, layer behavior |
| **Timeout/Cancellation** | Integration | Step override, workflow defaults, engine ceilings, cancellation mid-step, and cancellation-vs-timeout race precedence |
| **Result Accuracy** | Integration | Success output matches output schema; errors only in fail channel |
| **Execution Context** | Integration | Command API behavior across in-memory and durable adapters |
| **Data Governance** | Integration | Redaction/opt-in behavior for sensitive payload categories |
| **Compatibility (Alpha)** | Integration | Legacy promise path parity and deprecation coverage |

### Test Approach (Pseudo-Code)

```typescript
test("engine.runWorkflowFile returns Effect<WorkflowOutputRecord, FrameworkError, never>")
test("success path returns schema-compliant output only")
test("failure path exposes FrameworkError with diagnosticsRef")
test("timeout precedence: step > workflow > engine defaults")
test("cancellation wins timeout race; timeout is retained as secondary diagnostic context")
test("diagnostic events include the minimum conformance metadata fields")
test("engine safety ceiling overrides excessive timeout")
test("execution context command API records diagnostics and artifacts")
test("sensitive fields are excluded unless explicitly opt-in")
test("legacyRunWorkflow remains functional in alpha and is marked deprecated")
```

---

## Migration Path (Current API → Alpha Engine API)

### Key Changes

| Current | Alpha (`0.1`/`0.2`) | Impact | Migration |
| --- | --- | --- | --- |
| Promise-first `runWorkflowFile` | Engine-first Effect API | Medium | Use `createWorkflowEngine().runWorkflowFile(...)` |
| Success payload may contain failure data | Success payload is output-only | Medium | Read failure details from `FrameworkError` fail channel |
| Ad-hoc runtime state | Explicit `WorkflowExecutionContext` service | Medium | Route diagnostics/artifacts through command API |
| No explicit precedence contract | `step > workflow > engine`, plus safety ceilings | Low | Update policy configuration docs/tests |

### Compatibility Layer (Alpha Only)

```typescript
// packages/core/src/engine/compat.ts
legacyRunWorkflow(path, options?) => Promise<WorkflowOutputRecord>

// Exists in 0.1.0-alpha and 0.2.0-alpha only.
// Planned removal before 1.0.0.
```

---

## Release Checklist (`0.1.0-alpha`)

- [ ] **Code**
  - [ ] Effect runtime and public `WorkflowEngine` contract implemented
  - [ ] Output-only success contract (`WorkflowOutputRecord`) implemented
  - [ ] `FrameworkError` branches include execution/persistence failures
  - [ ] Per-step timeout override implemented with precedence rules
  - [ ] Execution context command API implemented for default in-memory engine
  - [ ] Alpha compatibility shim added and marked deprecated

- [ ] **Docs**
  - [ ] API reference for engine-first default APIs
  - [ ] Advanced API reference for explicit requirements path
  - [ ] Migration guide with legacy shim usage and removal timeline
  - [ ] Timeout/cancellation precedence and safety ceiling docs
  - [ ] Data governance policy docs (opt-in sensitive persistence)

- [ ] **Testing**
  - [ ] Effect semantics + integration coverage for success/failure channels
  - [ ] Timeout/cancellation precedence tests
  - [ ] Execution context and governance policy tests
  - [ ] Compatibility tests for legacy shim path
  - [ ] Baseline benchmark vs current runtime

- [ ] **Release**
  - [ ] Changelog entry for alpha API evolution policy
  - [ ] Tag: `v0.1.0-alpha`
  - [ ] Publish alpha package

---

## Release Checklist (`0.2.0-alpha`)

- [ ] Cancellation and retry hardening complete
- [ ] Durable context adapters documented and validated
- [ ] Advanced explicit-requirements APIs stabilized
- [ ] Legacy shim remains available, still deprecated
- [ ] Tag: `v0.2.0-alpha`

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Effect adoption curve for team | Medium | Focused examples and migration guide for engine-first path |
| Security drift across engines | High | Core governance policy + mandatory redaction/opt-in semantics |
| Alpha API churn confusion | Medium | Explicit alpha release policy and deprecation timeline |
| Timeout policy inconsistency across engines | Medium | Shared precedence contract and conformance tests |
| Simplified wrapper becomes debt | Low | Keep trigger criteria explicit and demand-driven |

---

## Next Steps

1. Create feature tracking issues for `0.1.0-alpha` milestones.
2. Implement `WorkflowEngine` and in-memory `WorkflowExecutionContext` first.
3. Land output-only success contract and `FrameworkError` mapping.
4. Add timeout precedence tests and governance/redaction tests.
5. Publish `0.1.0-alpha` with deprecated compatibility shim.
6. Execute hardening scope and publish `0.2.0-alpha`.
