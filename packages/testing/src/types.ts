import type {
  CircuitContext,
  ContractState,
} from '@midnight-ntwrk/compact-runtime';

/**
 * Interface defining a generic contract simulator.
 *
 * @template P - Type representing the private contract state.
 * @template L - Type representing the public ledger state.
 */
export interface IContractSimulator<P, L> {
  /**
   * The deployed contract's address.
   */
  readonly contractAddress: string;

  /**
   * The current circuit context holding the contract state.
   */
  circuitContext: CircuitContext<P>;

  /**
   * Returns the current public ledger state.
   *
   * @returns The current ledger state of type L.
   */
  getPublicState(): L;

  /**
   * Returns the current private contract state.
   *
   * @returns The current private state of type P.
   */
  getPrivateState(): P;

  /**
   * Returns the original contract state.
   *
   * @returns The current contract state.
   */
  getContractState(): ContractState;
}

/**
 * Extracts pure circuits from a contract type.
 *
 * Pure circuits are those in `circuits` but not in `impureCircuits`.
 *
 * @template TContract - Contract type with `circuits` and `impureCircuits`.
 */
export type ExtractPureCircuits<TContract> = TContract extends {
  circuits: infer TCircuits;
  impureCircuits: infer TImpureCircuits;
}
  ? Omit<TCircuits, keyof TImpureCircuits>
  : never;

/**
 * Extracts impure circuits from a contract type.
 *
 * Impure circuits are those in `impureCircuits`.
 *
 * @template TContract - Contract type with `circuits` and `impureCircuits`.
 */
export type ExtractImpureCircuits<TContract> = TContract extends {
  impureCircuits: infer TImpureCircuits;
}
  ? TImpureCircuits
  : never;

/**
 * Utility type that removes the context argument from circuits,
 * returning a version callable without the CircuitContext.
 */
export type ContextlessCircuits<Circuits, TState> = {
  [K in keyof Circuits]: Circuits[K] extends (
    ctx: CircuitContext<TState>,
    ...args: infer P
  ) => { result: infer R; context: CircuitContext<TState> }
    ? (...args: P) => R
    : never;
};
