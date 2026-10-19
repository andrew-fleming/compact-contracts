import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  actAs,
  CHARLIE,
  type ComposedEscrowBypassSimulator,
  deployBypass,
  registerAs,
} from '../../fixtures/composedEscrowBypass.js';
import {
  ALICE,
  BOB,
} from '../../fixtures/confidentialFungibleTokenPublicSupply.js';

// ---------------------------------------------------------------------------
// escrowBypass: a composing contract writes the token module's exported
// `_escrow` map directly, so an escrow can exist for a party that never
// registered. `_spendEscrow` must stop on its own registration guards rather
// than on a raw missing-key read of `_encryptionKeys`; without those guards
// the failures below surface as `expected a cell, received null`.
// ---------------------------------------------------------------------------

let cft: ComposedEscrowBypassSimulator;

describe.skipIf(isLiveBackend())(
  'ConfidentialFungibleToken escrow planted by a composing contract',
  () => {
    beforeEach(async () => {
      cft = await deployBypass();
    });

    it('should reject transferFrom when the spender never registered', async () => {
      await registerAs(cft, ALICE);
      await registerAs(cft, CHARLIE);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(
        cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 1n),
      ).rejects.toThrow('ConfidentialFungibleToken: spender not registered');
    });

    it('should reject _burnFrom when the spender never registered', async () => {
      await registerAs(cft, ALICE);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(cft._burnFrom(ALICE.accountId, 1n)).rejects.toThrow(
        'ConfidentialFungibleToken: spender not registered',
      );
    });

    it('should reject a spend when the owner never registered', async () => {
      await registerAs(cft, BOB);
      await registerAs(cft, CHARLIE);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(
        cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 1n),
      ).rejects.toThrow('ConfidentialFungibleToken: owner not registered');
    });

    it('should reject _burnFrom when the owner never registered', async () => {
      await registerAs(cft, BOB);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(cft._burnFrom(ALICE.accountId, 1n)).rejects.toThrow(
        'ConfidentialFungibleToken: owner not registered',
      );
    });

    it('should let a planted escrow between registered parties reach the allowance check', async () => {
      // Negative control: with both keys present the guards pass, and the
      // default entry (an encryption of zero) fails on the amount instead.
      await registerAs(cft, ALICE);
      await registerAs(cft, BOB);
      await registerAs(cft, CHARLIE);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      const planted = await cft.allowance(ALICE.accountId, BOB.accountId);
      await cft.privateState.cachePlaintext(planted.spenderCt, 0n);
      await expect(
        cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 1n),
      ).rejects.toThrow('ConfidentialFungibleToken: insufficient allowance');
    });
  },
);
