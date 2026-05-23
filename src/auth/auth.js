/**
 * Auth — flusso OAuth PKCE completo + refresh token
 *
 * Flusso:
 * 1. login()      → genera verifier/challenge, salva verifier, redirect a Spotify
 * 2. handleCallback() → intercetta ?code= nell'URL, scambia con token, salva
 * 3. spotifyFetch()   → chiama API con Bearer token, gestisce scadenza e 429
 */

import {
  SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES, REDIRECT_URI,
  SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL, SPOTIFY_API_BASE,
} from './config.js';
import { generateCodeVerifier, generateCodeChallenge } from './pkce.js';
import { getAuth, saveAuth, clearAuth, isTokenExpired } from './storage.js';

// Chiave temporanea in sessionStorage per il code_verifier (solo durante il redirect)
const VERIFIER_KEY = 'rr_pkce_verifier';

// ---- Login ----

/**
 * Avvia il flusso OAuth: genera PKCE, salva verifier, redirect a Spotify.
 */
export async function login() {
  console.log('[Auth] Avvio login PKCE...');

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  // Salva il verifier in sessionStorage: sopravvive al redirect ma non alla chiusura del tab
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  console.log('[Auth] Code verifier generato e salvato in sessionStorage');

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    // state opzionale — aggiungiamo per sicurezza (CSRF basic)
    state: crypto.randomUUID(),
  });

  const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  console.log('[Auth] Redirect a Spotify:', authUrl);
  window.location.href = authUrl;
}

// ---- Callback ----

/**
 * Gestisce il ritorno da Spotify con ?code=...
 * Deve essere chiamato se window.location.pathname === '/callback' (o equivalente)
 * @returns {Promise<boolean>} true se autenticazione riuscita
 */
export async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    console.error('[Auth] Spotify ha restituito errore:', error);
    return false;
  }

  if (!code) {
    console.log('[Auth] Nessun code nel callback URL — non siamo in callback');
    return false;
  }

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    console.error('[Auth] Code verifier non trovato in sessionStorage. Riprova il login.');
    return false;
  }

  console.log('[Auth] Code ricevuto, scambio con token...');

  try {
    const body = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('[Auth] Token exchange fallito:', err);
      return false;
    }

    const tokens = await response.json();
    console.log('[Auth] Token ricevuti:', {
      access_token: tokens.access_token?.slice(0, 20) + '...',
      refresh_token: tokens.refresh_token?.slice(0, 20) + '...',
      expires_in: tokens.expires_in,
    });

    saveAuth(tokens);
    sessionStorage.removeItem(VERIFIER_KEY);

    // Pulisce i parametri dall'URL senza ricaricare la pagina
    const cleanUrl = window.location.pathname.replace('/callback', '') || '/';
    window.history.replaceState({}, document.title, cleanUrl);

    console.log('[Auth] Login completato con successo');
    return true;

  } catch (e) {
    console.error('[Auth] Errore durante token exchange:', e);
    return false;
  }
}

// ---- Refresh Token ----

let refreshPromise = null; // evita refresh concorrenti

/**
 * Ottiene un nuovo access_token usando il refresh_token.
 * @returns {Promise<string|null>} nuovo access_token o null se fallisce
 */
export async function refreshAccessToken() {
  // Se c'è già un refresh in corso, aspetta quello (evita doppio refresh)
  if (refreshPromise) {
    console.log('[Auth] Refresh già in corso, attendo...');
    return refreshPromise;
  }

  const auth = getAuth();
  if (!auth?.refresh_token) {
    console.error('[Auth] Nessun refresh token disponibile');
    return null;
  }

  console.log('[Auth] Refreshing access token...');

  refreshPromise = (async () => {
    try {
      const body = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
      });

      const response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!response.ok) {
        const err = await response.json();
        console.error('[Auth] Refresh fallito:', err);
        clearAuth();
        return null;
      }

      const tokens = await response.json();

      // Spotify può restituire un nuovo refresh_token — usiamo quello se presente
      const newTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || auth.refresh_token,
        expires_in: tokens.expires_in,
      };

      saveAuth(newTokens);
      console.log('[Auth] Token refreshato con successo');
      return newTokens.access_token;

    } catch (e) {
      console.error('[Auth] Errore durante refresh:', e);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ---- isLoggedIn ----

export function isLoggedIn() {
  const auth = getAuth();
  return !!(auth?.access_token && auth?.refresh_token);
}

// ---- spotifyFetch ----

/**
 * Fetch autenticato verso Spotify API.
 * Gestisce automaticamente:
 * - aggiunta header Authorization: Bearer
 * - refresh token se access_token scaduto
 * - retry su 401 (token appena scaduto)
 * - exponential backoff su 429 (rate limit)
 *
 * @param {string} endpoint  - path relativo, es. '/me' o '/playlists/123/items'
 * @param {RequestInit} options - opzioni fetch standard
 * @param {number} _retryCount - uso interno per recursione
 * @returns {Promise<any>} JSON parsed response
 */
export async function spotifyFetch(endpoint, options = {}, _retryCount = 0) {
  const MAX_RETRIES = 3;

  // Refresh preventivo se il token è scaduto
  let auth = getAuth();
  if (isTokenExpired()) {
    console.log('[spotifyFetch] Token scaduto, refresh preventivo...');
    const newToken = await refreshAccessToken();
    if (!newToken) throw new Error('AUTH_EXPIRED');
    auth = getAuth();
  }

  const url = `${SPOTIFY_API_BASE}${endpoint}`;
  console.log(`[spotifyFetch] ${options.method || 'GET'} ${endpoint}`);

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${auth.access_token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // 401 → token scaduto a runtime, refresh e retry
  if (response.status === 401 && _retryCount < MAX_RETRIES) {
    console.warn('[spotifyFetch] 401 ricevuto, refresh e retry...');
    const newToken = await refreshAccessToken();
    if (!newToken) throw new Error('AUTH_EXPIRED');
    return spotifyFetch(endpoint, options, _retryCount + 1);
  }

  // 429 → rate limit: leggi Retry-After e aspetta
  if (response.status === 429 && _retryCount < MAX_RETRIES) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
    const waitMs = (retryAfter + 1) * 1000;
    console.warn(`[spotifyFetch] 429 Rate limit. Attendo ${waitMs}ms prima del retry ${_retryCount + 1}/${MAX_RETRIES}...`);
    await sleep(waitMs);
    return spotifyFetch(endpoint, options, _retryCount + 1);
  }

  // Errori non recuperabili
  if (!response.ok) {
    let errBody = {};
    try { errBody = await response.json(); } catch (_) {}
    const msg = `[spotifyFetch] HTTP ${response.status} su ${endpoint}: ${JSON.stringify(errBody)}`;
    console.error(msg);
    throw new Error(`SPOTIFY_API_ERROR_${response.status}`);
  }

  // 204 No Content (es. dopo PUT playlist tracks)
  if (response.status === 204) return null;

  return response.json();
}

// ---- Utility ----

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
