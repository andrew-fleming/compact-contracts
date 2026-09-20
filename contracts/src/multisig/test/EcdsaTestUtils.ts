/**
 * Reconstructs, byte-for-byte, the message digest each multisig circuit hashes
 * and verifies. This mirrors what a real operator must do off-chain, and it is
 * written from the Ethereum specs rather than from the circuits: EVM ABI-encoded
 * words, hashed with Keccak-256, wrapped in the EIP-191 `personal_sign`
 * envelope. If the contract and this file ever disagree, one of them is wrong
 * about what an EVM signer produces.
 *
 * Key and signature fixtures live in `#test-utils/fixtures/ecdsa.js`.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';

// ─── EVM ABI word encoding ──────────────────────────────────────

/** `abi.encode(uint256)`: the value big-endian in a 32-byte word. */
const abiUint = (value: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let acc = value;
  for (let i = 31; i >= 0 && acc > 0n; i--) {
    out[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return out;
};

/** `abi.encode(bool)`: zero except the least significant byte. */
const abiBool = (value: boolean): Uint8Array => {
  const out = new Uint8Array(32);
  out[31] = value ? 1 : 0;
  return out;
};

/** `pad(32, s)`: ASCII bytes of `s`, right-padded with zeros to 32 bytes. */
export function domainBytes(s: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(s));
  return out;
}

/** `keccak256(abi.encode(w0, ..., wn))` over a vector of 32-byte words. */
const hashWords = (words: Uint8Array[]): Uint8Array =>
  keccak_256(Buffer.concat(words.map(Buffer.from)));

/** The EIP-191 `personal_sign` envelope over a 32-byte message hash. */
const personalSign = (messageHash: Uint8Array): Uint8Array =>
  keccak_256(
    Buffer.concat([
      Buffer.from('\x19Ethereum Signed Message:\n32', 'binary'),
      Buffer.from(messageHash),
    ]),
  );

// ─── Recipients ─────────────────────────────────────────────────

/** An `Either<ZswapCoinPublicKey, ContractAddress>` as the artifact encodes it. */
export interface EitherRecipient {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
}

/**
 * The two words a recipient contributes: the active arm's bytes, then the
 * discriminant. Only the active arm is read, matching the circuit, so data in
 * the unused arm cannot reach the digest.
 */
const recipientWords = (r: EitherRecipient): Uint8Array[] => [
  r.is_left ? r.left.bytes : r.right.bytes,
  abiBool(!r.is_left),
];

/** A `Proposal_Recipient` as the artifact encodes it: kind enum + address. */
export interface KindRecipient {
  kind: number;
  address: Uint8Array;
}

// ─── Per-preset message hashes ──────────────────────────────────

/** ShieldedMultiSigV3 `mint` digest. `contractAddress` is `kernel.self().bytes`. */
export function mintMsgHash(params: {
  contractAddress: Uint8Array;
  recipient: EitherRecipient;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return personalSign(
    hashWords([
      domainBytes('multisig:mint:'),
      params.contractAddress,
      ...recipientWords(params.recipient),
      abiUint(params.opNonce),
      abiUint(params.amount),
    ]),
  );
}

/** ShieldedMultiSigV3 `burn` digest. */
export function burnMsgHash(params: {
  contractAddress: Uint8Array;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return personalSign(
    hashWords([
      domainBytes('multisig:burn:'),
      params.contractAddress,
      abiUint(params.opNonce),
      abiUint(params.amount),
    ]),
  );
}

/** ShieldedMultiSigV2 `execute` digest. `contractAddress` is `kernel.self().bytes`. */
export function executeMsgHash(params: {
  contractAddress: Uint8Array;
  nonce: bigint;
  to: KindRecipient;
  coinColor: Uint8Array;
  amount: bigint;
}): Uint8Array {
  return personalSign(
    hashWords([
      domainBytes('multisig:execute:'),
      params.contractAddress,
      abiUint(params.nonce),
      abiUint(BigInt(params.to.kind)),
      params.to.address,
      params.coinColor,
      abiUint(params.amount),
    ]),
  );
}
