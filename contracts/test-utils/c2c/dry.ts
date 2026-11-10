import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

/**
 * The in-memory engine behind a dry simulator, as far as this harness reaches
 * into it. Everything here is a public member of compact-simulator's
 * `createDrySimulator` class; only the path to it (`_backend.sim`) is private.
 */
export interface DrySim<P = unknown> {
  readonly contractAddress: string;
  getCallerContext(): CircuitContext<P>;
  circuitContextManager: {
    getContext(): CircuitContext<P>;
    setContext(ctx: CircuitContext<P>): void;
  };
}

type WithBackend = { _backend?: { kind?: string; sim?: unknown } };

/**
 * Returns the dry engine of a simulator built with `createSimulator`.
 * @throws when the simulator runs on the live backend: nothing here applies
 * to a deployed contract.
 */
export const drySimOf = <P = unknown>(sim: unknown): DrySim<P> => {
  const backend = (sim as WithBackend)._backend;
  if (backend?.kind !== 'dry' || backend.sim === undefined) {
    throw new Error('c2c harness: dry backend only');
  }
  return backend.sim as DrySim<P>;
};
