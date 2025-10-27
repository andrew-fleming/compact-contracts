import type { CircuitResults } from '@midnight-ntwrk/compact-runtime';
import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type Account_Spend,
  type CoinInfo,
  type ContractAddress,
  type Either,
  ledger,
  type Maybe,
  Contract as MockOwnable,
  type SendResult,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockAccountWithToken/contract/index.cjs';
import {
  AccountPrivateState,
  AccountWitnesses,
} from '../../witnesses/AccountWitnesses.js';

/**
 * Type constructor args
 */
type AccountWithTokenArgs = readonly [
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
const AccountSimulatorBase: any = createSimulator<
  AccountPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof AccountWitnesses>,
  AccountWithTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockOwnable<AccountPrivateState>(witnesses),
  defaultPrivateState: () => AccountPrivateState.generate(),
  contractArgs: (nonce, name, symbol, decimals) => {
    return [nonce, name, symbol, decimals];
  },
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AccountWitnesses(),
});

/**
 * AccountSimulator
 */
export class AccountSimulator extends AccountSimulatorBase {
  constructor(
    nonce: Uint8Array,
    name: Maybe<string>,
    symbol: Maybe<string>,
    decimals: bigint,
    options: BaseSimulatorOptions<
      AccountPrivateState,
      ReturnType<typeof AccountWitnesses>
    > = {},
  ) {
    super([nonce, name, symbol, decimals], options);
  }

  public receiveCoin(coin: CoinInfo) {
    const res = this.contract.impureCircuits.receiveCoin(
      this.circuitContext,
      coin,
    );

    this.circuitContext = res.context;
    return res;
  }

  public send(
    recipient: ZswapCoinPublicKey,
    spend: Account_Spend,
    input: Uint8Array,
  ): void {
    this.circuits.impure.send(recipient, spend, input);
  }

  public isValidInput(hash: Uint8Array, input: Uint8Array): Uint8Array {
    return this.circuits.impure.isValidInput(hash, input);
  }

  public accountId(): Uint8Array {
    return this.circuits.impure.accountId();
  }

  /**
   * Pure circuits
   */

  public ACCOUNT_NAMESPACE(): Uint8Array {
    return this.circuits.pure.ACCOUNT_NAMESPACE();
  }

  public inputDomain(): Uint8Array {
    return this.circuits.pure.inputDomain();
  }

  public sendDomain(): Uint8Array {
    return this.circuits.pure.sendDomain();
  }

  public invokeDomain(): Uint8Array {
    return this.circuits.pure.invokeDomain();
  }

  /**
   * Token circuits for testing
   */

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
  ): CircuitResults<AccountPrivateState, CoinInfo> {
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
  ): CircuitResults<AccountPrivateState, SendResult> {
    const res = this.contract.impureCircuits.burn(
      this.circuitContext,
      coin,
      amount,
    );

    this.circuitContext = res.context;
    return res;
  }
}
