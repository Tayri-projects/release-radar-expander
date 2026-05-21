/**
 * Release Radar Expander — Entry Point
 * Fase 1: Hello World PWA con schermata login placeholder
 */

import { showToast } from './ui/toast.js';

const SPOTIFY_CLIENT_ID = 'b5bfeeaa6e8a4590bacedc11ab33387c';

// Determina base URL corretto per GitHub Pages vs localhost
const BASE_URL = import.meta.env.BASE_URL || '/';

console.log('[App] Release Radar Expander avviato');
console.log('[App] BASE_URL:', BASE_URL);
console.log('[App] Client ID configurato:', SPOTIFY_CLIENT_ID);

function renderLoginScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-screen">
      <div class="app-icon">🎵</div>
      <h1>Release Radar Expander</h1>
      <p>Espandi i tuoi album Release Radar e ascoltali per intero ogni venerdì.</p>
      <button class="btn btn-primary" id="login-btn">
        Accedi con Spotify
      </button>
    </div>
  `;

  document.getElementById('login-btn').addEventListener('click', () => {
    showToast('Autenticazione Spotify — disponibile nella Fase 2');
  });
}

// Registra Service Worker
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register(`${BASE_URL}sw.js`);
      console.log('[SW] Registrato:', reg.scope);
    } catch (err) {
      console.warn('[SW] Registrazione fallita:', err);
    }
  }
}

// Bootstrap
async function init() {
  await registerServiceWorker();
  renderLoginScreen();
}

init();
