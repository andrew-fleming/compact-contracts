import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockContractRoleHolder,
} from '../../../../artifacts/access/test/mocks/MockContractRoleHolder/contract/index.js';

type EmptyState = Record<string, never>;

/**
 * Type constructor args
 */
type ContractRoleHolderArgs = readonly [target: ContractAddress];

const ContractRoleHolderSimulatorBase = createSimulator<
  EmptyState,
  ReturnType<typeof ledger>,
  EmptyState,
  MockContractRoleHolder<EmptyState>,
  ContractRoleHolderArgs
>({
  contractFactory: (witnesses) =>
    new MockContractRoleHolder<EmptyState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: (target) => [target],
  ledgerExtractor: ledger,
  witnessesFactory: () => ({}),
  artifactName: 'MockContractRoleHolder',
});

/**
 * Simulator for `MockContractRoleHolder`: a contract that holds roles on the
 * `MockAccessControl` at `target` and calls its gated circuits cross-contract,
 * claiming its own address.
 */
export class ContractRoleHolderSimulator extends ContractRoleHolderSimulatorBase {
  static async create(
    target: ContractAddress,
    options: SimulatorOptions<EmptyState, EmptyState> = {},
  ): Promise<ContractRoleHolderSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [target],
      options,
    ) as Promise<ContractRoleHolderSimulator>;
  }

  /**
   * @description Whether this contract holds `roleId` on the target.
   * @param roleId - The role identifier.
   */
  public hasRole(roleId: Uint8Array): Promise<boolean> {
    return this.circuits.impure.hasRole(roleId);
  }

  /**
   * @description Calls the target's `assertOnlyRole` claiming this contract's address.
   * @param roleId - The role identifier.
   */
  public assertOnlyRole(roleId: Uint8Array): Promise<[]> {
    return this.circuits.impure.assertOnlyRole(roleId);
  }

  /**
   * @description Grants `roleId` to `account` on the target as this contract.
   * @param roleId - The role identifier.
   * @param account - The account to grant the role to.
   */
  public grantRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.grantRole(roleId, account);
  }

  /**
   * @description Revokes `roleId` from `account` on the target as this contract.
   * @param roleId - The role identifier.
   * @param account - The account to revoke the role from.
   */
  public revokeRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.revokeRole(roleId, account);
  }

  /**
   * @description Renounces this contract's `roleId` on the target.
   * @param roleId - The role identifier.
   */
  public renounceRole(roleId: Uint8Array): Promise<[]> {
    return this.circuits.impure.renounceRole(roleId);
  }
}
