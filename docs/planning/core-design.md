# Core Design

## Status

This document is normative for Talby's workflow engine core model and execution semantics.
The implementation should be derived from this document, and other planning documents must align with it.

It replaces the earlier concept sketch. The goal is to describe the concrete model the codebase should implement, aligned with the IR specification and the Effect integration blueprint.

## Normative precedence

When documents disagree, use this precedence order:

1. `docs/planning/core-design.md` is the normative source for core model, semantics, and terminology.
2. `docs/planning/execution-workflow-ir-specification.md` is supporting IR analysis and may retain historical terms.
3. `docs/planning/effect-integration-blueprint.md` is integration guidance for runtime and API design.

Supporting documents must either adopt canonical terms directly or include an explicit terminology mapping section.

## Terminology mapping (canonical vs legacy)

Canonical terms in this document:

- `ExecutableDefinition`: reusable, versioned executable type contract.
- `ExecutableNode`: authored workflow node instance that references an executable type id and binds configuration and inputs.

Legacy or alias terms that may appear in supporting documents:

- `ActionStep` maps to an atomic `ExecutableNode`.
- `StepTypeReference` maps to the versioned executable type identifier referenced by `ExecutableNode`.

When a supporting document uses a legacy term, it must define this mapping explicitly near first use.

## Core Decisions

### 1. Executable definitions and executable nodes are separate

- `ExecutableDefinition` is a reusable, versioned type contract.
- `ExecutableNode` is an in-workflow instance that references a definition by versioned type id and binds concrete configuration, inputs, and child structure.
- Definitions do not contain a method that creates runnable elements.
- The engine owns compilation from `ExecutableNode` to runnable executable nodes through a registry.

This keeps reusable contracts separate from authored workflow structure.

### 2. All IR elements are executable descriptions, but control flow is engine-owned

- Atomic action nodes and control-flow nodes both participate in the executable model.
- Core control-flow definitions such as `Sequence`, `If`, `Loop`, `Try`, and `Parallel` are compiled by the engine.
- Only atomic executable definitions accept user or plugin handlers.
- Control-flow nodes do not expose public custom handlers.

This preserves a uniform model without letting plugins redefine workflow semantics.

### 3. Registry resolution is explicit and split by node family

- Executable nodes reference executable types by explicit versioned identifiers such as `core.log@1`.
- The engine resolves those identifiers through a registry.
- The registry uses separate builder contracts for atomic nodes and core control-flow nodes.
- Atomic builders handle plugin-provided executable definitions.
- Control-flow builders remain engine-owned.

This makes the semantic split explicit and easier to type.

### 4. Definitions carry input and output contracts, not ambient runtime access

- Definitions declare `inputSchema` and `outputSchema`.
- There is no separate ambient `env` access from step logic.
- Runtime values from `env`, secrets, prior outputs, or scoped variables must be assigned explicitly into node inputs or scoped values.
- The earlier idea that step handlers read `env` directly is rejected.

The handler contract stays focused on declared input, not ambient process state.

### 5. Dataflow is explicit

- Nodes receive values through explicit input bindings.
- Bindings may resolve at runtime when they depend on execution state.
- Inputs may draw from workflow inputs, previous node outputs, scoped variables, literals, or other allowed runtime sources.
- Environment values are allowed only when the workflow explicitly maps them into step inputs or scoped values.

This keeps workflows inspectable and keeps hidden dependencies out of step logic.

### 6. Scope is first-class in the IR

- Scope is not just a runtime convenience.
- Compound nodes define lexical scope boundaries.
- Sub-nodes may receive a scoped context with controlled visibility into outer variables.
- Outer variables may be readable, blocked, or shadowed depending on the node kind.
- `Parallel` is intentionally stricter: branches may only access values explicitly declared by the parallel node itself, and those imported values are read-only.

Scope rules must therefore be represented in the IR, not hidden in engine internals.

### 7. Capabilities are definition-first

- Capability and permission requirements live primarily on executable definitions.
- Executable nodes may narrow, parameterize, or bind those declared capability slots.
- Executable nodes do not invent entirely new capabilities beyond what the definition contract allows.

This keeps executable definitions meaningful as reusable security contracts.

### 8. Outputs are explicit and uniform

