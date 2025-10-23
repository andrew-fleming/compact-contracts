import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockOwnable,
  CoinInfo,
  type ZswapCoinPublicKey,
  Account_Spend,
} from '../../../../artifacts/MockAccount/contract/index.cjs';
import {
  AccountPrivateState,
  AccountWitnesses,
} from '../../witnesses/AccountWitnesses.js';

/**
 * Type constructor args
 */
type AccountArgs = readonly [];

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
  AccountArgs
>({
  contractFactory: (witnesses) =>
    new MockOwnable<AccountPrivateState>(witnesses),
  defaultPrivateState: () => AccountPrivateState.generate(),
  contractArgs: () => { return []; },
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AccountWitnesses(),
});

/**
 * AccountSimulator
 */
export class AccountSimulator extends AccountSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      AccountPrivateState,
      ReturnType<typeof AccountWitnesses>
    > = {},
  ) {
    super([], options);
  }

  public receive(coin: CoinInfo): void {
    this.circuits.impure.receive(coin);
  }

  public send(recipient: ZswapCoinPublicKey, spend: Account_Spend, input: Uint8Array): void {
    this.circuits.impure.send(recipient, spend, input);
  }

  public isValidInput(hash: Uint8Array, input: Uint8Array): Uint8Array {
    return this.circuits.impure.isValidInput(hash, input);
  }
}
