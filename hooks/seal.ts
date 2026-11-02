// What goes to ntfy.sh, sealed with a key only the PC and your phone app
// hold, for /narsil movil clave: whoever reads the topic sees only noise.
// The hooks module's crypto has SHA-256 alone, so this is HMAC-SHA256 built
// on it: the HMAC of a nonce and a counter is the keystream (CTR), and a
// second HMAC over the nonce and the ciphertext proves it (encrypt-then-MAC).
// The phone app opens it with WebCrypto's HMAC, which gives the same bytes.

export const SEAL_PREFIX = 'narsil1:'
const NONCE = 16
const BLOCK = 32

const utf8 = new TextEncoder()

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = new Uint8Array(64)
  k.set(key.length > 64 ? await sha256(key) : key)
  const pad = (byte: number) => k.map(b => b ^ byte)
  return sha256(join(pad(0x5c), await sha256(join(pad(0x36), data))))
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, c => c.charCodeAt(0))
}

// A new key, as /narsil movil clave shows it: 32 random bytes.
export function newKey(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

// `text` sealed: the prefix, then the nonce, the ciphertext and the tag.
export async function seal(key: string, text: string, nonce = crypto.getRandomValues(new Uint8Array(NONCE))): Promise<string> {
  const k = fromBase64Url(key)
  const encKey = await hmac(k, utf8.encode('enc'))
  const macKey = await hmac(k, utf8.encode('mac'))
  const plain = utf8.encode(text)
  const cipher = new Uint8Array(plain.length)
  for (let i = 0; i * BLOCK < plain.length; i++) {
    const counter = new Uint8Array(4)
    new DataView(counter.buffer).setUint32(0, i)
    const stream = await hmac(encKey, join(nonce, counter))
    for (let j = 0; j < BLOCK && i * BLOCK + j < plain.length; j++) cipher[i * BLOCK + j] = plain[i * BLOCK + j] ^ stream[j]
  }
  const tag = await hmac(macKey, join(nonce, cipher))
  return SEAL_PREFIX + toBase64Url(join(nonce, cipher, tag))
}

// How many bytes a sealed text of `bytes` takes: ntfy.sh keeps a message
// under 4096 bytes as text.
export function sealedLength(bytes: number): number {
  return SEAL_PREFIX.length + Math.ceil(((NONCE + bytes + BLOCK) * 4) / 3)
}
