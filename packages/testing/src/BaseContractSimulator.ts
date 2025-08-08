import {
  type CircuitContext,
  type ConstructorContext,
  type ContractState,
  constructorContext,
  QueryContext,
} from '@midnight-ntwrk/compact-runtime';

/**
 * Responsible for initializing and managing contract state and context.
 * Uses composition so it can be embedded inside other simulator classes.
 */
export class BaseContractSimulator<P> {
  private context: CircuitContext<P>;

  constructor(
    contract: {
      initialState: (
        ctx: ConstructorContext<P>,
        ...args: any[]
      ) => {
        currentPrivateState: P;
        currentContractState: ContractState;
        currentZswapLocalState: any;
      };
    },
    privateState: P,
    coinPK: string,
    contractAddress?: string,
    ...contractArgs: any[]
  ) {
    const initCtx = constructorContext(privateState, coinPK);

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = contract.initialState(initCtx, ...contractArgs);

    this.context = {
      currentPrivateState,
      currentZswapLocalState,
      originalState: currentContractState,
      transactionContext: new QueryContext(
        currentContractState.data,
        contractAddress ?? coinPK,
      ),
    };
  }

  getContext(): CircuitContext<P> {
    return this.context;
  }

  setContext(newContext: CircuitContext<P>) {
    this.context = newContext;
  }

  updatePrivateState(newPrivateState: P) {
    this.context.currentPrivateState = newPrivateState;
  }
}
