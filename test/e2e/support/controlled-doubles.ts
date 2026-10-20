export interface ControlledBoundaryDouble {
  readonly calls: readonly unknown[][];
  resolveWith(value: unknown): void;
  rejectWith(error: Error): void;
  reset(): void;
  invoke(...arguments_: unknown[]): Promise<unknown>;
}

export function createControlledBoundaryDouble(): ControlledBoundaryDouble {
  const calls: unknown[][] = [];
  let result: unknown;
  let failure: Error | undefined;

  return {
    calls,
    resolveWith(value) {
      result = value;
      failure = undefined;
    },
    rejectWith(error) {
      failure = error;
    },
    reset() {
      calls.length = 0;
      result = undefined;
      failure = undefined;
    },
    async invoke(...arguments_) {
      calls.push(arguments_);
      if (failure) {
        throw failure;
      }
      return result;
    },
  };
}

export function createDeterministicBoundaryDoubles() {
  return {
    social: createControlledBoundaryDouble(),
    storage: createControlledBoundaryDouble(),
    queue: createControlledBoundaryDouble(),
    jev: createControlledBoundaryDouble(),
  };
}
