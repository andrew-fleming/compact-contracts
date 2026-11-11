import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { CrossContractWorld } from '#test-utils/c2c/CrossContractWorld.js';
import * as utils from '#test-utils/fixtures/address.js';
import * as MockOwnable from '../../../artifacts/access/test/mocks/MockOwnable/contract/index.js';
import { ContractOwnerSimulator } from './simulators/ContractOwnerSimulator.js';
import { OwnableSimulator } from './simulators/OwnableSimulator.js';

/**
 * Ownership held by a contract, exercised through real cross-contract calls:
 * `MockContractOwner` at OWNER_CONTRACT holds a reference to `MockOwnable` at
 * OWNED through the `IOwnable` contract type and calls its owner-gated circuits,
 * so `assertOnlyOwner` reads `kernel.caller()` as OWNER_CONTRACT. The gate is
 * probed through `transferOwnership`, the interface's owner-gated entry point:
 * a transfer to the current owner passes it and changes nothing. Dry only: the
 * pinned midnight-js cannot submit a cross-contract call.
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
const NEW_OWNER = makeUser('NEW_OWNER');
const OWNED = makeContract('OWNED');
const OWNER_CONTRACT = makeContract('OWNER_CONTRACT');
const STRANGER_CONTRACT = makeContract('STRANGER_CONTRACT');
const ZERO_ACCOUNT = {
  is_left: true,
  left: zeroBytes,
  right: { bytes: zeroBytes },
};

const isInit = true;

let ownable: OwnableSimulator;
let owner: ContractOwnerSimulator;
let stranger: ContractOwnerSimulator;

describe.skipIf(isLiveBackend())(
  'Ownable owned by a contract (cross-contract)',
  () => {
    beforeEach(async () => {
      ownable = await OwnableSimulator.create(OWNER_CONTRACT.either, isInit, {
        privateState: { secretKey: USER.secretKey },
        contractAddress: OWNED.address,
      });
      owner = await ContractOwnerSimulator.create(OWNED.bytes, {
        contractAddress: OWNER_CONTRACT.address,
      });
      stranger = await ContractOwnerSimulator.create(OWNED.bytes, {
        contractAddress: STRANGER_CONTRACT.address,
      });
      new CrossContractWorld()
        .register(ownable, MockOwnable)
        .enable(owner)
        .enable(stranger);
    });

    describe('owner gate', () => {
      it('should pass for the owner contract', async () => {
        await owner.transferOwnership(OWNER_CONTRACT.either);
        expect(await ownable.owner()).toEqual(OWNER_CONTRACT.either);
      });

      it('should fail for another contract', async () => {
        await expect(
          stranger.transferOwnership(OWNER_CONTRACT.either),
        ).rejects.toThrow('Ownable: caller is not the owner');
      });

      it('should fail for a user calling top-level', async () => {
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should refuse a contract caller when the owner is a user', async () => {
        // A user-owned instance needs the witness, which a callee cannot run.
        await ownable._transferOwnership(USER.either);
        await expect(
          owner.transferOwnership(OWNER_CONTRACT.either),
        ).rejects.toThrow(/invoked witness 'wit_OwnableSK'/);
      });
    });

    describe('owner', () => {
      it('should read the owner through the owner contract', async () => {
        expect(await owner.owner()).toEqual(OWNER_CONTRACT.either);
      });
    });

    describe('transferOwnership', () => {
      it('should let the owner contract transfer to a user', async () => {
        await owner.transferOwnership(NEW_OWNER.either);

        // Visible through the callee simulator and through the caller
        expect(await ownable.owner()).toEqual(NEW_OWNER.either);
        expect(await owner.owner()).toEqual(NEW_OWNER.either);

        // The contract no longer authenticates; the user does, top-level
        await expect(
          owner.transferOwnership(OWNER_CONTRACT.either),
        ).rejects.toThrow(/invoked witness 'wit_OwnableSK'/);
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should let the owner contract transfer to another contract', async () => {
        await owner.transferOwnership(STRANGER_CONTRACT.either);
        expect(await ownable.owner()).toEqual(STRANGER_CONTRACT.either);

        await expect(
          owner.transferOwnership(OWNER_CONTRACT.either),
        ).rejects.toThrow('Ownable: caller is not the owner');
        await stranger.transferOwnership(STRANGER_CONTRACT.either);
        expect(await ownable.owner()).toEqual(STRANGER_CONTRACT.either);
      });

      it('should fail when another contract transfers ownership', async () => {
        await expect(
          stranger.transferOwnership(NEW_OWNER.either),
        ).rejects.toThrow('Ownable: caller is not the owner');
        expect(await ownable.owner()).toEqual(OWNER_CONTRACT.either);
      });

      it('should fail when the owner contract transfers to zero', async () => {
        await expect(owner.transferOwnership(ZERO_ACCOUNT)).rejects.toThrow(
          'Ownable: invalid new owner',
        );
      });
    });

    describe('renounceOwnership', () => {
      it('should let the owner contract renounce', async () => {
        await owner.renounceOwnership();
        expect(await ownable.owner()).toEqual(ZERO_ACCOUNT);

        await expect(
          owner.transferOwnership(OWNER_CONTRACT.either),
        ).rejects.toThrow(/invoked witness 'wit_OwnableSK'/);
      });

      it('should fail when another contract renounces', async () => {
        await expect(stranger.renounceOwnership()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });
    });
  },
);