- Every executable node may declare a typed output contract.
- Structural nodes do not get implicit output propagation from children.
- If a structural node publishes output, that output must be defined explicitly by its own semantics.
- Each node publishes exactly one output value.
- If multiple pieces of data are needed, they must be represented inside that single output value's schema.

This avoids hidden output rules and keeps persistence and binding simple.

### 9. Atomic handler return value is the published output

- For atomic executable nodes, the handler success value is the node's published output.
- The engine validates that value against the node definition's `outputSchema`.
- Handlers must not publish node outputs procedurally through execution context commands.

This keeps handlers idiomatic for Effect and keeps output typing straightforward.

### 10. Public API stays clean; execution details live in context

- Public execution should continue to follow the Effect blueprint's clean API direction.
- Success returns workflow output.
- Failures live in the error channel.
- Execution details are carried in `ExecutionContext`, not mixed into the public success payload.
- Callers that need inspection provide or access an `ExecutionContextProvider`.
- The default engine should create a root provider automatically when the caller does not supply one.

This preserves usability while still supporting deep inspection and durable engines.

### 11. Expressions use a small bounded DSL

- Conditions and other computed bindings may use a simple expression DSL.
- The DSL is intentionally bounded and pure.
- Initial scope: literals, context references, property access, indexing, comparisons, boolean operators, arithmetic, and object or array literals.
- No function calls in the initial version.
- Expressions may reference outputs, scoped variables, workflow inputs, and other approved bound sources.
- Expressions must not give steps ambient access to `env`; workflows must bind environment values explicitly first.
- Expressions should be statically type-checked as much as possible during validation, with runtime checks reserved for genuinely dynamic cases.

This allows expressive bindings without turning the IR into a second unrestricted programming language.

### 12. Workflow outputs are explicitly mapped

- Workflow output is not defined by "the last node wins".
- `WorkflowDefinition` declares an `outputSchema`.
- The workflow also declares explicit output bindings that map allowed sources into that schema.

This keeps the workflow contract stable even when internal orchestration changes.

### 13. Initial core control-flow scope is intentionally bounded

- The initial core control-flow set is: `Sequence`, `If`, `Loop`, `Try`, and `Parallel`.
- `ParallelMap` and `FanIn` are intentionally out of scope for the initial core line.
- They may be specified later as explicit extensions once their semantics are fully defined.

This keeps the first implementation target precise and avoids semantic ambiguity in early engine behavior.

### 14. Internal execution states and public API results are intentionally different layers

- The engine runtime tracks internal terminal execution states such as `Success`, `Failure`, `Skipped`, and `Cancelled`.
- Public workflow execution APIs remain success-output oriented and do not expose those internal states as a direct success payload.
- Internal `Failure` and `Cancelled` states are projected to the Effect fail channel as `FrameworkError` variants.
- Internal `Skipped` state remains an execution detail available through execution context diagnostics and artifacts, not a default public payload field.

This keeps runtime semantics expressive while preserving a clean and stable public contract.

## Core Model

### `ExecutableDefinition`

A reusable, versioned contract for an executable type.

Expected responsibilities:

- stable type id and version
- human-readable metadata
- `inputSchema`
- `outputSchema`
- capability and permission requirements
- implementation metadata needed by the engine registry

Expected non-responsibilities:

- no `createExecutableNode()` method
- no direct binding to workflow instance ids
- no ownership of runtime scope state

### `ExecutableNode`

A concrete authored node in a workflow.

Expected responsibilities:

- local node id
- referenced type id
- configured input bindings
- node-level config payload, if needed by the referenced definition
- child structure for compound nodes
- scope imports, locals, and exports when applicable
- node-level narrowing or parameterization of declared capability slots
- optional node-level policy overrides

### `ExecutionContext`

Execution state carried through execution paths.

It should include at least:

- execution metadata such as run id, timestamps, and lineage
- current node metadata
- call stack or execution path metadata
- accessible scoped values
- readonly view of imported outer scope values when allowed
- published outputs from executed nodes
- diagnostics and artifacts
- other engine-managed execution details needed for tracing or persistence

Important constraint:

- step logic should not treat `env` as ambient readable state
- any environment-derived value must first be bound into explicit inputs or scoped values by workflow configuration

### `ExecutionContextProvider`

The substrate that owns the root execution context and context lifecycle.

Responsibilities:

