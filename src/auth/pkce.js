/**
 * PKCE — Proof Key for Code Exchange
 *
 * Cos'è PKCE: OAuth standard per app pubbliche (senza client_secret).
 * Il browser genera una coppia casuale code_verifier + code_challenge.
 * code_challenge = SHA-256(code_verifier) in base64url.
 * Spotify verifica che il code usato nel callback corrisponda al verifier.
 * Questo impedisce attacchi di intercettazione del authorization code.
 */

/**
 * Genera una stringa casuale crittograficamente sicura (code_verifier).
 * @param {number} length - lunghezza in byte (default 64 → ~86 chars base64url)
 * @returns {string}
 */
export function generateCodeVerifier(length = 64) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/**
 * Calcola SHA-256 del verifier e lo converte in base64url (code_challenge).
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

/**
 * Converte Uint8Array in stringa base64url (senza padding =, con - e _ invece di + e /).
 * @param {Uint8Array} array
 * @returns {string}
 */
function base64urlEncode(array) {
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
