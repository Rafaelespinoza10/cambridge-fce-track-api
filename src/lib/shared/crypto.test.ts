import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';

import { encrypt, decrypt } from './crypto';

const TEST_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
const ORIGINAL_KEY = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

describe('crypto encrypt/decrypt', () => {
  it('round-trips a plaintext string', () => {
    const ciphertext = encrypt('spotify-refresh-token-value');
    assert.equal(decrypt(ciphertext), 'spotify-refresh-token-value');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const first = encrypt('same-value');
    const second = encrypt('same-value');
    assert.notEqual(first, second);
  });

  it('throws when the ciphertext has been tampered with', () => {
    const ciphertext = encrypt('secret');
    const buf = Buffer.from(ciphertext, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    assert.throws(() => decrypt(tampered));
  });

  it('throws when the encryption key env var is missing', () => {
    delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
    assert.throws(() => encrypt('secret'), /SPOTIFY_TOKEN_ENCRYPTION_KEY is not configured/);
  });

  it('throws when the encryption key does not decode to 32 bytes', () => {
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    assert.throws(() => encrypt('secret'), /must decode to 32 bytes/);
  });
});
