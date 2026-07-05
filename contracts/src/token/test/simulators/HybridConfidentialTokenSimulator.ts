import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  ledger,
  Contract as MockHCT,
} from '../../../../artifacts/MockHybridConfidentialToken/contract/index.js';
import {
  type HybridConfidentialTokenPrivateState,
  HybridConfidentialTokenPrivateState as PrivateState,
  HybridConfidentialTokenWitnesses,
  type Note,
} from '../witnesses/HybridConfidentialTokenWitnesses.js';

const HybridConfidentialTokenSimulatorBase = createSimulator<
  HybridConfidentialTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof HybridConfidentialTokenWitnesses>,
  MockHCT<HybridConfidentialTokenPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockHCT<HybridConfidentialTokenPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => HybridConfidentialTokenWitnesses(),
  artifactName: 'MockHybridConfidentialToken',
});

export class HybridConfidentialTokenSimulator extends HybridConfidentialTokenSimulatorBase {
  static async create(
    options: SimulatorOptions<
      HybridConfidentialTokenPrivateState,
      ReturnType<typeof HybridConfidentialTokenWitnesses>
    > = {},
  ): Promise<HybridConfidentialTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create([], options) as Promise<HybridConfidentialTokenSimulator>;
  }

  public mint(recipientPk: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure.mint(recipientPk, value);
  }

  public transfer(recipientPk: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure.transfer(recipientPk, value);
  }

  public initializeAuthority(authorityPk: Uint8Array): Promise<[]> {
    return this.circuits.impure.initializeAuthority(authorityPk);
  }

  public initializeAudit(auditKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure.initializeAudit(auditKey);
  }

  public seize(
    targetOwnerPk: Uint8Array,
    recoveryPk: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure.seize(targetOwnerPk, recoveryPk);
  }

  public readonly privateState = {
    // Configure the caller's identity, the note being spent, and fresh output
    // nonces for the next transfer/mint.
    set: async (
      partial: Partial<HybridConfidentialTokenPrivateState>,
    ): Promise<HybridConfidentialTokenPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };

  public setInputNote(note: Note) {
    return this.privateState.set({ inputNote: note });
  }
}
