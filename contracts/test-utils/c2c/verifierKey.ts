/**
 * A real verifier key, used as a stand-in for every callee circuit in dry
 * cross-contract tests. The runtime's key agreement needs the callee's deployed
 * operation to carry a tagged key whose hash equals the callee module's
 * `expectedVk` entry; `--skip-zk` artifacts have neither, so the harness
 * attaches this one on both sides. The key's contents never matter: nothing is
 * proved or verified off-chain.
 *
 * Source: a tiny circuit compiled with compactc 0.36.0 (`midnight:verifier-key[v6]`).
 */
const BASE64 = [
  'bWlkbmlnaHQ6dmVyaWZpZXIta2V5W3Y3XTq1FAIAAAAAAQAAAAAAAAAAAAAABAYLAAAAAwYTAAAA',
  'iZDSbhomCnHCh0siuc91i7k6Rb78HaMvWJEw6fbH+4Ig+Z3gVvvypNKfRhfvUzAqoW9dSDy+bT4R',
  'uFSsE9AVMhKWDS481XTUYXVBxhKQ/ES+g2QlhScqv+XF5R2qJX/wh5kbdU8mYW5NF9pOwqZkRYPR',
  'DD1kao0t+lggZxxBWtXj/d98AwX3E8Kg0NoCpdQhqYIr13cSgNmiVUIx59/mhGyYrkZdpyMUyVoN',
  'g0erM/aPcHMhfjJMMmKWFLJOmbyCi7e4Td4ciLuGf1dVhDgMgQ3JcTlRstPjTsOcVv4Ohk7XG3R/',
  'gdvUWSzGV48Z/b4BrEuDXky3CJy8zuKZn6Fkad/RYe4meh7/Y2GVUu7CDrp0GuH5cu1YUhFaap44',
  'Mcy6gCDyd+E7j2n0WfSgzfkcgcUwWYi11niDsCyQjJuTC0sFjEkbCmfC6G6AWxI9t5CwkvhIVa1H',
  'sJ+pWJ2iOk9WGQMVZCjCEvSkoiNj0zzHIb2NAuksBEIPw4/2lzKpY25Yl9yLfV9U6mJA0mS9Jm+a',
  'JKEnrzaYGIzEjv02Zf+CFkjHSUp1XZXxjcTbKYc/mDqboFsoZ5jVgEIXklHeTU1jLTqJHpT9YqzD',
  'y9+HTC/I3Wyi2A4ceM9NJVCnpc/kCWIUwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAqDeJ',
  '+1UDMxUWKhI2JXz3vPTsasoqX+tf5k0PGUlcLIqK51c5YHZai/8YzS45LBB2wAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAo5+v/HV0v3BSydgKYWZ3SVE/nxo4',
  'y8F1sVqixy6ciugaIAwbUSbOZI4SHdgJCXb+wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAtdjIkZojID26Oo6ifgRTepu6rXIN6WUPS9P3uWmI/tnRwHJ8JEVQ',
  'jky1HiNrOs2wrTIuBfvOHiZnqZaou1I2RANld6IaFIljkvf8sBQg7GL3jGrtGBi0PfJatjFRIlge',
  'qexNom2eYth4qwve/Glhybdcw/N3maD9rVBWqIKkYKQ/Qy7HTTrd+I93owsljtNxj+3ohFB7vvA1',
  '2vBV4ZXNyrJiLy+fMkoc8GKEd/b3QgwWvrEPvlGOQXIwUnrD1U58ot29/uHkPSCv+mTFizl5J4ME',
  '20rjOrh9+XkQwxA+f6rg/K91hQiNpGZB0aCEv1ulk1oX3qF5YHW6DJZ63WakwQnk+YcP+zuoBpLA',
  'mjSPQsql9dLwAxi8V6yYwtnIhb4xudNB1Fb0fsJC+WFebwgYmjeNEwBV8sua4wKJnpCBjT67knyy',
  'ylMnku/B1O2ARfy8i+bs+9ASx/LQ/u7gs/+BWqT2Q9YOW6jYSh2U6VPtd/QEwGOGY8ZCqiJN7NGL',
  'qunAgJhvchWpteS8aWCKyut1XMDtTde9iJdtoH6cR3VvHJuQ70lMXMMDGsbJtVcP5cRdsqzy8ag8',
  '1+YbtAMKe7DEoxs6XheEZr33qIREJSo2QGNQFEuzcC/H4jjSKMeCBqan',
].join('');

export const DRY_VERIFIER_KEY: Uint8Array = Uint8Array.from(
  Buffer.from(BASE64, 'base64'),
);
