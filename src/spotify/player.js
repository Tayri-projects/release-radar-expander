/**
 * player.js — controllo riproduzione tramite Spotify Connect API + Web Playback SDK fallback.
 *
 * Strategia "play resta nella webapp":
 *   1. Cerca un dispositivo Spotify attivo → suona lì
 *   2. Se nessuno è attivo ma ci sono dispositivi disponibili → transferPlayback sul primo
 *   3. Se non ci sono dispositivi → inizializza il Web Playback SDK e usa la webapp
 *      stessa come dispositivo virtuale
 *
 * Tutti i path richiedono Premium (limite Spotify API).
 *
 * Note iOS Safari (FYI, non implementato qui poiché l'utente è su Android):
 *   - Il SDK non funziona affidabilmente per autoplay policies + audio context
 *   - In quel caso bisognerebbe degradare al deep link spotify:
 */

import { spotifyFetch } from '../auth/auth.js';
import { getAuth } from '../auth/storage.js';

const SDK_SCRIPT_SRC = 'https://sdk.scdn.co/spotify-player.js';
const SDK_NAME = 'Release Radar Expander (Web)';

// Stato SDK (cache locale)
let sdkScriptInjected = false;
let sdkReadyPromise = null; // promise che risolve con device_id quando SDK è pronto
let sdkPlayer = null;       // riferimento all'oggetto Spotify.Player
let sdkDeviceId = null;     // device_id dello SDK (quando ready)

// ---- Devices ----

/**
 * Lista dispositivi Spotify disponibili dell'utente.
 * @returns {Promise<Array<{id, is_active, name, type}>>}
 */
export async function listDevices() {
  console.log('[Player] GET /me/player/devices');
  const data = await spotifyFetch('/me/player/devices');
  const devices = data?.devices || [];
  console.log(`[Player] Dispositivi disponibili: ${devices.length}`,
    devices.map(d => `${d.name}(${d.type}, active=${d.is_active})`).join(' | ') || '(nessuno)');
  return devices;
}

/**
 * Trasferisce la riproduzione su un device specifico.
 * @param {string} deviceId
 * @param {boolean} play - se true avvia automaticamente
 */
