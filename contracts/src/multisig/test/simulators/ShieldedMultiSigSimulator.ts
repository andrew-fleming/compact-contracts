import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Ledger,
  ledger,
  pureCircuits,
  Contract as ShieldedMultiSig,
} from '../../../../artifacts/ShieldedMultiSig/contract/index.js';
import {
  ShieldedMultiSigPrivateState,
  ShieldedMultiSigWitnesses,
} from '../witnesses/ShieldedMultiSigWitnesses.js';

type Recipient = { kind: number; address: Uint8Array };
type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type ShieldedSendResult = {
  change: { is_some: boolean; value: ShieldedCoinInfo };
  sent: ShieldedCoinInfo;
};
type Proposal = {
  to: Recipient;
  color: Uint8Array;
  amount: bigint;
  status: number;
};

type ShieldedMultiSigArgs = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  thresh: bigint,
];

const ShieldedMultiSigSimulatorBase = createSimulator<
  ShieldedMultiSigPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedMultiSigWitnesses>,
  ShieldedMultiSig<ShieldedMultiSigPrivateState>,
  ShieldedMultiSigArgs
>({
  contractFactory: (witnesses) =>
    new ShieldedMultiSig<ShieldedMultiSigPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedMultiSigPrivateState.generate(),
  contractArgs: (instanceSalt, signerCommitments, thresh) => [
    instanceSalt,
    signerCommitments,
    thresh,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedMultiSigWitnesses(),
  artifactName: 'ShieldedMultiSig',
});

export class ShieldedMultiSigSimulator extends ShieldedMultiSigSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    thresh: bigint,
    options: SimulatorOptions<
      ShieldedMultiSigPrivateState,
      ReturnType<typeof ShieldedMultiSigWitnesses>
    > = {},
  ): Promise<ShieldedMultiSigSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, thresh],
      options,
    ) as Promise<ShieldedMultiSigSimulator>;
  }

  /**
   * @description Derives a signer commitment off-chain, exactly as the contract
   * derives it in-circuit. This is the deployer-side helper: each prospective
   * signer computes their own commitment and shares only the result.
   */
  static calculateSignerId(
    secretKey: Uint8Array,
    salt: Uint8Array,
  ): Uint8Array {
    return pureCircuits.calculateSignerId(secretKey, salt);
  }

  // Deposit
  public deposit(coin: ShieldedCoinInfo): Promise<[]> {
    return this.circuits.impure.deposit(coin);
  }

  // Proposals
  public createShieldedProposal(
    to: Recipient,
    color: Uint8Array,
    amount: bigint,
  ): Promise<bigint> {
    return this.circuits.impure.createShieldedProposal(to, color, amount);
  }

  public approveProposal(id: bigint): Promise<[]> {
    return this.circuits.impure.approveProposal(id);
  }

  public revokeApproval(id: bigint): Promise<[]> {
    return this.circuits.impure.revokeApproval(id);
  }

  public cancelProposal(id: bigint): Promise<[]> {
    return this.circuits.impure.cancelProposal(id);
  }

  public executeShieldedProposal(id: bigint): Promise<ShieldedSendResult> {
    return this.circuits.impure.executeShieldedProposal(id);
  }

  // View - Approvals
  public isProposalApprovedBySigner(
    id: bigint,
    signer: Uint8Array,
  ): Promise<boolean> {
    return this.circuits.impure.isProposalApprovedBySigner(id, signer);
  }

  public getApprovalCount(id: bigint): Promise<bigint> {
    return this.circuits.impure.getApprovalCount(id);
  }

  // View - Proposals
  public getProposal(id: bigint): Promise<Proposal> {
    return this.circuits.impure.getProposal(id);
  }

  public getProposalStatus(id: bigint): Promise<number> {
    return this.circuits.impure.getProposalStatus(id);
  }

  // View - Treasury
  public getTokenBalance(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getTokenBalance(color);
  }

  public getReceivedTotal(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getReceivedTotal(color);
  }

  public getSentTotal(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getSentTotal(color);
  }

  // View - Signers
  public getSignerCount(): Promise<bigint> {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(commitment: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isSigner(commitment);
  }

  // Ledger access
  public getLedger(): Promise<Ledger> {
    return this.getPublicState();
  }

  public readonly privateState = {
    /**
     * @description Replaces the secret key in the private state. Used in tests
     * to switch between signer identities, or to inject an unregistered key to
     * exercise the failure path.
     * @param newSK - The new secret key to set.
     * @returns The updated private state.
     */
    injectSecretKey: (
      newSK: Uint8Array,
    ): Promise<ShieldedMultiSigPrivateState> =>
      this.updatePrivateState(
        ShieldedMultiSigPrivateState.withSecretKey(newSK),
      ),

    /**
     * @description Returns the current secret key from the private state.
     * @returns The secret key.
     * @throws If the secret key is undefined.
     */
    getCurrentSecretKey: async (): Promise<Uint8Array> => {
      const sk = (await this.getPrivateState()).secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return Uint8Array.from(sk);
    },
  };
}
