# Execution Workflow IR Specification

- Status: active
- Owner: TBD
- Start date: 2026-04-29
- Pillar: Execution
- Line: specification
- Next milestone: split this note into a formal IR schema note, execution semantics note, and core step catalog note

## Objective

Define the canonical intermediate representation for an execution system based on workflows, typed steps, structured control flow, and runtime-enforced capabilities.

## Context

Talby needs an execution model that can preserve continuity between intent, structure, permissions, runtime behavior, and reproducibility.

The working direction is a workflow framework that can express:

- logs and simple utility actions
- integrations with third-party systems
- git operations
- script and container execution
- interaction with different LLM providers
- structured control flow such as loops, branching, parallelism, and error handling

The framework must support two equivalent authoring surfaces:

- a typed DSL in code, starting with TypeScript
- a human-readable serialized form, such as YAML

The canonical source of behavior is the workflow IR shared by both surfaces.

## Scope

This workstream currently covers:

- the role of the canonical IR
- the executable node model
- the executable definition model
- the execution result model
- the context and scope model
- the capability and policy model
- versioning expectations for step types

This workstream does not yet cover:

- detailed YAML schema design
- exact TypeScript SDK syntax
- persistence, scheduling, or distributed coordination
- secrets management backend design
- the formal error payload shape
- the formal suite format for conformance tests

## Current Status

An initial working specification exists below. It is strong enough to guide follow-up design, but still includes unresolved semantic questions that should be split into narrower notes.

## Next Steps

- define the exact node schema for the canonical IR
- define execution semantics and typed result propagation
- define the first core step catalog and its conformance strategy

## Risks

- context and scoped values may become an implicit dependency layer if their rules stay too loose
- `FanIn` and typed failures still need precise structure
- capability namespaces may become weak metadata unless the grammar and enforcement model are explicit
- step version compatibility is still schema-first, which may leave semantic drift under-specified

## Working Specification

### Design Principles

1. The IR is the product.
   The DSL, YAML, validators, and runtimes are frontends or executors for the same semantic model.

2. Structure beats convenience.
   Control flow must be represented as explicit nodes in the workflow tree, not hidden in expressions or host-language code.

3. Contracts are mandatory.
   Every step, including user-defined script steps, must declare input shape, output shape, and operational constraints.

4. Execution is capability-bound.
   A workflow becomes runnable only when validated against a concrete runtime capability set.

5. Reproducibility matters.
   Step type versions must be resolved explicitly before execution.

### Canonical IR Model

The workflow IR is a structured tree of nodes.

A workflow is closer to a structured program than to a free DAG. The allowed control constructs are explicit and compositional. Arbitrary jumps and implicit graph edges are out of scope.

#### Root Entities

The canonical model should contain at least these root entities:

- `WorkflowDefinition`
- `WorkflowInputSchema`
- `ExecutableNode`
- `StepTypeReference`
- `ExecutableDefinition`
- `ExecutionPolicy`
- `CapabilityRequirement`
- `ExecutionResult`

#### WorkflowDefinition

A workflow definition should include:

- workflow identity and metadata
- workflow input schema
- workflow output declaration, when applicable
- the root node or root sequence of nodes
- workflow-level policies and defaults
- runtime requirements, if declared separately from step requirements

#### ExecutableNode

Every executable element in the workflow is a node.

At minimum, node kinds should include:

- `ActionStep`
- `Sequence`
- `If`
- `Loop`
- `Try`
- `Parallel`
- `ParallelMap`
- `FanIn`

Each node should have:

- a stable local identifier
- a node kind
- optional metadata for labeling, tracing, and documentation
- optional inherited policy overrides
- explicit child nodes when the node is compound

### Executable Definition Model

An atomic step is not just an implementation target. It is a typed capability contract.

Each executable definition should declare:

- `inputSchema`
- `outputSchema`
- `requiredCapabilities`
- `filesystemPermissions`
- `networkPermissions`
- `executionTimeout`
- retry-related defaults, when owned by the step type
- implementation metadata needed by the runtime

#### Step Types

Step types may represent built-in operations or plugin-provided capabilities, such as:

- logging
- HTTP calls
- git interactions
- container execution
- host script execution
- LLM provider calls

#### Script-Based Steps

Script-based steps are allowed, including scripts written in TypeScript or Python.

They remain valid workflow steps only if they still declare, in the DSL or serialized form:

- input schema
- output schema
- requested capabilities
- filesystem and network permissions
- timeout and operational limits

The script body may be user-defined, but the workflow engine must still be able to validate and enforce the declared contract around that script.

### Context And Scope Model

Steps execute against a runtime context.

That context may expose:

- workflow inputs
- outputs from previously executed steps
- scope variables
- runtime-provided environment variables
- runtime-provided secrets
- operational metadata such as execution identifiers

#### Context Rules

The context is not a free-form mutable memory store.

The model should preserve these constraints:

- outputs from completed steps remain addressable
- scope variables may be introduced and consumed by later nodes
- overriding a value must be an explicit and visible operation, not an incidental mutation
- context access should remain inspectable enough to support tracing and debugging