export async function transferPlayback(deviceId, play = false) {
  console.log(`[Player] PUT /me/player → trasferisco su ${deviceId}, play=${play}`);
  await spotifyFetch('/me/player', {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}

// ---- Web Playback SDK ----

function injectSDKScript() {
  if (sdkScriptInjected) return;
  if (document.querySelector(`script[src="${SDK_SCRIPT_SRC}"]`)) {
    sdkScriptInjected = true;
    return;
  }
  console.log('[Player] Iniezione script SDK Spotify...');
  const script = document.createElement('script');
  script.src = SDK_SCRIPT_SRC;
  script.async = true;
  document.body.appendChild(script);
  sdkScriptInjected = true;
}

/**
 * Inizializza (lazy) il Web Playback SDK e ritorna il device_id quando pronto.
 * Idempotente: chiamate successive risolvono con lo stesso device_id.
 *
 * Importante: richiede di essere chiamato in seguito a una gesture utente per
 * sbloccare l'audio context sul browser.
 */
export function ensureSDKReady() {
  if (sdkDeviceId) {
    console.log('[Player] SDK già pronto, device_id:', sdkDeviceId);
    return Promise.resolve(sdkDeviceId);
  }
  if (sdkReadyPromise) {
    console.log('[Player] SDK già in inizializzazione, attendo...');
    return sdkReadyPromise;
  }

  injectSDKScript();

  sdkReadyPromise = new Promise((resolve, reject) => {
    const TIMEOUT_MS = 12000;
    const timeout = setTimeout(() => {
      console.error('[Player] Timeout inizializzazione SDK');
      reject(new Error('SDK_INIT_TIMEOUT'));
    }, TIMEOUT_MS);

    // Spotify chiama questa callback globale quando lo script è caricato
    window.onSpotifyWebPlaybackSDKReady = () => {
      console.log('[Player] onSpotifyWebPlaybackSDKReady fired');

      sdkPlayer = new window.Spotify.Player({
        name: SDK_NAME,
        getOAuthToken: (cb) => {
          const auth = getAuth();
          if (!auth?.access_token) {
            console.error('[Player] SDK getOAuthToken: token assente');
            return;
          }
          cb(auth.access_token);
        },
        volume: 0.8,
      });

      sdkPlayer.addListener('ready', ({ device_id }) => {
        console.log('[Player] SDK ready — device_id:', device_id);
        sdkDeviceId = device_id;
        clearTimeout(timeout);
        resolve(device_id);
      });

      sdkPlayer.addListener('not_ready', ({ device_id }) => {
        console.warn('[Player] SDK device offline:', device_id);
      });

      sdkPlayer.addListener('initialization_error', ({ message }) => {
        console.error('[Player] SDK initialization_error:', message);
        clearTimeout(timeout);
        reject(new Error('SDK_INIT_ERROR: ' + message));
      });
      sdkPlayer.addListener('authentication_error', ({ message }) => {
        console.error('[Player] SDK authentication_error:', message);
        clearTimeout(timeout);
        reject(new Error('SDK_AUTH_ERROR: ' + message));
      });
      sdkPlayer.addListener('account_error', ({ message }) => {
        console.error('[Player] SDK account_error:', message, '(Premium richiesto)');
        clearTimeout(timeout);
        reject(new Error('SDK_ACCOUNT_ERROR'));
      });
      sdkPlayer.addListener('playback_error', ({ message }) => {
        console.warn('[Player] SDK playback_error:', message);
      });

      sdkPlayer.connect().then(success => {
        console.log('[Player] SDK connect() result:', success);
        if (!success) {
          clearTimeout(timeout);
          reject(new Error('SDK_CONNECT_FAILED'));
        }
      });
    };
  });

  return sdkReadyPromise;
}

// ---- Risoluzione device ----

/**
 * Risolve il device su cui suonare:
 *   1. device active → usalo
 *   2. nessuno active ma esistono device → transfer sul primo
 *   3. nessun device → inizializza SDK e usalo
 *
 * @returns {Promise<{deviceId: string, source: 'active'|'transferred'|'sdk'}>}
 */
export async function resolvePlaybackDevice() {
  let devices = await listDevices();

  // 1. Active device
  const active = devices.find(d => d.is_active);
  if (active) {
    console.log('[Player] Uso device attivo:', active.name);
    return { deviceId: active.id, source: 'active' };
  }

  // 2. Devices disponibili ma nessuno attivo → wake il primo
  if (devices.length > 0) {
    const first = devices[0];
    console.log(`[Player] Nessun device attivo, transferisco su: ${first.name}`);
    await transferPlayback(first.id, false);
    return { deviceId: first.id, source: 'transferred' };
  }

  // 3. Nessun device → SDK fallback
  console.log('[Player] Nessun device disponibile, inizializzo SDK...');
  const deviceId = await ensureSDKReady();
  // Trasferisci esplicitamente il playback sul device SDK
  await transferPlayback(deviceId, false);
  return { deviceId, source: 'sdk' };
}

// ---- Stato riproduzione + controlli trasporto (Now Playing bar) ----

/**
 * Legge lo stato di riproduzione corrente.
 * GET /me/player → 200 con oggetto playback, oppure 204 (= nessun device attivo)
 * che spotifyFetch converte in null.
 * @returns {Promise<object|null>} { is_playing, item, progress_ms, device, ... } o null
 */
export async function getPlaybackState() {
  try {
    const state = await spotifyFetch('/me/player');
    if (!state) {
      console.log('[Player] getPlaybackState: nessun device attivo (204/null)');
      return null;
    }
    console.log('[Player] getPlaybackState:', {
      is_playing: state.is_playing,
      track: state.item?.name,
      uri: state.item?.uri,
      progress_ms: state.progress_ms,
    });
    return state;
  } catch (e) {
    console.warn('[Player] getPlaybackState fallito (non bloccante):', e.message);
    return null;
  }
}

/**
 * Mette in pausa la riproduzione corrente.
 */
export async function pausePlayback() {
  console.log('[Player] PUT /me/player/pause');
  try {
    await spotifyFetch('/me/player/pause', { method: 'PUT' });
  } catch (e) {
    console.warn('[Player] pausePlayback fallito:', e.message);
    throw e;
  }
}

/**
 * Riprende la riproduzione (resume) senza body → continua la traccia corrente.
 */
export async function resumePlayback() {
  console.log('[Player] PUT /me/player/play (resume)');
  try {
    await spotifyFetch('/me/player/play', { method: 'PUT' });
  } catch (e) {
    console.warn('[Player] resumePlayback fallito:', e.message);
    throw e;
  }
}

/**
 * Traccia successiva.
 */
export async function nextTrack() {
  console.log('[Player] POST /me/player/next');
  try {
    await spotifyFetch('/me/player/next', { method: 'POST' });
  } catch (e) {
    console.warn('[Player] nextTrack fallito:', e.message);
    throw e;
  }
}

/**
 * Traccia precedente.
 */
export async function previousTrack() {
  console.log('[Player] POST /me/player/previous');
  try {
    await spotifyFetch('/me/player/previous', { method: 'POST' });
  } catch (e) {
    console.warn('[Player] previousTrack fallito:', e.message);
    throw e;
  }
}

// ---- Shuffle ----

export async function setShuffleState(state, deviceId) {
  const qs = new URLSearchParams({ state: String(!!state) });
  if (deviceId) qs.set('device_id', deviceId);
  console.log(`[Player] PUT /me/player/shuffle?${qs.toString()}`);
  try {
    await spotifyFetch(`/me/player/shuffle?${qs.toString()}`, { method: 'PUT' });
  } catch (e) {
    console.warn('[Player] setShuffleState fallito (non bloccante):', e.message);
  }
}

// ---- Play ----

/**
 * Avvia la riproduzione su un device.
 *
 * @param {object} opts
 * @param {string=} opts.contextUri - es. 'spotify:playlist:ID' o 'spotify:album:ID'
 * @param {string[]=} opts.uris     - lista URI tracce (alternativa a contextUri, max 100)
 * @param {object=}  opts.offset    - { uri: 'spotify:track:...' } o { position: N }
 * @param {number=}  opts.positionMs - ms dall'inizio
 * @param {boolean=} opts.shuffle   - se true, attiva shuffle prima del play
 * @param {string=}  opts.deviceId  - device su cui suonare; se omesso usa resolvePlaybackDevice
 */
export async function playWithConnect(opts = {}) {
  const {
    contextUri, uris, offset, positionMs,
    shuffle = false, deviceId: deviceIdHint,
  } = opts;

  console.log('[Player] playWithConnect:', {
    contextUri, urisCount: uris?.length, offset, shuffle, deviceIdHint,
  });

  // 1. Risolvi device se non specificato
  let deviceId = deviceIdHint;
  let source = 'specified';
  if (!deviceId) {
    const resolved = await resolvePlaybackDevice();
    deviceId = resolved.deviceId;
    source = resolved.source;
  }

  // 2. Set shuffle PRIMA del play (richiede device attivo, da qui in poi è attivo)
  if (shuffle !== undefined) {
    await setShuffleState(shuffle, deviceId);
  }

  // 3. Componi body
  const body = {};
  if (contextUri) body.context_uri = contextUri;
  if (uris && uris.length > 0) body.uris = uris.slice(0, 100); // limite Spotify
  if (offset) body.offset = offset;
  if (positionMs !== undefined) body.position_ms = positionMs;

  const qs = new URLSearchParams({ device_id: deviceId });
  console.log(`[Player] PUT /me/player/play?${qs.toString()} body=`, body);

  try {
    await spotifyFetch(`/me/player/play?${qs.toString()}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    console.log(`[Player] Play avviato su device ${source}=${deviceId}`);
    return { deviceId, source };
  } catch (e) {
    // Se il device transferito si è scollegato nel frattempo (es. app chiusa)
    // Spotify risponde 404 NO_ACTIVE_DEVICE. Riproviamo via SDK come fallback.
    if (e.message === 'SPOTIFY_API_ERROR_404' && source !== 'sdk') {
      console.warn('[Player] 404 NO_ACTIVE_DEVICE sul device risolto. Fallback SDK...');
      const sdkDevice = await ensureSDKReady();
      await transferPlayback(sdkDevice, false);
      await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(sdkDevice)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return { deviceId: sdkDevice, source: 'sdk-fallback' };
    }
    throw e;
  }
}
