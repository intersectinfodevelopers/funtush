import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { encryptCredentials, decryptCredentials } from '../utils/encryption';

describe('Encryption Utils', () => {
  beforeAll(() => {
    // Use test key if ENCRYPTION_KEY not set (for CI)
    if (!process.env.ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes in hex
    }
  });

  const testData = {
    apiKey: 'sk_live_123456789',
    secret: 'rk_live_abcdefghij',
    accountId: 'acc_12345',
  };

  it('should encrypt and decrypt credentials', () => {
    const encrypted = encryptCredentials(testData);
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(32);
    expect(parts[1]).toHaveLength(32);

    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toEqual(testData);
  });

  it('should produce different ciphertext each time (IV randomness)', () => {
    const encrypted1 = encryptCredentials(testData);
    const encrypted2 = encryptCredentials(testData);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decryptCredentials(encrypted1)).toEqual(testData);
    expect(decryptCredentials(encrypted2)).toEqual(testData);
  });

  it('should throw on corrupted encrypted data', () => {
    expect(() => decryptCredentials('corrupted:data:here')).toThrow();
  });
});