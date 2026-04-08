import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { SignerSimulator } from './simulators/SignerSimulator.js';

const THRESHOLD = 2n;
const IS_INIT = true;

const [_SIGNER, Z_SIGNER] = utils.generateEitherPubKeyPair('SIGNER');
const [_SIGNER2, Z_SIGNER2] = utils.generateEitherPubKeyPair('SIGNER2');
const [_SIGNER3, Z_SIGNER3] = utils.generateEitherPubKeyPair('SIGNER3');
const SIGNERS = [Z_SIGNER, Z_SIGNER2, Z_SIGNER3];
const [_OTHER, Z_OTHER] = utils.generateEitherPubKeyPair('OTHER');
const [_OTHER2, Z_OTHER2] = utils.generateEitherPubKeyPair('OTHER2');

let contract: SignerSimulator;

describe('SigningManager', () => {
  describe('initialization', () => {
    it('should fail with a threshold of zero', () => {
      expect(() => {
        new SignerSimulator(SIGNERS, 0n, IS_INIT);
      }).toThrow('Signer: threshold must not be zero');
    });

    it('should fail when threshold exceeds signer count', () => {
      expect(() => {
        new SignerSimulator(SIGNERS, BigInt(SIGNERS.length) + 1n, IS_INIT);
      }).toThrow('Signer: threshold exceeds signer count');
    });

    it('should fail with duplicate signers', () => {
      const duplicateSigners = [Z_SIGNER, Z_SIGNER, Z_SIGNER2];
      expect(() => {
        new SignerSimulator(duplicateSigners, THRESHOLD, IS_INIT);
      }).toThrow('Signer: signer already active');
    });

    it('should initialize with threshold equal to signer count', () => {
      const contract = new SignerSimulator(
        SIGNERS,
        BigInt(SIGNERS.length),
        IS_INIT,
      );
      expect(contract.getThreshold()).toEqual(BigInt(SIGNERS.length));
    });

    it('should initialize', () => {
      expect(() => {
        contract = new SignerSimulator(SIGNERS, THRESHOLD, IS_INIT);
      }).not.toThrow();

      // Check thresh
      expect(contract.getThreshold()).toEqual(THRESHOLD);

      // Check signers
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      expect(() => {
        for (let i = 0; i < SIGNERS.length; i++) {
          contract.assertSigner(SIGNERS[i]);
        }
      }).not.toThrow();
    });
  });

  beforeEach(() => {
    contract = new SignerSimulator(SIGNERS, THRESHOLD, IS_INIT);
  });

  describe('assertSigner', () => {
    it('should pass with good signer', () => {
      expect(() => contract.assertSigner(Z_SIGNER)).not.toThrow();
    });

    it('should fail with bad signer', () => {
      expect(() => {
        contract.assertSigner(Z_OTHER);
      }).toThrow('Signer: not a signer');
    });
  });

  describe('assertThresholdMet', () => {
    it('should pass when approvals equal threshold', () => {
      expect(() => contract.assertThresholdMet(THRESHOLD)).not.toThrow();
    });

    it('should pass when approvals exceed threshold', () => {
      expect(() => contract.assertThresholdMet(THRESHOLD + 1n)).not.toThrow();
    });

    it('should fail when approvals are below threshold', () => {
      expect(() => {
        contract.assertThresholdMet(THRESHOLD - 1n);
      }).toThrow('Signer: threshold not met');
    });

    it('should fail with zero approvals', () => {
      expect(() => {
        contract.assertThresholdMet(0n);
      }).toThrow('Signer: threshold not met');
    });

    it('should fail with any count when threshold not set', () => {
      const isNotInit = false;
      const uninit = new SignerSimulator(SIGNERS, 0n, isNotInit);
      expect(() => uninit.assertThresholdMet(5n)).toThrow(
        'Signer: threshold not set',
      );
    });
  });

  describe('isSigner', () => {
    it('should return true for an active signer', () => {
      expect(contract.isSigner(Z_SIGNER)).toEqual(true);
    });

    it('should return false for a non-signer', () => {
      expect(contract.isSigner(Z_OTHER)).toEqual(false);
    });
  });

  describe('_addSigner', () => {
    it('should add a new signer', () => {
      contract._addSigner(Z_OTHER);

      expect(contract.isSigner(Z_OTHER)).toEqual(true);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) + 1n);
    });

    it('should fail when adding an existing signer', () => {
      contract._addSigner(Z_OTHER);

      expect(() => {
        contract._addSigner(Z_OTHER);
      }).toThrow('Signer: signer already active');
    });

    it('should add multiple new signers', () => {
      contract._addSigner(Z_OTHER);
      contract._addSigner(Z_OTHER2);

      expect(contract.isSigner(Z_OTHER)).toEqual(true);
      expect(contract.isSigner(Z_OTHER2)).toEqual(true);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) + 2n);
    });

    it('should allow re-adding a previously removed signer', () => {
      expect(contract.isSigner(Z_SIGNER)).toEqual(true);

      // Remove signer
      contract._removeSigner(Z_SIGNER);
      expect(contract.isSigner(Z_SIGNER)).toEqual(false);

      // Re-add signer
      contract._addSigner(Z_SIGNER);
      expect(contract.isSigner(Z_SIGNER)).toEqual(true);
    });
  });

  describe('_removeSigner', () => {
    it('should remove an existing signer', () => {
      contract._removeSigner(Z_SIGNER3);

      expect(contract.isSigner(Z_SIGNER3)).toEqual(false);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) - 1n);
    });

    it('should fail when removing a non-signer', () => {
      expect(() => {
        contract._removeSigner(Z_OTHER);
      }).toThrow('Signer: not a signer');
    });

    it('should fail when removal would breach threshold', () => {
      // Remove one signer: count goes from 3 to 2, threshold is 2 — ok
      contract._removeSigner(Z_SIGNER3);

      // Remove another: count would go from 2 to 1, threshold is 2 — breach
      expect(() => {
        contract._removeSigner(Z_SIGNER2);
      }).toThrow('Signer: removal would breach threshold');
    });

    it('should allow removal after threshold is lowered', () => {
      contract._changeThreshold(1n);
      contract._removeSigner(Z_SIGNER3);
      contract._removeSigner(Z_SIGNER2);

      expect(contract.getSignerCount()).toEqual(1n);
      expect(contract.isSigner(Z_SIGNER)).toEqual(true);
      expect(contract.isSigner(Z_SIGNER2)).toEqual(false);
      expect(contract.isSigner(Z_SIGNER3)).toEqual(false);
    });

    it('should keep signer count in sync after multiple add/remove operations', () => {
      contract._addSigner(Z_OTHER);
      contract._addSigner(Z_OTHER2);
      contract._removeSigner(Z_SIGNER3);
      contract._removeSigner(Z_OTHER);

      expect(contract.getSignerCount()).toEqual(3n);
      expect(contract.isSigner(Z_SIGNER)).toEqual(true);
      expect(contract.isSigner(Z_SIGNER2)).toEqual(true);
      expect(contract.isSigner(Z_SIGNER3)).toEqual(false);
      expect(contract.isSigner(Z_OTHER)).toEqual(false);
      expect(contract.isSigner(Z_OTHER2)).toEqual(true);
    });
  });

  describe('_changeThreshold', () => {
    it('should update the threshold', () => {
      contract._changeThreshold(3n);

      expect(contract.getThreshold()).toEqual(3n);
    });

    it('should allow lowering the threshold', () => {
      contract._changeThreshold(1n);

      expect(contract.getThreshold()).toEqual(1n);
    });

    it('should fail with a threshold of zero', () => {
      expect(() => {
        contract._changeThreshold(0n);
      }).toThrow('Signer: threshold must not be zero');
    });

    it('should fail when threshold exceeds signer count', () => {
      expect(() => {
        contract._changeThreshold(BigInt(SIGNERS.length) + 1n);
      }).toThrow('Signer: threshold exceeds signer count');
    });

    it('should allow threshold equal to signer count', () => {
      contract._changeThreshold(BigInt(SIGNERS.length));

      expect(contract.getThreshold()).toEqual(BigInt(SIGNERS.length));
    });

    it('should reflect new threshold in assertThresholdMet', () => {
      contract._changeThreshold(3n);

      expect(() => {
        contract.assertThresholdMet(2n);
      }).toThrow('Signer: threshold not met');

      expect(() => contract.assertThresholdMet(3n)).not.toThrow();
    });
  });

  describe('_setThreshold', () => {
    beforeEach(() => {
      const isNotInit = false;
      contract = new SignerSimulator(SIGNERS, 0n, isNotInit);
    });

    it('should have an empty state', () => {
      expect(contract.getThreshold()).toEqual(0n);
      expect(contract.getSignerCount()).toEqual(0n);
      expect(contract.getPublicState().Signer__signers.isEmpty()).toEqual(true);
    });

    it('should set threshold without signers', () => {
      expect(contract.getThreshold()).toEqual(0n);

      contract._setThreshold(2n);
      expect(contract.getThreshold()).toEqual(2n);
    });

    it('should set threshold multiple times', () => {
      contract._setThreshold(2n);
      contract._setThreshold(3n);
      expect(contract.getThreshold()).toEqual(3n);
    });

    it('should fail with zero threshold', () => {
      expect(() => {
        contract._setThreshold(0n);
      }).toThrow('Signer: threshold must not be zero');
    });
  });

  describe('custom setup flow when not initialized', () => {
    beforeEach(() => {
      const isNotInit = false;
      contract = new SignerSimulator(SIGNERS, 0n, isNotInit);
    });

    it('should have no signers by default', () => {
      expect(contract.getSignerCount()).toEqual(0n);
      expect(contract.isSigner(Z_SIGNER)).toEqual(false);
    });

    it('should have zero threshold by default', () => {
      expect(contract.getThreshold()).toEqual(0n);
    });

    it('should allow adding signers then setting threshold', () => {
      contract._addSigner(Z_SIGNER);
      contract._addSigner(Z_SIGNER2);
      contract._addSigner(Z_SIGNER3);
      contract._changeThreshold(2n);

      expect(contract.getSignerCount()).toEqual(3n);
      expect(contract.getThreshold()).toEqual(2n);
      expect(contract.isSigner(Z_SIGNER)).toEqual(true);
    });

    it('should allow setting threshold then adding signers to meet it', () => {
      contract._setThreshold(2n);
      contract._addSigner(Z_SIGNER);
      contract._addSigner(Z_SIGNER2);

      expect(contract.getSignerCount()).toEqual(2n);
      expect(contract.getThreshold()).toEqual(2n);
    });

    it('should fail _changeThreshold before signers are added', () => {
      expect(() => {
        contract._changeThreshold(2n);
      }).toThrow('Signer: threshold exceeds signer count');
    });

    it('should allow assertThresholdMet after custom setup', () => {
      contract._setThreshold(2n);
      contract._addSigner(Z_SIGNER);
      contract._addSigner(Z_SIGNER2);

      expect(() => contract.assertThresholdMet(2n)).not.toThrow();
    });

    it('should fail assertThresholdMet before threshold is set', () => {
      contract._addSigner(Z_SIGNER);
      contract._addSigner(Z_SIGNER2);

      expect(() => contract.assertThresholdMet(0n)).toThrow(
        'Signer: threshold not set',
      );
    });
  });
});
