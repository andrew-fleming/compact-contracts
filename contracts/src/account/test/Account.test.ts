import {
  CoinInfo,
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Maybe, ZswapCoinPublicKey } from '../../../artifacts/MockShieldedToken/contract/index.cjs';
import * as utils from './utils/address.js';
import { AccountSimulator } from './simulators/AccountSimulator.js';

// PKs
const [ALICE, zALICE] = utils.generateEitherPubKeyPair('ALICE');
const [BOB, zBOB] = utils.generateEitherPubKeyPair('BOB');
const [UNAUTHORIZED, _] = utils.generatePubKeyPair('UNAUTHORIZED');

const NO_STRING: Maybe<string> = {
  is_some: false,
  value: '',
};
const NAME: Maybe<string> = {
  is_some: true,
  value: 'NAME',
};
const SYMBOL: Maybe<string> = {
  is_some: true,
  value: 'SYMBOL',
};
const DECIMALS: bigint = 18n;
const NONCE: Uint8Array = utils.pad('NONCE', 32);
const DOMAIN: Uint8Array = utils.pad('ShieldedToken', 32);

const AMOUNT: bigint = BigInt(250);
const MAX_UINT64 = BigInt(2 ** 64) - BigInt(1);

let secretKey: Uint8Array;
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
