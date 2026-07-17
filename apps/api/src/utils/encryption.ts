import crypto from 'crypto';

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
    );
  }
  
  if (key.length !== 64) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${key.length} chars`
    );
  }
  
  return Buffer.from(key, 'hex');
}

export function encryptCredentials(data: object): string {
  try {
    const KEY_BUFFER = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY_BUFFER, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err) {
    throw new Error(
      `Encryption failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

export function decryptCredentials(encryptedData: string): object {
  try {
    const KEY_BUFFER = getEncryptionKey();
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format: expected 3 parts (iv:authTag:encrypted)');
    }

    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY_BUFFER, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (err) {
    throw new Error(
      `Decryption failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}