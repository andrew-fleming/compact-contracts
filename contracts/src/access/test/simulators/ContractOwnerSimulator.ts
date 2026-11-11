import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockContractOwner,
} from '../../../../artifacts/access/test/mocks/MockContractOwner/contract/index.js';

type EmptyState = Record<string, never>;

/**
 * Type constructor args
 */
type ContractOwnerArgs = readonly [target: ContractAddress];

const ContractOwnerSimulatorBase = createSimulator<
  EmptyState,
  ReturnType<typeof ledger>,
  EmptyState,
  MockContractOwner<EmptyState>,
  ContractOwnerArgs
>({
  contractFactory: (witnesses) => new MockContractOwner<EmptyState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: (target) => [target],
  ledgerExtractor: ledger,
  witnessesFactory: () => ({}),
  artifactName: 'MockContractOwner',
});

/**
 * Simulator for `MockContractOwner`: a contract that owns an `Ownable` instance
 * at `target` and calls its owner-gated circuits cross-contract.
 */
export class ContractOwnerSimulator extends ContractOwnerSimulatorBase {
  static async create(
    target: ContractAddress,
    options: SimulatorOptions<EmptyState, EmptyState> = {},
  ): Promise<ContractOwnerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([target], options) as Promise<ContractOwnerSimulator>;
  }

  /**
   * @description Reads the owned contract's owner through a cross-contract call.
   * @returns The owned contract's owner.
   */
  public owner(): Promise<Either<Uint8Array, ContractAddress>> {
    return this.circuits.impure.owner();
  }

  /**
   * @description Transfers the owned contract's ownership to `newOwner`.
   * @param newOwner - The new owner.
   */
  public transferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.transferOwnership(newOwner);
  }

  /**
   * @description Renounces the owned contract's ownership.
   */
  public renounceOwnership(): Promise<[]> {
    return this.circuits.impure.renounceOwnership();
  }
}
