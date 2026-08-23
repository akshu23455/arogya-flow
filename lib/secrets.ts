import { env } from "cloudflare:workers";

function encryptionKeyBytes(): Uint8Array {
  const value = (env as unknown as Record<string, unknown>).TOKEN_ENCRYPTION_KEY;
  if (typeof value !== "string") throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return bytes;
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function encryptSecret(plainText: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", encryptionKeyBytes(), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText)));
  return `${encode(iv)}.${encode(ciphertext)}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [ivText, ciphertextText] = stored.split(".");
  if (!ivText || !ciphertextText) throw new Error("Stored token is invalid");
  const key = await crypto.subtle.importKey("raw", encryptionKeyBytes(), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(ivText) }, key, decode(ciphertextText));
  return new TextDecoder().decode(plain);
}
