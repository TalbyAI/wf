import type { Effect } from "effect";

export type ExecutableElementHandler<TInput, TOutput, TError, TEnv> =
  (input: TInput) => Effect.Effect<TOutput, TError, TEnv>;

export interface ExecutableElement<TInput, TOutput, TError, TEnv> {
  // validateInput: (input: unknown) => Effect.Effect<TInput, Error, never>;

  readonly handler: ExecutableElementHandler<TInput, TOutput, TError, TEnv>;
};
