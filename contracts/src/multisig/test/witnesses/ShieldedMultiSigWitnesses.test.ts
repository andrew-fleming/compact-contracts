import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../artifacts/ShieldedMultiSig/contract/index.js';
import {
  ShieldedMultiSigPrivateState,
  ShieldedMultiSigWitnesses,
} from './ShieldedMultiSigWitnesses.js';

const SECRET_KEY = new Uint8Array(32).fill(0x34);

describe('ShieldedMultiSigPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte secretKey', () => {
      const state = ShieldedMultiSigPrivateState.generate();
      expect(state.secretKey).toBeInstanceOf(Uint8Array);
      expect(state.secretKey.length).toBe(32);
    });

    it('should produce unique secret key on successive calls', () => {
      const a = ShieldedMultiSigPrivateState.generate();
      const b = ShieldedMultiSigPrivateState.generate();
      expect(a.secretKey).not.toEqual(b.secretKey);
    });
  });

  describe('withSecretKey', () => {
    it('should accept a valid 32-byte secret key', () => {
      const state = ShieldedMultiSigPrivateState.withSecretKey(SECRET_KEY);
      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should create a defensive copy of the input secret key', () => {
      const sk = new Uint8Array(32).fill(0xcc);
      const state = ShieldedMultiSigPrivateState.withSecretKey(sk);

      sk.fill(0xff);
      expect(state.secretKey).toEqual(new Uint8Array(32).fill(0xcc));
    });

    it('should throw for a secret key shorter than 32 bytes', () => {
      const short = new Uint8Array(16);
      expect(() =>
        ShieldedMultiSigPrivateState.withSecretKey(short),
      ).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 16 bytes',
      );
    });

    it('should throw for a secret key longer than 32 bytes', () => {
      const long = new Uint8Array(64);
      expect(() =>
        ShieldedMultiSigPrivateState.withSecretKey(long),
      ).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 64 bytes',
      );
    });

    it('should throw for an empty array', () => {
      expect(() =>
        ShieldedMultiSigPrivateState.withSecretKey(new Uint8Array(0)),
      ).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 0 bytes',
      );
    });
  });
});

describe('ShieldedMultiSigWitnesses', () => {
  const witnesses = ShieldedMultiSigWitnesses();

  function makeContext(
    privateState: ShieldedMultiSigPrivateState,
  ): WitnessContext<Ledger, ShieldedMultiSigPrivateState> {
    return { privateState } as WitnessContext<
      Ledger,
      ShieldedMultiSigPrivateState
    >;
  }

  describe('wit_ShieldedMultiSigSK', () => {
    it('should return a tuple of [privateState, secretKey]', () => {
      const state = ShieldedMultiSigPrivateState.withSecretKey(SECRET_KEY);
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_ShieldedMultiSigSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(SECRET_KEY);
    });

    it('should return the exact same privateState reference', () => {
      const state = ShieldedMultiSigPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState] = witnesses.wit_ShieldedMultiSigSK(ctx);
      expect(returnedState).toBe(state);
    });

    it('should return the secretKey as a Uint8Array', () => {
      const state = ShieldedMultiSigPrivateState.generate();
      const ctx = makeContext(state);

      const [, returnedSK] = witnesses.wit_ShieldedMultiSigSK(ctx);
      expect(returnedSK).toBeInstanceOf(Uint8Array);
      expect(returnedSK.length).toBe(32);
    });

    it('should not alias the private state secret key', () => {
      // The witness hands its result to the circuit; a caller mutating the
      // returned buffer must not be able to reach into the private state.
      const state = ShieldedMultiSigPrivateState.withSecretKey(SECRET_KEY);
      const ctx = makeContext(state);

      const [, returnedSK] = witnesses.wit_ShieldedMultiSigSK(ctx);
      returnedSK.fill(0xff);

      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should work with a randomly generated state', () => {
      const state = ShieldedMultiSigPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_ShieldedMultiSigSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(state.secretKey);
    });
  });
});

describe('ShieldedMultiSigWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = ShieldedMultiSigWitnesses();
    const b = ShieldedMultiSigWitnesses();
    expect(a).not.toBe(b);
  });
});
