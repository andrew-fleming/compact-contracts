/**
 * Dry cross-contract calls between simulators.
 *
 * compact-simulator builds each circuit context without the two providers a
 * cross-contract call resolves through, so a caller's `target.circuit()` fails
 * with `ModuleProviderAbsent`. This world registers callee simulators by
 * address and rebuilds the caller's context with a state provider (the callee's
 * current ledger state, with a verifier key on every provable circuit) and a
 * module provider (the callee's generated module, with matching `expectedVk`
 * hashes). After each call it writes the callee's post-call state back into
 * the callee simulator, so reads through the callee keep working.
 *
 * Dry backend only. A throwaway until compact-simulator carries the wiring.
 */

import {
  type CircuitContext,
  type ContractModuleProvider,
  ContractOperation,
  ContractState,
  type ContractStateProvider,
  createCircuitContext,
  type Module,
  verifierKeyHashOf,
} from '@midnight-ntwrk/compact-runtime';
import { type DrySim, drySimOf } from './dry.js';
import { DRY_VERIFIER_KEY } from './verifierKey.js';

/** The generated artifact module of a callee (`artifacts/.../contract/index.js`). */
export type CalleeModule = Pick<
  Module,
  'Contract' | 'circuitSignatures' | 'declaredInterfaces'
>;

interface Callee {
  readonly dry: DrySim;
  readonly module: Module;
  readonly provable: readonly string[];
}

/** Any 32-byte hash: the dry state provider ignores it. */
const PARENT_BLOCK_HASH = '00'.repeat(32);

/** A dry simulator always carries a Zswap local state; its absence is a harness bug. */
const zswapStateOf = (call: CircuitContext<unknown>['callContext']) => {
  if (call.currentZswapLocalState === undefined) {
    throw new Error('c2c harness: call context has no Zswap local state');
  }
  return call.currentZswapLocalState;
};

export class CrossContractWorld {
  private readonly callees = new Map<string, Callee>();

  private readonly stateProvider: ContractStateProvider = {
    getContractState: async (_blockHash, address) => {
      const callee = this.callees.get(address);
      if (callee === undefined) {
        return undefined;
      }
      const state = new ContractState();
      state.data =
        callee.dry.circuitContextManager.getContext().callContext.currentQueryContext.state;
      for (const name of callee.provable) {
        const operation = new ContractOperation();
        operation.verifierKey = DRY_VERIFIER_KEY;
        state.setOperation(name, operation);
      }
      return state;
    },
  };

  private readonly moduleProvider: ContractModuleProvider = {
    resolve: (address) => {
      const callee = this.callees.get(address);
      return callee === undefined ? undefined : async () => callee.module;
    },
  };

  /**
   * Registers `sim` as a callee reachable at its own `contractAddress`.
   * @param sim - The callee simulator (dry backend).
   * @param module - Its generated artifact module.
   */
  register(sim: unknown, module: CalleeModule): this {
    const dry = drySimOf(sim);
    const provable = Object.entries(module.circuitSignatures)
      .filter(([, signature]) => signature.provable)
      .map(([name]) => name);
    const expectedVk = Object.fromEntries(
      provable.map((name) => [name, verifierKeyHashOf(DRY_VERIFIER_KEY)]),
    );
    this.callees.set(dry.contractAddress, {
      dry,
      module: { ...module, expectedVk } as Module,
      provable,
    });
    return this;
  }

  /**
   * Lets `sim`'s circuits call into the registered callees. Call before
   * `asContract` when both apply to one simulator.
   * @param sim - The caller simulator (dry backend).
   */
  enable(sim: unknown): this {
    const dry = drySimOf(sim);
    const original = dry.getCallerContext.bind(dry);
    dry.getCallerContext = () => this.withProviders(original());

    const manager = dry.circuitContextManager;
    const setContext = manager.setContext.bind(manager);
    manager.setContext = (ctx) => {
      setContext(ctx);
      this.syncCallees(ctx);
    };
    return this;
  }

  private withProviders(ctx: CircuitContext<unknown>): CircuitContext<unknown> {
    const call = ctx.callContext;
    return createCircuitContext({
      circuitId: call.circuitId,
      contractAddress: call.contractAddress,
      coinPublicKeyOrZswapState: zswapStateOf(call),
      contractState: call.currentQueryContext.state,
      privateState: call.currentPrivateState,
      time: call.time,
      parentBlockHash: PARENT_BLOCK_HASH,
      crossContract: {
        stateProvider: this.stateProvider,
        moduleProvider: this.moduleProvider,
      },
    });
  }

  /** Writes each callee's post-call ledger state back into its simulator. */
  private syncCallees(ctx: CircuitContext<unknown>): void {
    for (const [address, callee] of this.callees) {
      const queryContext = ctx.queryContexts[address];
      if (queryContext === undefined) {
        continue;
      }
      const call = callee.dry.circuitContextManager.getContext().callContext;
      callee.dry.circuitContextManager.setContext(
        createCircuitContext({
          circuitId: call.circuitId,
          contractAddress: call.contractAddress,
          coinPublicKeyOrZswapState: zswapStateOf(call),
          contractState: queryContext.state,
          privateState: call.currentPrivateState,
          time: call.time,
        }),
      );
    }
  }
}
