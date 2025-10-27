import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountSimulator } from './simulators/AccountSimulator.js';
import * as utils from './utils/address.js';

let account: AccountSimulator;

describe('Account', () => {
  beforeEach(() => {
    account = new AccountSimulator();
  });

  describe('initialization', () => {
    it('should have a nonce of 0', () => {
      const initNonce = account.getPublicState().Account__nonce;
      expect(initNonce).toEqual(0n);
    });
  });

  describe('isValidInput', () => {
    it('should return true for valid input', () => {
      // Craft hash
      const rt_type = new CompactTypeVector(3, new CompactTypeBytes(32));
      const inputDomain = account.inputDomain();
      const id = account.accountId();
      const hash = new Uint8Array(32).fill(1);
      const expInput = persistentHash(rt_type, [inputDomain, id, hash]);

      // Check if valid
      const isValid = account.isValidInput(hash, expInput);
      expect(isValid).toEqual(utils.pad('VALIDATED', 32));
    });

    it('should return false for invalid input', () => {
      // Craft hash
      const rt_type = new CompactTypeVector(3, new CompactTypeBytes(32));
      const inputDomain = account.inputDomain();
      const id = account.accountId();
      const hash = new Uint8Array(32).fill(1);
      const expInput = persistentHash(rt_type, [inputDomain, id, hash]);

      // Check if valid
      const badHash = new Uint8Array(32).fill(2);
      const isNotValid = account.isValidInput(badHash, expInput);
      expect(isNotValid).not.toEqual(utils.pad('VALIDATED', 32));
      expect(isNotValid).toEqual(utils.pad('', 32));
    });
  });
});
