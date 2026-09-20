import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockEip191,
} from '../../../../artifacts/MockEip191/contract/index.js';

// The Eip191 module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type Eip191PrivateState = Record<string, never>;
export const Eip191PrivateState: Eip191PrivateState = {};
export const Eip191Witnesses = () => ({});

/**
 * Type constructor args
 */
type Eip191Args = readonly [];

const Eip191SimulatorBase = createSimulator<
  Eip191PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof Eip191Witnesses>,
  MockEip191<Eip191PrivateState>,
  Eip191Args
>({
  contractFactory: (witnesses) => new MockEip191<Eip191PrivateState>(witnesses),
  defaultPrivateState: () => Eip191PrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => Eip191Witnesses(),
  artifactName: 'MockEip191',
});

/**
 * Eip191 Simulator
 */
export class Eip191Simulator extends Eip191SimulatorBase {
  static async create(
    options: SimulatorOptions<
      Eip191PrivateState,
      ReturnType<typeof Eip191Witnesses>
    > = {},
  ): Promise<Eip191Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Eip191Simulator>;
  }

  /**
   * @description Wraps a message hash in the `personal_sign` envelope.
   * @param messageHash The hash of the operation's ABI-encoded fields.
   * @returns The digest to verify signatures against.
   */
  public personalSignHash(messageHash: Uint8Array): Promise<Uint8Array> {
    return this.circuits.pure.personalSignHash(messageHash);
  }
}
