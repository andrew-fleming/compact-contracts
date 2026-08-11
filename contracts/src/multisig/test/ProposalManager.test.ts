import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { setBlockTime } from '#test-utils/fixtures/blockTime.js';
import { ProposalManagerSimulator } from './simulators/ProposalManagerSimulator.js';

// Enum values matching ProposalStatus and RecipientKind
const ProposalStatus = {
  Inactive: 0,
  Active: 1,
  Executed: 2,
  Cancelled: 3,
  Expired: 4,
};
const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const COLOR = new Uint8Array(32).fill(1);
const COLOR2 = new Uint8Array(32).fill(2);
const AMOUNT = 1000n;
const AMOUNT2 = 2000n;

// Year 2096. Beyond any plausible block time, so proposals created with it are
// active on both backends without any block-time manipulation.
const EXPIRY = 4_000_000_000n;

const [_RECIPIENT, Z_RECIPIENT] = utils.generatePubKeyPair('RECIPIENT');
const Z_CONTRACT_RECIPIENT = utils.encodeToAddress('CONTRACT_RECIPIENT');

let contract: ProposalManagerSimulator;

// A fresh ProposalManager. Mutating groups build one per test (`beforeEach`);
// read-only groups build one per group (`beforeAll`) to save a live deploy tx.
const fresh = () => ProposalManagerSimulator.create();

