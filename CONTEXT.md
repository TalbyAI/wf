# Context

## Purpose

This document captures the domain language for Talby's workflow engine planning documents.
It records domain terms only; implementation details belong in design specs and code.

## Ubiquitous language

### ExecutableDefinition

A reusable, versioned executable type contract.
It declares input and output contracts plus capability and policy requirements.
It does not represent a workflow instance.

### ExecutableNode

An authored node instance inside a workflow.
It references a versioned executable type id and binds concrete inputs, configuration, and optional child structure.

### Core control-flow set

The initial normative core control-flow operators are `Sequence`, `If`, `Loop`, `Try`, and `Parallel`.
`ParallelMap` and `FanIn` are extension operators and are out of scope for the initial core line.

### Explicit runtime binding

Environment-derived values and secrets are never ambiently readable by node logic.
They are available only when workflow configuration explicitly binds them into node inputs or scoped values.

### Atomic output publication

For atomic executable nodes, the published output comes from the handler success return value.
Handlers do not publish outputs through execution-context command methods.

### Skipped execution state

`Skipped` means a node was intentionally not executed by workflow semantics (for example, a non-selected branch).
`Skipped` is not a failure state.
Workflows may still complete successfully when some nodes are `Skipped`, provided the declared output contract is satisfied.

### Internal-result and public-result boundary

Runtime execution states may include `Success`, `Failure`, `Skipped`, and `Cancelled`.
Public workflow APIs return output on success, surface `Failure` and `Cancelled` through `FrameworkError`, and keep `Skipped` as internal execution detail unless explicitly requested.
`Cancelled` is terminal in the public API and never maps to success output.
Outputs produced before cancellation remain internal inspection data in execution context diagnostics/artifacts.
If cancellation and timeout race, `Cancelled` takes public precedence and timeout is kept only as secondary diagnostic metadata.

### Canonical diagnostic event metadata

For `Failure`, `Cancelled`, and `Skipped` diagnostic events, the minimum required fields are:
`runId`, `nodeId`, `nodeType`, `state`, `timestamp`, `reasonCode`, `executionPath`, and `eventRole` (`primary` or `secondary`).
`executionPath` is an ordered array of `nodeId` values from the workflow root to the current node.
`timestamp` is an RFC 3339 / ISO 8601 UTC instant (for example, `2026-05-01T11:22:13.123Z`).
`nodeType` uses the canonical versioned executable type identifier (for example, `core.log@1`), not an engine-local free-form label.
`reasonMessage` and `parentNodeId` are optional but recommended.

## Terminology mappings

- `ActionStep` (legacy) -> atomic `ExecutableNode`.
- `StepTypeReference` (legacy) -> versioned executable type identifier referenced by `ExecutableNode`.
- `StepDefinition` (legacy in integration docs) -> atomic `ExecutableDefinition`.

## Language rule for planning documents

Planning documents should prefer canonical terms from this file and `docs/planning/core-design.md`.
If a legacy term is retained for historical clarity, the document must include an explicit local mapping section.
