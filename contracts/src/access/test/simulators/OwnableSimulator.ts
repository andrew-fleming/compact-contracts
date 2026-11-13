import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockOwnable,
} from '../../../../artifacts/access/test/mocks/MockOwnable/contract/index.js';
import {
  OwnablePrivateState,
  OwnableWitnesses,
} from '../witnesses/OwnableWitnesses.js';

/**
 * Type constructor args
 */
type OwnableArgs = readonly [
  initialOwner: Either<Uint8Array, ContractAddress>,
  isInit: boolean,
];

const OwnableSimulatorBase = createSimulator<
  OwnablePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof OwnableWitnesses>,
  MockOwnable<OwnablePrivateState>,
  OwnableArgs
>({
  contractFactory: (witnesses) =>
    new MockOwnable<OwnablePrivateState>(witnesses),
  defaultPrivateState: () => OwnablePrivateState.generate(),
  contractArgs: (initialOwner, isInit) => [initialOwner, isInit],
  ledgerExtractor: ledger,
  witnessesFactory: () => OwnableWitnesses(),
  artifactName: 'MockOwnable',
});

/**
 * Ownable Simulator
 */
export class OwnableSimulator extends OwnableSimulatorBase {
  static async create(
    initialOwner: Either<Uint8Array, ContractAddress>,
    isInit: boolean,
    options: SimulatorOptions<
      OwnablePrivateState,
      ReturnType<typeof OwnableWitnesses>
    > = {},
  ): Promise<OwnableSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [initialOwner, isInit],
      options,
    ) as Promise<OwnableSimulator>;
  }
  /**
   * @description Returns the current contract owner.
   * @returns The contract owner.
   */
  public owner(): Promise<Either<Uint8Array, ContractAddress>> {
    return this.circuits.impure.owner();
  }

  /**
   * @description Transfers ownership of the contract to `newOwner`.
   * @param newOwner - The new owner.
   */
  public transferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.transferOwnership(newOwner);
  }

  /**
   * @description Transfers ownership of the contract to `newOwner` as the
   * calling contract.
   * @param newOwner - The new owner.
   */
  public transferOwnershipAsContract(
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.transferOwnershipAsContract(newOwner);
  }

  /**
   * @description Leaves the contract without an owner.
   * It will not be possible to call `assertOnlyOwner` circuits anymore.
   * Can only be called by the current owner.
   */
  public renounceOwnership(): Promise<[]> {
    return this.circuits.impure.renounceOwnership();
  }

  /**
   * @description Leaves the contract without an owner, as the calling contract.
   */
  public renounceOwnershipAsContract(): Promise<[]> {
    return this.circuits.impure.renounceOwnershipAsContract();
  }

  /**
   * @description Throws if called by any account other than a user owner.
   */
  public assertOnlyOwner(): Promise<[]> {
    return this.circuits.impure.assertOnlyOwner();
  }

  /**
   * @description Throws if called by any contract other than a contract owner.
   */
  public assertOnlyOwnerAsContract(): Promise<[]> {
    return this.circuits.impure.assertOnlyOwnerAsContract();
  }

  /**
   * @description Transfers ownership of the contract to `newOwner` without
   * enforcing permission checks on the caller.
   * @param newOwner - The new owner.
   */
  public _transferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure._transferOwnership(newOwner);
  }

  public readonly privateState = {
    /**
     * @description Replaces the secret key in the private state. Used in tests to
     * simulate switching between different user identities or injecting incorrect
     * keys to test failure paths.
     * @param newSK - The new secret key to set.
     * @returns The updated private state.
     */
    injectSecretKey: (newSK: Uint8Array): Promise<OwnablePrivateState> =>
      this.updatePrivateState(OwnablePrivateState.withSecretKey(newSK)),

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
