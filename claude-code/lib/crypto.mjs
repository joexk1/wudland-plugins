// Wudland Link crypto primitives (see PROTOCOL.md). Node built-ins only.
import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes,
} from 'node:crypto';

// DER prefixes that wrap a raw 32-byte X25519 key.
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

export const PAIR_INFO = 'wudland-pair-v1';

/** Fresh X25519 pair as raw 32-byte buffers: { publicKey, privateKey }. */
export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(SPKI_PREFIX.length),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(PKCS8_PREFIX.length),
  };
}

/** Raw public key for a raw private key. */
export function publicFromPrivate(rawPrivate) {
  const pub = createPublicKey(privateKeyObject(rawPrivate));
  return pub.export({ type: 'spki', format: 'der' }).subarray(SPKI_PREFIX.length);
}

function privateKeyObject(raw) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' });
}

function publicKeyObject(raw) {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** X25519 shared secret from our raw private key and their raw public key. */
export function sharedSecret(rawPrivate, rawPeerPublic) {
  return diffieHellman({ privateKey: privateKeyObject(rawPrivate), publicKey: publicKeyObject(rawPeerPublic) });
}

/** HKDF-SHA256 to 32 bytes. salt and info may be Buffers or strings. */
export function hkdf(ikm, salt, info, length = 32) {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

/** Pairing key: HKDF(X25519(priv, peerPub), salt = plugin nonce, info = "wudland-pair-v1"). */
export function derivePairKey(rawPrivate, rawPeerPublic, nonce) {
  return hkdf(sharedSecret(rawPrivate, rawPeerPublic), nonce, PAIR_INFO, 32);
}

/** AES-256-GCM seal. Returns base64 of nonce(12) || ciphertext || tag(16). */
export function seal(key, plaintext, nonce = randomBytes(12)) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString('base64');
}

/** Open a base64 box. Returns a Buffer, or throws if it does not authenticate. */
export function open(key, boxB64) {
  const raw = Buffer.from(boxB64, 'base64');
  if (raw.length < 28) throw new Error('box too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
}

/** Pair topic for a 6-digit code. */
export function pairTopic(code) {
  const hex = createHash('sha256').update(`wudland-pair-v1:${code}`).digest('hex');
  return `wudland-pair-${hex.slice(0, 24)}`;
}

export const b64 = (buf) => Buffer.from(buf).toString('base64');
export const unb64 = (s) => Buffer.from(s, 'base64');
export const randomHex = (n) => randomBytes(n).toString('hex');

/** Compare on both devices before approving a pairing. Never transmit this value. */
export function verificationCode(key) {
  const value = createHash('sha256').update('wudland-verify-v2:').update(key).digest().readUInt32BE(0) % 100000000;
  const digits = String(value).padStart(8, '0');
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

/** Pairing commitment: SHA256(rawPublicKey || nonce), base64. Sent in the hello so the
    plugin's public key can only be revealed after the phone's challenge. */
export function commitment(pk, nonce) {
  return b64(createHash('sha256').update(Buffer.concat([Buffer.from(pk), Buffer.from(nonce)])).digest());
}

/** Check a base64 commitment against raw pk and nonce. */
export function verifyCommitment(commitB64, pk, nonce) {
  const raw = unb64(commitB64);
  const expected = createHash('sha256').update(Buffer.concat([Buffer.from(pk), Buffer.from(nonce)])).digest();
  return raw.length === 32 && raw.equals(expected);
}
