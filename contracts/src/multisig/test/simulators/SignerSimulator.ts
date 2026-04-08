import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockSigner,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockSigner/contract/index.js';
import {
  SignerPrivateState,
  SignerWitnesses,
} from '../../witnesses/SignerWitnesses.js';

/**
 * Type constructor args
 */
type SignerArgs = readonly [
  signers: Either<ZswapCoinPublicKey, ContractAddress>[],
  thresh: bigint,
  isInit: boolean,
];

const SignerSimulatorBase = createSimulator<
  SignerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof SignerWitnesses>,
  MockSigner<SignerPrivateState>,
  SignerArgs
>({
  contractFactory: (witnesses) => new MockSigner<SignerPrivateState>(witnesses),
  defaultPrivateState: () => SignerPrivateState,
  contractArgs: (signers, thresh, isInit) => [signers, thresh, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => SignerWitnesses(),
});

/**
 * Signer Simulator
 */
export class SignerSimulator extends SignerSimulatorBase {
  constructor(
    signers: Either<ZswapCoinPublicKey, ContractAddress>[],
    thresh: bigint,
    isInit: boolean,
    options: BaseSimulatorOptions<
      SignerPrivateState,
      ReturnType<typeof SignerWitnesses>
    > = {},
  ) {
    super([signers, thresh, isInit], options);
  }

  public assertSigner(caller: Either<ZswapCoinPublicKey, ContractAddress>) {
    return this.circuits.impure.assertSigner(caller);
  }

  public assertThresholdMet(approvalCount: bigint) {
    return this.circuits.impure.assertThresholdMet(approvalCount);
  }

  public getSignerCount(): bigint {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): bigint {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
    return this.circuits.impure.isSigner(account);
  }

  public _addSigner(signer: Either<ZswapCoinPublicKey, ContractAddress>) {
    return this.circuits.impure._addSigner(signer);
  }

  public _removeSigner(signer: Either<ZswapCoinPublicKey, ContractAddress>) {
    return this.circuits.impure._removeSigner(signer);
  }

  public _changeThreshold(newThreshold: bigint) {
    return this.circuits.impure._changeThreshold(newThreshold);
  }

  public _setThreshold(newThreshold: bigint) {
    return this.circuits.impure._setThreshold(newThreshold);
  }
}
