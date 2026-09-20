const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function decodeKey(encodedKey) {
  if (typeof encodedKey !== "string" || encodedKey.trim() === "") {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to store Xero tokens.");
  }

  const normalizedKey = encodedKey.trim();
  const key = Buffer.from(normalizedKey, "base64");
  if (key.length !== KEY_LENGTH || key.toString("base64") !== normalizedKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

class TokenCipher {
  constructor({ key, keyVersion = "1" }) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
      throw new Error("The token encryption key must be a 32-byte Buffer.");
    }
    this.key = Buffer.from(key);
    this.keyVersion = String(keyVersion);
  }

  static fromEnvironment(env = process.env) {
    return new TokenCipher({
      key: decodeKey(env.TOKEN_ENCRYPTION_KEY),
      keyVersion: env.TOKEN_ENCRYPTION_KEY_VERSION || "1",
    });
  }

  encrypt(plaintext, context) {
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      throw new Error("A non-empty token is required for encryption.");
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);

    return {
      algorithm: ALGORITHM,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      keyVersion: this.keyVersion,
    };
  }

  decrypt(encryptedValue, context) {
    if (!encryptedValue || encryptedValue.algorithm !== ALGORITHM) {
      throw new Error("The stored token uses an unsupported encryption format.");
    }
    if (String(encryptedValue.keyVersion) !== this.keyVersion) {
      throw new Error("No token encryption key is available for the stored key version.");
    }

    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        this.key,
        Buffer.from(encryptedValue.iv, "base64"),
      );
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(Buffer.from(encryptedValue.authTag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("The stored token could not be decrypted or failed integrity validation.");
    }
  }
}

module.exports = TokenCipher;
