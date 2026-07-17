import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { encryptCredentials, decryptCredentials } from '../utils/encryption';

describe('Encryption Utils', () => {
  const testData = {
    apiKey: 'sk_live_123456789',
    secret: 'rk_live_abcdefghij',
    accountId: 'acc_12345',
  };

  it('should encrypt and decrypt credentials', () => {
    const encrypted = encryptCredentials(testData);
    
    // Check format: iv:authTag:encrypted
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(32); 
    expect(parts[1]).toHaveLength(32); 
    
    // Decrypt and verify
    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toEqual(testData);
  });

  it('should produce different ciphertext each time (IV randomness)', () => {
    const encrypted1 = encryptCredentials(testData);
    const encrypted2 = encryptCredentials(testData);
    
    expect(encrypted1).not.toBe(encrypted2);
    
    // But both should decrypt to same data
    expect(decryptCredentials(encrypted1)).toEqual(testData);
    expect(decryptCredentials(encrypted2)).toEqual(testData);
  });

  it('should throw on invalid encryption key', () => {
    process.env.ENCRYPTION_KEY = 'invalid';
    
    expect(() => encryptCredentials(testData)).toThrow();
  });

  it('should throw on corrupted encrypted data', () => {
    expect(() => decryptCredentials('corrupted:data:here')).toThrow();
  });
});