The purpose of scope variables is ergonomic indirection, not to hide workflow structure.

### Data Flow Model

The workflow model supports access to prior outputs and scoped values through the execution context.

This does not remove the need for explicit structure. The engine should preserve a clear distinction between:

- workflow inputs
- step outputs
- scoped variables
- runtime environment and secrets

This distinction matters for validation, replay, and security.

### Control Flow Model

Control flow is represented by compound nodes, not by an embedded expression language.

The IR should not rely on a powerful inline transformation or templating language. Conditions, loops, and error handling are first-class workflow operators.

#### Sequence

`Sequence` runs child nodes in declared order.

#### If

`If` chooses among explicit child branches according to structured conditions.

The condition evaluation mechanism is still open, but it should remain declarative and bounded.

#### Loop

`Loop` repeats a structured child workflow under declared iteration semantics.

Retry remains atomic at child step level, though loop-level policy defaults may be inherited by descendants.

#### Try

`Try` provides explicit error-handling structure through child branches or handlers.

#### Parallel

`Parallel` runs heterogeneous branches concurrently.

The author, not the runtime, decides where concurrency exists.

`Parallel` may expose settings such as:

- maximum concurrency
- branch-level policies
- result ordering semantics, when relevant

#### ParallelMap

`ParallelMap` applies a structured child workflow to each item of an input collection.

It may expose settings such as:

- maximum concurrency
- collection ordering behavior
- item result ordering behavior

#### FanIn

`FanIn` is an explicit convergence operator.

It must be able to receive structured success and failure outcomes from upstream parallel work, rather than only succeeding when every branch succeeds.

The exact error payload model remains open, but the capability to aggregate partial results is required.

### Execution Result Model

Execution results must be explicit values, not only exceptional control interruptions.

At minimum, the model should support terminal states such as:

- `Success`
- `Failure`
- `Skipped`
- `Cancelled`

This result model should apply consistently across atomic steps and compound nodes, even if their internal semantics differ.

The exact payload of `Failure` and `Cancelled` remains open, but the system should treat execution state as typed data that later operators can inspect.

### Retry And Policy Model

Retry semantics belong primarily to atomic steps.

Compound nodes do not redefine retry as a separate execution primitive. Instead, they may propagate policy defaults to descendants when child nodes do not declare their own overrides.

This model aims to preserve:

- local reasoning about side effects
- predictable replay behavior
- simpler semantics for structured nodes

Examples of policies that may be inherited downward include:

- retry count
- backoff strategy
- timeout defaults
- concurrency defaults for nested structures

### Capability And Permission Model

The framework should support an open, namespaced capability taxonomy.

The core model may define base capabilities, but plugins and providers must be able to introduce additional ones without breaking the shape of the system.

Examples of capabilities may include:

- `fs.read`
- `fs.write`
- `http.request`
- `git.clone`
- `container.exec`
- `llm.openai.chat`

#### Capability Set Per Execution

A workflow does not execute against an abstract universe of possible powers.

Each workflow execution receives a concrete capability set from the runtime. That set determines what the workflow is actually allowed to do in that execution context.

Compound nodes may restrict capabilities further for their descendants.

This means:

- a workflow is defined independently of one runtime instance
- a workflow becomes runnable only after validation against a concrete runtime capability set
- effective permissions may narrow as execution descends into nested nodes

### Versioning Model

Step types are versioned as part of the workflow contract.

The authoring surface may allow shorthand references such as `latest`, but no runnable execution artifact should depend on unresolved latest resolution.

Before execution, each step type reference must resolve to an explicit contract version such as:

- `step.type@1.3`

This preserves reproducibility, traceability, and replay consistency.

### Compatibility Model

Formal compatibility between step type versions is primarily schema-based.

That means compatibility is assessed mainly through declared input and output schemas, not through a fully formalized semantic contract.

However, behavioral stability still matters. The framework should expect step implementations to protect their observable behavior through tests, even when schema compatibility appears intact.

### Conformance Model

Core step types should have standardized conformance tests.

This allows multiple runtimes or SDKs to verify that their implementations of common step types behave consistently enough for shared use.

External plugin ecosystems may define and manage their own tests, but the core step catalog should not rely on informal behavior alone.

### Non-Goals

The following are intentionally out of scope for this first specification:

- a free-form expression language
- arbitrary host-language control flow inside workflow definitions
- implicit parallelism inferred by the runtime
- unrestricted context mutation
- execution against unresolved step type versions

### Open Questions

The following questions remain open and should likely become separate design notes:

- What is the exact schema of `Failure`, `Skipped`, and `Cancelled` payloads?
- How should conditions be represented declaratively without creating a second programming language?
- How should `FanIn` represent partial success, branch metadata, and error aggregation?
- What is the exact grammar for custom capabilities and namespaced permission declarations?
- Which workflow metadata belongs in the IR versus runtime-only deployment descriptors?
- How should authoring-time version resolution from `latest` to explicit versions be recorded and reviewed in Git?
