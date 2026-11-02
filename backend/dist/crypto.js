"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEncrypted = isEncrypted;
exports.encryptMessageContent = encryptMessageContent;
exports.decryptMessageContent = decryptMessageContent;
exports.encryptJson = encryptJson;
exports.decryptJson = decryptJson;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit recommended for GCM
const PREFIX = 'enc:v1:';
const MASTER_SECRET = process.env.MESSAGE_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'asdfbase-secure-default-key-change-me-32b';
// Derive 256-bit key using HKDF based on context (e.g. channelId)
function deriveKey(context = 'general') {
    return Buffer.from(crypto_1.default.hkdfSync('sha256', MASTER_SECRET, 'asdfbase-salt', context, 32));
}
function isEncrypted(text) {
    return typeof text === 'string' && text.startsWith(PREFIX);
}
function encryptMessageContent(text, channelId) {
    if (text == null)
        return '';
    if (typeof text !== 'string')
        text = String(text);
    if (!text || isEncrypted(text))
        return text;
    try {
        const context = channelId ? `ch-${channelId}` : 'general';
        const key = deriveKey(context);
        const iv = crypto_1.default.randomBytes(IV_LENGTH);
        const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
        if (channelId != null) {
            cipher.setAAD(Buffer.from(String(channelId), 'utf8'));
        }
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    }
    catch (err) {
        console.error('[crypto] encryptMessageContent failed:', err.message);
        return text;
    }
}
function decryptMessageContent(encryptedText, channelId) {
    if (encryptedText == null)
        return '';
    if (typeof encryptedText !== 'string')
        return String(encryptedText);
    if (!isEncrypted(encryptedText))
        return encryptedText;
    const parts = encryptedText.slice(PREFIX.length).split(':');
    if (parts.length !== 3)
        return encryptedText;
    const [ivHex, authTagHex, cipherHex] = parts;
    try {
        const context = channelId ? `ch-${channelId}` : 'general';
        const key = deriveKey(context);
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        if (channelId != null) {
            decipher.setAAD(Buffer.from(String(channelId), 'utf8'));
        }
        let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    catch {
        // If context with channelId fails, try general context as fallback (for migrated or cross-channel items)
        if (channelId != null) {
            try {
                const keyFallback = deriveKey('general');
                const iv = Buffer.from(ivHex, 'hex');
                const authTag = Buffer.from(authTagHex, 'hex');
                const decipher = crypto_1.default.createDecipheriv(ALGORITHM, keyFallback, iv);
                decipher.setAuthTag(authTag);
                let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            }
            catch {
                // Fallback failed
            }
        }
        return encryptedText;
    }
}
function encryptJson(obj, channelId) {
    if (obj == null)
        return '';
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return encryptMessageContent(text, channelId);
}
function decryptJson(encryptedText, channelId) {
    if (encryptedText == null)
        return null;
    if (typeof encryptedText !== 'string')
        return encryptedText;
    const decrypted = decryptMessageContent(encryptedText, channelId);
    try {
        return JSON.parse(decrypted);
    }
    catch {
        return decrypted;
    }
}