describe('ProposalManager', () => {
  describe('recipient helpers (pure)', () => {
    beforeAll(async () => {
      contract = await fresh();
    });

    it('should create shielded user recipient', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      expect(recipient.kind).toEqual(RecipientKind.ShieldedUser);
      expect(recipient.address).toEqual(Z_RECIPIENT.bytes);
    });

    it('should create unshielded user recipient', () => {
      const addr = utils.encodeToPK('UNSHIELDED_USER');
      const recipient = contract.unshieldedUserRecipient(addr);
      expect(recipient.kind).toEqual(RecipientKind.UnshieldedUser);
      expect(recipient.address).toEqual(addr.bytes);
    });

    it('should create contract recipient', () => {
      const recipient = contract.contractRecipient(Z_CONTRACT_RECIPIENT);
      expect(recipient.kind).toEqual(RecipientKind.Contract);
      expect(recipient.address).toEqual(Z_CONTRACT_RECIPIENT.bytes);
    });

    it('should convert shielded user recipient to shielded send format', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const shielded = contract.toShieldedRecipient(recipient);
      expect(shielded.is_left).toEqual(true);
      expect(shielded.left.bytes).toEqual(Z_RECIPIENT.bytes);
    });

    it('should convert contract recipient to shielded send format', () => {
      const recipient = contract.contractRecipient(Z_CONTRACT_RECIPIENT);
      const shielded = contract.toShieldedRecipient(recipient);
      expect(shielded.is_left).toEqual(false);
      expect(shielded.right.bytes).toEqual(Z_CONTRACT_RECIPIENT.bytes);
    });

    it('should reject unshielded user in toShieldedRecipient', () => {
      const recipient = {
        kind: RecipientKind.UnshieldedUser,
        address: new Uint8Array(32),
      };
      expect(() => {
        contract.toShieldedRecipient(recipient);
      }).toThrow('ProposalManager: invalid shielded recipient');
    });

    it('should convert contract recipient to unshielded send format', () => {
      const recipient = contract.contractRecipient(Z_CONTRACT_RECIPIENT);
      const unshielded = contract.toUnshieldedRecipient(recipient);
      expect(unshielded.is_left).toEqual(true);
      expect(unshielded.left.bytes).toEqual(Z_CONTRACT_RECIPIENT.bytes);
    });

    it('should convert unshielded user recipient to unshielded send format', () => {
      const addr = utils.encodeToPK('UNSHIELDED_USER');
      const recipient = contract.unshieldedUserRecipient(addr);
      const unshielded = contract.toUnshieldedRecipient(recipient);
      expect(unshielded.is_left).toEqual(false);
      expect(unshielded.right.bytes).toEqual(addr.bytes);
    });

    it('should reject shielded user in toUnshieldedRecipient', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      expect(() => {
        contract.toUnshieldedRecipient(recipient);
      }).toThrow('ProposalManager: invalid unshielded recipient');
    });
  });

  describe('_createProposal', () => {
    beforeEach(async () => {
      contract = await fresh();
    });

    it('should create a proposal and return id', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      expect(id).toEqual(1n);
    });

    it('should reject an id that is already in use', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      expect(id).toEqual(1n);

      await contract.rewindProposalCounter(1n);

      await expect(
        contract._createProposal(recipient, COLOR, AMOUNT, EXPIRY),
      ).rejects.toThrow('ProposalManager: id already used');
    });

    it('should create sequential proposal ids', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id1 = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      const id2 = await contract._createProposal(
        recipient,
        COLOR2,
        AMOUNT2,
        EXPIRY,
      );
      expect(id1).toEqual(1n);
      expect(id2).toEqual(2n);
    });

    it('should store proposal data correctly', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );

      const proposal = await contract.getProposal(id);
      expect(proposal.to.kind).toEqual(RecipientKind.ShieldedUser);
      expect(proposal.to.address).toEqual(Z_RECIPIENT.bytes);
      expect(proposal.color).toEqual(COLOR);
      expect(proposal.amount).toEqual(AMOUNT);
      expect(proposal.state).toEqual(EXPIRY);
    });

    it('should store contract recipient correctly', async () => {
      const recipient = contract.contractRecipient(Z_CONTRACT_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR2,
        AMOUNT2,
        EXPIRY,
      );

      const proposal = await contract.getProposal(id);
      expect(proposal.to.kind).toEqual(RecipientKind.Contract);
      expect(proposal.to.address).toEqual(Z_CONTRACT_RECIPIENT.bytes);
      expect(proposal.color).toEqual(COLOR2);
      expect(proposal.amount).toEqual(AMOUNT2);
    });

    it('should fail with zero amount', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      await expect(
        contract._createProposal(recipient, COLOR, 0n, EXPIRY),
      ).rejects.toThrow('ProposalManager: zero amount');
    });
  });

  describe('assertProposalExists', () => {
    beforeEach(async () => {
      contract = await fresh();
    });

    it('should pass for existing proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      await contract.assertProposalExists(id);
    });

    it('should fail for non-existing proposal', async () => {
      await expect(contract.assertProposalExists(999n)).rejects.toThrow(
        'ProposalManager: proposal not found',
      );
    });
  });

  describe('assertProposalActive', () => {
    beforeEach(async () => {
      contract = await fresh();
    });

    it('should pass for active proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      await contract.assertProposalActive(id);
    });

    it('should fail for non-existing proposal', async () => {
      await expect(contract.assertProposalActive(999n)).rejects.toThrow(
        'ProposalManager: proposal not found',
      );
    });

    it('should fail for cancelled proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      await contract._cancelProposal(id);
      await expect(contract.assertProposalActive(id)).rejects.toThrow(
        'ProposalManager: proposal not active',
      );
    });

    it('should fail for executed proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      await contract._markExecuted(id);
      await expect(contract.assertProposalActive(id)).rejects.toThrow(
        'ProposalManager: proposal not active',
      );
    });
  });

  describe('_cancelProposal', () => {
    beforeEach(async () => {
      contract = await fresh();
    });

    it('should cancel an active proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );

      await contract._cancelProposal(id);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Cancelled,
      );
    });

    it('should preserve proposal data after cancellation', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );

      await contract._cancelProposal(id);
      const proposal = await contract.getProposal(id);
      expect(proposal.to.address).toEqual(Z_RECIPIENT.bytes);
      expect(proposal.color).toEqual(COLOR);
      expect(proposal.amount).toEqual(AMOUNT);
    });

    it('should fail for non-existing proposal', async () => {
      await expect(contract._cancelProposal(999n)).rejects.toThrow(
        'ProposalManager: proposal not found',
      );
    });

    it('should fail for already cancelled proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      await contract._cancelProposal(id);

      await expect(contract._cancelProposal(id)).rejects.toThrow(
        'ProposalManager: proposal not active',
      );
    });

    it('should fail for executed proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      await contract._markExecuted(id);

      await expect(contract._cancelProposal(id)).rejects.toThrow(
        'ProposalManager: proposal not active',
      );
    });
  });

  describe('_markExecuted', () => {
    beforeEach(async () => {
      contract = await fresh();
    });

    it('should mark an active proposal as executed', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );

      await contract._markExecuted(id);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Executed,
      );
    });

    it('should fail for non-existing proposal', async () => {
      await expect(contract._markExecuted(999n)).rejects.toThrow(
        'ProposalManager: proposal not found',
      );
    });

    it('should fail for already executed proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      await contract._markExecuted(id);

      await expect(contract._markExecuted(id)).rejects.toThrow(
        'ProposalManager: proposal not active',
      );
    });

    it('should fail for cancelled proposal', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      await contract._cancelProposal(id);

      await expect(contract._markExecuted(id)).rejects.toThrow(
        'ProposalManager: proposal not active',
      );
    });
  });

  describe('view circuits', () => {
    let proposalId: bigint;

    // All read-only, so deploy once and seed a single proposal for the group.
    beforeAll(async () => {
      contract = await fresh();
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      proposalId = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
    });

    it('getProposal should return full proposal', async () => {
      const proposal = await contract.getProposal(proposalId);
      expect(proposal.to.kind).toEqual(RecipientKind.ShieldedUser);
      expect(proposal.color).toEqual(COLOR);
      expect(proposal.amount).toEqual(AMOUNT);
      expect(proposal.state).toEqual(EXPIRY);
    });

    it('getProposalRecipient should return recipient', async () => {
      const recipient = await contract.getProposalRecipient(proposalId);
      expect(recipient.kind).toEqual(RecipientKind.ShieldedUser);
      expect(recipient.address).toEqual(Z_RECIPIENT.bytes);
    });

    it('getProposalAmount should return amount', async () => {
      expect(await contract.getProposalAmount(proposalId)).toEqual(AMOUNT);
    });

    it('getProposalColor should return color', async () => {
      expect(await contract.getProposalColor(proposalId)).toEqual(COLOR);
    });

    it('getProposalStatus should return status', async () => {
      expect(await contract.getProposalStatus(proposalId)).toEqual(
        ProposalStatus.Active,
      );
    });

    it('getProposalStatus should return Inactive for a non-existing proposal', async () => {
      expect(await contract.getProposalStatus(999n)).toEqual(
        ProposalStatus.Inactive,
      );
    });

    it('the field getters should fail for non-existing proposal', async () => {
      const badId = 999n;
      await expect(contract.getProposal(badId)).rejects.toThrow(
        'ProposalManager: proposal not found',
      );
      await expect(contract.getProposalRecipient(badId)).rejects.toThrow(
        'ProposalManager: proposal not found',
      );
      await expect(contract.getProposalAmount(badId)).rejects.toThrow(
        'ProposalManager: proposal not found',
      );
      await expect(contract.getProposalColor(badId)).rejects.toThrow(
        'ProposalManager: proposal not found',
      );
    });
  });

  describe('state sentinels', () => {
    beforeEach(async () => {
      contract = await fresh();
    });

    it('should expose the sentinel values', () => {
      expect(contract.executedState()).toEqual(1n);
      expect(contract.cancelledState()).toEqual(2n);
    });

    it('should write the executed sentinel into state', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );

      await contract._markExecuted(id);
      expect((await contract.getProposal(id)).state).toEqual(
        contract.executedState(),
      );
    });

    it('should write the cancelled sentinel into state', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );

      await contract._cancelProposal(id);
      expect((await contract.getProposal(id)).state).toEqual(
        contract.cancelledState(),
      );
    });

    it('should discard the expiry when a proposal reaches a terminal state', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      expect((await contract.getProposal(id)).state).toEqual(EXPIRY);

      await contract._markExecuted(id);
      expect((await contract.getProposal(id)).state).not.toEqual(EXPIRY);
    });
  });

  describe('lifecycle transitions', () => {
    beforeEach(async () => {
      contract = await fresh();
    });

    it('should handle create -> cancel flow', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Active,
      );

      await contract._cancelProposal(id);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Cancelled,
      );
    });

    it('should handle create -> execute flow', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Active,
      );

      await contract._markExecuted(id);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Executed,
      );
    });

    it('should handle multiple proposals independently', async () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id1 = await contract._createProposal(
        recipient,
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      const id2 = await contract._createProposal(
        recipient,
        COLOR2,
        AMOUNT2,
        EXPIRY,
      );

      await contract._cancelProposal(id1);

      expect(await contract.getProposalStatus(id1)).toEqual(
        ProposalStatus.Cancelled,
      );
      expect(await contract.getProposalStatus(id2)).toEqual(
        ProposalStatus.Active,
      );

      await contract._markExecuted(id2);
      expect(await contract.getProposalStatus(id2)).toEqual(
        ProposalStatus.Executed,
      );
    });
  });

  // Needs control over the reported block time, which only the dry backend
  // offers. See the live group below for what can be checked against a node.
  describe.skipIf(isLiveBackend())('expiry (dry only)', () => {
    const NOW = 1_000_000n;
    const LATER = 2_000_000n;

    beforeEach(async () => {
      contract = await fresh();
      setBlockTime(contract, NOW);
    });

    const create = (expiry: bigint) =>
      contract._createProposal(
        contract.shieldedUserRecipient(Z_RECIPIENT),
        COLOR,
        AMOUNT,
        expiry,
      );

    it('should reject an expiry in the past', async () => {
      await expect(create(NOW - 1n)).rejects.toThrow(
        'ProposalManager: expiry not in the future',
      );
    });

    it('should reject an expiry equal to the current block time', async () => {
      await expect(create(NOW)).rejects.toThrow(
        'ProposalManager: expiry not in the future',
      );
    });

    it('should reject an expiry in the sentinel range', async () => {
      await expect(create(contract.executedState())).rejects.toThrow(
        'ProposalManager: expiry not in the future',
      );
      await expect(create(contract.cancelledState())).rejects.toThrow(
        'ProposalManager: expiry not in the future',
      );
    });

    it('should report Active before the expiry and Expired after', async () => {
      const id = await create(LATER);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Active,
      );

      setBlockTime(contract, LATER + 1n);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Expired,
      );
    });

    it('should report Expired at exactly the expiry', async () => {
      const id = await create(LATER);

      setBlockTime(contract, LATER);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Expired,
      );
    });

    it('should reject assertProposalActive once expired', async () => {
      const id = await create(LATER);
      setBlockTime(contract, LATER);

      await expect(contract.assertProposalActive(id)).rejects.toThrow(
        'ProposalManager: proposal expired',
      );
    });

    it('should not execute an expired proposal', async () => {
      const id = await create(LATER);
      setBlockTime(contract, LATER);

      await expect(contract._markExecuted(id)).rejects.toThrow(
        'ProposalManager: proposal expired',
      );
    });

    it('should not cancel an expired proposal', async () => {
      const id = await create(LATER);
      setBlockTime(contract, LATER);

      await expect(contract._cancelProposal(id)).rejects.toThrow(
        'ProposalManager: proposal expired',
      );
    });

    it('should keep an executed proposal Executed after its expiry passes', async () => {
      const id = await create(LATER);
      await contract._markExecuted(id);

      setBlockTime(contract, LATER + 1n);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Executed,
      );
    });

    it('should keep a cancelled proposal Cancelled after its expiry passes', async () => {
      const id = await create(LATER);
      await contract._cancelProposal(id);

      setBlockTime(contract, LATER + 1n);
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Cancelled,
      );
    });

    it('should expire proposals independently', async () => {
      const soon = await create(LATER);
      const late = await create(LATER * 2n);

      setBlockTime(contract, LATER);
      expect(await contract.getProposalStatus(soon)).toEqual(
        ProposalStatus.Expired,
      );
      expect(await contract.getProposalStatus(late)).toEqual(
        ProposalStatus.Active,
      );
    });
  });

  // Against a real node the block time comes from the chain, so a deadline has
  // to actually elapse. The margins below are wall-clock seconds and are sized
  // so a slow proof or a lagging node clock does not decide the outcome.
  describe.runIf(isLiveBackend())('expiry (live only)', () => {
    // Long enough that the creating transaction is comfortably proven and
    // included while the deadline is still in the future.
    const TTL = 90n;
    // Extra margin past the deadline before asserting it has bitten, absorbing
    // any lag between wall clock and the node's reported block time.
    const OVERSHOOT = 20n;

    const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));

    const waitUntil = async (unixSeconds: bigint) => {
      const ms = Number(unixSeconds - nowSeconds()) * 1000;
      if (ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
    };

    it('should reject an expiry in the past', async () => {
      contract = await fresh();
      const anHourAgo = nowSeconds() - 3600n;
      await expect(
        contract._createProposal(
          contract.shieldedUserRecipient(Z_RECIPIENT),
          COLOR,
          AMOUNT,
          anHourAgo,
        ),
      ).rejects.toThrow();
    });

    it('should accept a far-future expiry and report it Active', async () => {
      contract = await fresh();
      const id = await contract._createProposal(
        contract.shieldedUserRecipient(Z_RECIPIENT),
        COLOR,
        AMOUNT,
        EXPIRY,
      );
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Active,
      );
    });

    it('should round-trip the executed sentinel through the node', async () => {
      contract = await fresh();
      const id = await contract._createProposal(
        contract.shieldedUserRecipient(Z_RECIPIENT),
        COLOR,
        AMOUNT,
        EXPIRY,
      );

      await contract._markExecuted(id);
      expect((await contract.getProposal(id)).state).toEqual(
        contract.executedState(),
      );
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Executed,
      );
    });

    it('should round-trip the cancelled sentinel through the node', async () => {
      contract = await fresh();
      const id = await contract._createProposal(
        contract.shieldedUserRecipient(Z_RECIPIENT),
        COLOR,
        AMOUNT,
        EXPIRY,
      );

      await contract._cancelProposal(id);
      expect((await contract.getProposal(id)).state).toEqual(
        contract.cancelledState(),
      );
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Cancelled,
      );
    });

    it('should stop executing a proposal once its deadline elapses', async () => {
      contract = await fresh();
      const deadline = nowSeconds() + TTL;
      const id = await contract._createProposal(
        contract.shieldedUserRecipient(Z_RECIPIENT),
        COLOR,
        AMOUNT,
        deadline,
      );
      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Active,
      );

      await waitUntil(deadline + OVERSHOOT);

      expect(await contract.getProposalStatus(id)).toEqual(
        ProposalStatus.Expired,
      );
      await expect(contract._markExecuted(id)).rejects.toThrow(
        'ProposalManager: proposal expired',
      );

      // Still expired, and still carrying its original deadline rather than a
      // terminal sentinel — the rejected call changed nothing.
      expect((await contract.getProposal(id)).state).toEqual(deadline);
    });

    it('should stop cancelling a proposal once its deadline elapses', async () => {
      contract = await fresh();
      const deadline = nowSeconds() + TTL;
      const id = await contract._createProposal(
        contract.shieldedUserRecipient(Z_RECIPIENT),
        COLOR,
        AMOUNT,
        deadline,
      );

      await waitUntil(deadline + OVERSHOOT);

      await expect(contract._cancelProposal(id)).rejects.toThrow(
        'ProposalManager: proposal expired',
      );
      expect((await contract.getProposal(id)).state).toEqual(deadline);
    });
  });
});
