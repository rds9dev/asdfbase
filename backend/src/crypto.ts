import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit recommended for GCM
const PREFIX = 'enc:v1:';

const MASTER_SECRET =
  process.env.MESSAGE_ENCRYPTION_KEY ||
  process.env.JWT_SECRET ||
  'asdfbase-secure-default-key-change-me-32b';

// Derive 256-bit key using HKDF based on context (e.g. channelId)
function deriveKey(context = 'general'): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', MASTER_SECRET, 'asdfbase-salt', context, 32));
}

export function isEncrypted(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith(PREFIX);
}

export function encryptMessageContent(text: string | null | undefined, channelId?: number | string | null): string {
  if (text == null) return '';
  if (typeof text !== 'string') text = String(text);
  if (!text || isEncrypted(text)) return text;

  try {
    const context = channelId ? `ch-${channelId}` : 'general';
    const key = deriveKey(context);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    if (channelId != null) {
      cipher.setAAD(Buffer.from(String(channelId), 'utf8'));
    }

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err: any) {
    console.error('[crypto] encryptMessageContent failed:', err.message);
    return text;
  }
}

export function decryptMessageContent(encryptedText: string | null | undefined, channelId?: number | string | null): string {
  if (encryptedText == null) return '';
  if (typeof encryptedText !== 'string') return String(encryptedText);
  if (!isEncrypted(encryptedText)) return encryptedText;

  const parts = encryptedText.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return encryptedText;

  const [ivHex, authTagHex, cipherHex] = parts;
  try {
    const context = channelId ? `ch-${channelId}` : 'general';
    const key = deriveKey(context);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    if (channelId != null) {
      decipher.setAAD(Buffer.from(String(channelId), 'utf8'));
    }

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // If context with channelId fails, try general context as fallback (for migrated or cross-channel items)
    if (channelId != null) {
      try {
        const keyFallback = deriveKey('general');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, keyFallback, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch {
        // Fallback failed
      }
    }
    return encryptedText;
  }
}

export function encryptJson(obj: unknown, channelId?: number | string | null): string {
  if (obj == null) return '';
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return encryptMessageContent(text, channelId);
}

export function decryptJson<T = any>(encryptedText: unknown, channelId?: number | string | null): T | null {
  if (encryptedText == null) return null;
  if (typeof encryptedText !== 'string') return encryptedText as T;
  const decrypted = decryptMessageContent(encryptedText, channelId);
  try {
    return JSON.parse(decrypted) as T;
  } catch {
    return decrypted as unknown as T;
  }
}