- create the root execution context
- create child scoped contexts during execution
- retain execution details for later inspection when desired
- support different persistence strategies across engines

API direction:

- advanced callers may provide one explicitly
- the default engine should create an in-memory provider automatically when omitted

### `ExecutionEngine`

The engine is responsible for:

- validating workflow definitions and bindings
- resolving type ids through the registry
- compiling executable nodes into runnable executable nodes
- enforcing control-flow semantics
- managing scope boundaries and child contexts
- enforcing capability and permission policy
- validating input and output contracts
- recording diagnostics, artifacts, and execution metadata

## Binding and Scope Model

### Inputs

- Each node receives explicit bound input.
- Bindings may be static or runtime-resolved.
- Bindings may reference:
  - workflow inputs
  - prior node outputs
  - scoped variables
  - literals
  - explicitly imported environment-derived values
  - pure expressions over those values

### Scope

- Scope is lexical and explicit.
- Compound nodes create scope boundaries.
- Nodes may import readonly values from outer scope.
- Nodes may create local writable values in their own scope.
- Exporting values outside a scope boundary must be explicit.
- `Parallel` branches receive only explicitly declared readonly imports from the parallel node and cannot reach arbitrary outer scoped values.

## Output and Result Model

### Node output

- Every node may publish one typed output value.
- Atomic node output comes from the handler success value.
- Structural node output, when present, is defined explicitly by that node's semantics.

### Workflow output

- Workflow output is built through an explicit output binding map.
- The published workflow output must satisfy the workflow `outputSchema`.

### Public execution result

- Public execution APIs should remain success-output oriented.
- Errors should remain in the Effect error channel.
- Execution details remain accessible through execution context and provider mechanisms, not through a bloated success payload.

### Internal execution-state projection

- Internal runtime states include `Success`, `Failure`, `Skipped`, and `Cancelled`.
- `Skipped` means a node was intentionally not executed by workflow semantics (for example, a non-selected `If` branch).
- `Skipped` is not a failure and is not cancellation.
- Public success returns workflow output only.
- `Failure` and `Cancelled` are surfaced through the Effect fail channel as `FrameworkError` variants.
- If cancellation and timeout race in the same execution window, `Cancelled` takes precedence for the public error projection.
- In that race, timeout is retained as secondary diagnostic data in execution context records.
- `Cancelled` is terminal for public workflow execution and cannot produce a public success result.
- If cancellation happens after partial progress, partial outputs remain inspection data in execution context diagnostics and artifacts, not in the public success payload.
- A workflow may still finish in public success when some nodes are `Skipped`, as long as workflow output bindings and `outputSchema` are satisfied.
- `Skipped` remains an internal detail unless explicitly surfaced by a dedicated inspection API.

### Diagnostic event metadata (minimum conformance set)

For execution-state diagnostics, engines must record at least the following fields for `Failure`, `Cancelled`, and `Skipped` events:

- `runId`
- `nodeId`
- `nodeType`
- `state`
- `timestamp`
- `reasonCode`
- `executionPath`
- `eventRole` with values `primary` or `secondary`
The following fields are optional but recommended:

- `reasonMessage`
- `parentNodeId`

`executionPath` is required for deterministic cross-engine trace reconstruction and must be an ordered array of `nodeId` values from the workflow root to the current node.
`timestamp` must be encoded as an RFC 3339 / ISO 8601 UTC instant (for example, `2026-05-01T11:22:13.123Z`).
`nodeType` must use the canonical versioned executable type identifier (for example, `core.log@1`), not an engine-local free-form label.
`eventRole` is required to distinguish primary public error projections from secondary contextual events (for example, timeout recorded as secondary when cancellation wins a race).

## Design Consequences

This design implies:

- validation must understand bindings, scope, and expression typing
- the IR must represent scope boundaries directly
- control-flow nodes need engine-owned compile and execution semantics
- step handlers stay simpler because they consume typed input and return typed output
- observability and durability should attach to execution context management, not to ad hoc return payload growth

## Superseded Ideas

The following earlier ideas are no longer the target design:

- executable definitions constructing runnable nodes directly
- step logic reading `env` directly from ambient context
- a fully open mutable shared `kv` bag with no lexical boundaries
- implicit workflow output based on final-node position
- multi-slot node outputs as a first-class default model

