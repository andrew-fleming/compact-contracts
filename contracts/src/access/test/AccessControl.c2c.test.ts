import {
  CompactTypeBytes,
  CompactTypeVector,
  convertBigintToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { CrossContractWorld } from '#test-utils/c2c/CrossContractWorld.js';
import * as utils from '#test-utils/fixtures/address.js';
import * as MockAccessControl from '../../../artifacts/access/test/mocks/MockAccessControl/contract/index.js';
import { AccessControlSimulator } from './simulators/AccessControlSimulator.js';
import { ContractRoleHolderSimulator } from './simulators/ContractRoleHolderSimulator.js';

/**
 * Roles held by contracts, exercised through real cross-contract calls:
 * `MockContractRoleHolder` instances call into `MockAccessControl` claiming
 * their own address (`kernel.self()`), which the callee proves against
 * `kernel.caller()`. Dry only: the pinned midnight-js cannot submit a
 * cross-contract call.
 */

const zeroBytes = utils.zeroUint8Array();

const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

const makeUser = (label: string) => {
  const secretKey = new Uint8Array(32);
  secretKey.set(new TextEncoder().encode(label).slice(0, 32));
  const accountId = buildAccountIdHash(secretKey);
  return {
    secretKey,
    either: { is_left: true, left: accountId, right: { bytes: zeroBytes } },
  };
};

const makeContract = (label: string) => ({
  address: utils.toHexPadded(label),
  bytes: utils.encodeToAddress(label),
  either: {
    is_left: false,
    left: zeroBytes,
    right: utils.encodeToAddress(label),
  },
});

const USER = makeUser('USER');
const OP1 = makeUser('OP1');
const ACCESS_CONTROL = makeContract('ACCESS_CONTROL');
const ADMIN_CONTRACT = makeContract('ADMIN_CONTRACT');
const OPERATOR_CONTRACT = makeContract('OPERATOR_CONTRACT');
const STRANGER_CONTRACT = makeContract('STRANGER_CONTRACT');

const DEFAULT_ADMIN_ROLE = utils.zeroUint8Array();
const OPERATOR_ROLE = convertBigintToBytes(32, 1n, '');
const OTHER_ROLE = convertBigintToBytes(32, 2n, '');

let accessControl: AccessControlSimulator;
let admin: ContractRoleHolderSimulator;
let operator: ContractRoleHolderSimulator;
let stranger: ContractRoleHolderSimulator;

describe.skipIf(isLiveBackend())(
  'AccessControl with contract role holders (cross-contract)',
  () => {
    beforeEach(async () => {
      accessControl = await AccessControlSimulator.create({
        privateState: { secretKey: USER.secretKey },
        contractAddress: ACCESS_CONTROL.address,
      });
      const holder = (contract: ReturnType<typeof makeContract>) =>
        ContractRoleHolderSimulator.create(ACCESS_CONTROL.bytes, {
          contractAddress: contract.address,
        });
      admin = await holder(ADMIN_CONTRACT);
      operator = await holder(OPERATOR_CONTRACT);
      stranger = await holder(STRANGER_CONTRACT);
      new CrossContractWorld()
        .register(accessControl, MockAccessControl)
        .enable(admin)
        .enable(operator)
        .enable(stranger);

      await accessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN_CONTRACT.either);
      await accessControl._grantRole(OPERATOR_ROLE, OPERATOR_CONTRACT.either);
    });

    describe('hasRole', () => {
      it('should read role membership through the holder', async () => {
        expect(await operator.hasRole(OPERATOR_ROLE)).toBe(true);
        expect(await stranger.hasRole(OPERATOR_ROLE)).toBe(false);
      });
    });

    describe('assertOnlyRole', () => {
      it('should pass for a contract holding the role', async () => {
        await operator.assertOnlyRole(OPERATOR_ROLE);
      });

      it('should fail for a contract without the role', async () => {
        await expect(stranger.assertOnlyRole(OPERATOR_ROLE)).rejects.toThrow(
          'AccessControl: unauthorized account',
        );
      });

      it('should fail for a user claiming the contract top-level', async () => {
        await expect(
          accessControl.assertOnlyRoleAs(
            OPERATOR_ROLE,
            OPERATOR_CONTRACT.either,
          ),
        ).rejects.toThrow('AccessControl: caller does not match account');
      });
    });

    describe('grantRole', () => {
      it('should let a contract admin grant to a user and a contract', async () => {
        await admin.grantRole(OPERATOR_ROLE, OP1.either);
        expect(await accessControl.hasRole(OPERATOR_ROLE, OP1.either)).toBe(
          true,
        );

        await admin.grantRole(OTHER_ROLE, STRANGER_CONTRACT.either);
        expect(await stranger.hasRole(OTHER_ROLE)).toBe(true);
        await stranger.assertOnlyRole(OTHER_ROLE);
      });

      it('should fail for a contract that is not an admin', async () => {
        await expect(
          operator.grantRole(OPERATOR_ROLE, OP1.either),
        ).rejects.toThrow('AccessControl: unauthorized account');
        expect(await accessControl.hasRole(OPERATOR_ROLE, OP1.either)).toBe(
          false,
        );
      });
    });

    describe('revokeRole', () => {
      it('should let a contract admin revoke', async () => {
        await admin.revokeRole(OPERATOR_ROLE, OPERATOR_CONTRACT.either);
        expect(await operator.hasRole(OPERATOR_ROLE)).toBe(false);
        await expect(operator.assertOnlyRole(OPERATOR_ROLE)).rejects.toThrow(
          'AccessControl: unauthorized account',
        );
      });

      it('should fail for a contract that is not an admin', async () => {
        await expect(
          stranger.revokeRole(OPERATOR_ROLE, OPERATOR_CONTRACT.either),
        ).rejects.toThrow('AccessControl: unauthorized account');
        expect(await operator.hasRole(OPERATOR_ROLE)).toBe(true);
      });
    });

    describe('renounceRole', () => {
      it('should let a contract renounce its own role', async () => {
        await operator.renounceRole(OPERATOR_ROLE);
        expect(await operator.hasRole(OPERATOR_ROLE)).toBe(false);
      });

      it('should be a no-op for a role the contract does not hold', async () => {
        await stranger.renounceRole(OPERATOR_ROLE);
        expect(await operator.hasRole(OPERATOR_ROLE)).toBe(true);
      });
    });

    describe('user paths stay witness-based', () => {
      it('should let a user admin keep using the witness-only circuits', async () => {
        await accessControl._grantRole(DEFAULT_ADMIN_ROLE, USER.either);
        await accessControl.grantRole(OTHER_ROLE, OP1.either);
        expect(await accessControl.hasRole(OTHER_ROLE, OP1.either)).toBe(true);
      });
    });
  },
);
