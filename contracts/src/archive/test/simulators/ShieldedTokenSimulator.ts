import {
  type CircuitResults,
} from '@midnight-ntwrk/compact-runtime';
import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type CoinInfo,
  type ContractAddress,
  type Either,
  ledger,
  type Maybe,
  Contract as MockShieldedToken,
  type SendResult,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockShieldedToken/contract/index.cjs'; // Combined imports
import {
  ShieldedTokenPrivateState,
  ShieldedTokenWitnesses,
} from '../../witnesses/ShieldedTokenWitnesses.js';

type ShieldedTokenArgs = readonly [
  nonce: Uint8Array,
  name: Maybe<string>,
  symbol: Maybe<string>,
  decimals: bigint,
];

/**
 * Base simulator
 * @dev We deliberately use `any` as the base simulator type.
 * This workaround is necessary due to type inference and declaration filegen
 * in a monorepo environment. Attempting to fully preserve type information
 * turns into type gymnastics.
 *
 * `any` can be safely removed once the contract simulator is consumed
 * as a properly packaged dependency (outside the monorepo).
 */
const ShieldedTokenSimulatorBase: any = createSimulator<
  ShieldedTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedTokenWitnesses>,
  ShieldedTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedToken<ShieldedTokenPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedTokenPrivateState,
  contractArgs: (nonce, name, symbol, decimals) => {
    return [nonce, name, symbol, decimals];
  },
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedTokenWitnesses(),
});

/**
 * ZOwnablePKSimulator
 */
export class ShieldedTokenSimulator extends ShieldedTokenSimulatorBase {
  constructor(
    nonce: Uint8Array,
    name: Maybe<string>,
    symbol: Maybe<string>,
    decimals: bigint,
    options: BaseSimulatorOptions<
      ShieldedTokenPrivateState,
      ReturnType<typeof ShieldedTokenWitnesses>
    > = {},
  ) {
    super([nonce, name, symbol, decimals], options);
  }

  /**
   * @description Returns the token name.
   * @returns The token name.
   */
  public name(): Maybe<string> {
    return this.circuits.impure.name();
  }

  /**
   * @description Returns the symbol of the token.
   * @returns The token name.
   */
  public symbol(): Maybe<string> {
    return this.circuits.impure.symbol();
  }

  /**
   * @description Returns the number of decimals used to get its user representation.
   * @returns The account's token balance.
   */
  public decimals(): bigint {
    return this.circuits.impure.decimals();
  }

  /**
   * @description Returns the value of tokens in existence.
   * @returns The total supply of tokens.
   */
  public totalSupply(): bigint {
    return this.circuits.impure.totalSupply();
  }

  public mint(
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    amount: bigint,
  ): CircuitResults<ShieldedTokenPrivateState, CoinInfo> {
    const res = this.contract.impureCircuits.mint(
      this.circuitContext,
      recipient,
      amount,
    );

    this.circuitContext = res.context;
    return res;
  }

  public burn(
    coin: CoinInfo,
    amount: bigint,
  ): CircuitResults<ShieldedTokenPrivateState, SendResult> {
    const res = this.contract.impureCircuits.burn(
      this.circuitContext,
      coin,
      amount,
    );

    this.circuitContext = res.context;
    return res;
  }
}
