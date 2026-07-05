import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  type ElGamal_Ciphertext,
  ledger,
  Contract as MockSCT,
} from '../../../../artifacts/MockStealthConfidentialToken/contract/index.js';
import {
  StealthConfidentialTokenPrivateState,
  StealthConfidentialTokenWitnesses,
} from '../witnesses/StealthConfidentialTokenWitnesses.js';

const StealthConfidentialTokenSimulatorBase = createSimulator<
  StealthConfidentialTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof StealthConfidentialTokenWitnesses>,
  MockSCT<StealthConfidentialTokenPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockSCT<StealthConfidentialTokenPrivateState>(witnesses),
  defaultPrivateState: () => StealthConfidentialTokenPrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => StealthConfidentialTokenWitnesses(),
  artifactName: 'MockStealthConfidentialToken',
});

export class StealthConfidentialTokenSimulator extends StealthConfidentialTokenSimulatorBase {
  static async create(
    options: SimulatorOptions<
      StealthConfidentialTokenPrivateState,
      ReturnType<typeof StealthConfidentialTokenWitnesses>
    > = {},
  ): Promise<StealthConfidentialTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<StealthConfidentialTokenSimulator>;
  }

  public registerMeta(): Promise<Uint8Array> {
    return this.circuits.impure.registerMeta();
  }

  public stealthMint(metaId: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure.stealthMint(metaId, value);
  }

  public balanceOf(accountId: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.balanceOf(accountId);
  }

  public stealthClaim(
    ephemeral: JubjubPoint,
    accountId: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure.stealthClaim(ephemeral, accountId);
  }

  public readonly privateState = {
    setSeeds: async (
      scanSeed: Uint8Array,
      spendSeed: Uint8Array,
      ephemeralSeed: Uint8Array,
    ): Promise<StealthConfidentialTokenPrivateState> => {
      const updated = {
        ...(await this.getPrivateState()),
        scanSeed,
        spendSeed,
        ephemeralSeed,
      };
      this.setPrivateState(updated);
      return updated;
    },

    cachePlaintext: async (
      ct: ElGamal_Ciphertext,
      plaintext: bigint,
    ): Promise<StealthConfidentialTokenPrivateState> => {
      const updated = StealthConfidentialTokenPrivateState.cachePlaintext(
        await this.getPrivateState(),
        ct,
        plaintext,
      );
      this.setPrivateState(updated);
      return updated;
    },
  };
}
