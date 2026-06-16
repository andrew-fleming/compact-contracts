import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  pureCircuits,
  Contract as ShieldedMultiSigV3Contract,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/ShieldedMultiSigV3/contract/index.js';
import {
  ShieldedMultiSigV3PrivateState,
  ShieldedMultiSigV3Witnesses,
} from '../../witnesses/ShieldedMultiSigV3Witnesses.js';

type ShieldedMultiSigV3Args = readonly [
  instanceSalt: Uint8Array,
  initCoinNonce: Uint8Array,
  tokenDomain: Uint8Array,
  signerCommitments: Uint8Array[],
  thresh: bigint,
];

const ShieldedMultiSigV3SimulatorBase = createSimulator<
  ShieldedMultiSigV3PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedMultiSigV3Witnesses>,
  ShieldedMultiSigV3Contract<ShieldedMultiSigV3PrivateState>,
  ShieldedMultiSigV3Args
>({
  contractFactory: (witnesses) =>
    new ShieldedMultiSigV3Contract<ShieldedMultiSigV3PrivateState>(witnesses),
  defaultPrivateState: () => ShieldedMultiSigV3PrivateState,
  contractArgs: (
    instanceSalt,
    initCoinNonce,
    tokenDomain,
    signerCommitments,
    thresh,
  ) => [instanceSalt, initCoinNonce, tokenDomain, signerCommitments, thresh],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedMultiSigV3Witnesses(),
});

export class ShieldedMultiSigV3Simulator extends ShieldedMultiSigV3SimulatorBase {
  constructor(
    instanceSalt: Uint8Array,
    initCoinNonce: Uint8Array,
    tokenDomain: Uint8Array,
    signerCommitments: Uint8Array[],
    thresh: bigint,
    options: BaseSimulatorOptions<
      ShieldedMultiSigV3PrivateState,
      ReturnType<typeof ShieldedMultiSigV3Witnesses>
    > = {},
  ) {
    super(
      [instanceSalt, initCoinNonce, tokenDomain, signerCommitments, thresh],
      options,
    );
  }

  public _calculateSignerId(pk: Uint8Array, salt: Uint8Array): Uint8Array {
    return this.circuits.pure._calculateSignerId(pk, salt);
  }

  public mint(
    amount: bigint,
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    pubkeys: Uint8Array[],
    signatures: Uint8Array[],
  ) {
    return this.circuits.impure.mint(amount, recipient, pubkeys, signatures);
  }

  public burn(
    coin: {
      nonce: Uint8Array;
      color: Uint8Array;
      value: bigint;
      mt_index: bigint;
    },
    amount: bigint,
    pubkeys: Uint8Array[],
    signatures: Uint8Array[],
  ) {
    return this.circuits.impure.burn(coin, amount, pubkeys, signatures);
  }

  public getNonce(): bigint {
    return this.circuits.impure.getNonce();
  }

  public getTokenDomain(): Uint8Array {
    return this.circuits.impure.getTokenDomain();
  }

  public getTokenType(): Uint8Array {
    return this.circuits.impure.getTokenType();
  }

  public getSignerCount(): bigint {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): bigint {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(commitment: Uint8Array): boolean {
    return this.circuits.impure.isSigner(commitment);
  }
}

// Computes signer commitment from `pk`, `salt`, and
// domain ("Multisig:signer:"). Pure standalone circuit so commitments can be
// calculated before contract instantiation.
export function calculateSignerId(
  pk: Uint8Array,
  salt: Uint8Array,
): Uint8Array {
  return pureCircuits._calculateSignerId(pk, salt);
}
