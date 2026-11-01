// Regenerates test/vectors.json (fixed inputs, so the output is deterministic).
import { writeFileSync } from 'node:fs';
import { derivePairKey, pairTopic, publicFromPrivate, seal, sharedSecret } from '../lib/crypto.mjs';

const hex = (n, f) => Buffer.alloc(n, f);
const appPriv = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const pluginPriv = Buffer.from(Array.from({ length: 32 }, (_, i) => 0xa0 + i));
const salt = Buffer.from(Array.from({ length: 16 }, (_, i) => 0x10 + i));
const boxKey = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x40 + i));
const nonce = Buffer.from(Array.from({ length: 12 }, (_, i) => 0x70 + i));
const plaintext = '{"v":1,"sid":"s1","src":"claude","host":"studio","name":"Fix the login bug","state":"busy"}';

const v = {
  note: 'Fixed vectors for checking Swift/CryptoKit interop with PROTOCOL.md. All binary values are hex unless named base64.',
  box: {
    key: boxKey.toString('hex'),
    nonce: nonce.toString('hex'),
    plaintext,
    boxBase64: seal(boxKey, plaintext, nonce),
    format: 'base64(nonce12 || ciphertext || tag16)',
  },
  pairing: {
    appPrivateKey: appPriv.toString('hex'),
    appPublicKey: publicFromPrivate(appPriv).toString('hex'),
    pluginPrivateKey: pluginPriv.toString('hex'),
    pluginPublicKey: publicFromPrivate(pluginPriv).toString('hex'),
    sharedSecret: sharedSecret(appPriv, publicFromPrivate(pluginPriv)).toString('hex'),
    hkdfHash: 'SHA-256',
    hkdfSalt: salt.toString('hex'),
    hkdfInfo: 'wudland-pair-v1',
    derivedKey: derivePairKey(appPriv, publicFromPrivate(pluginPriv), salt).toString('hex'),
  },
  pairTopic: { code: '123456', topic: pairTopic('123456') },
};
writeFileSync(new URL('../test/vectors.json', import.meta.url), JSON.stringify(v, null, 2) + '\n');
