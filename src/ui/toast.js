/**
 * Toast notifications — sistema di feedback utente
 *
 * Comportamenti:
 * - durationMs finito  → auto-dissolve dopo durationMs
 * - durationMs Infinity → toast permanente con pulsante × per chiuderlo
 * - errori (type === 'error') → di default permanenti (chiusura manuale)
 */

let toastContainer = null;

function getContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  console.log('[Toast] Rimuovo toast:', toast.dataset.toastId || toast.textContent?.slice(0, 40));
  toast.style.animation = 'toast-out 0.25s ease forwards';
  const done = () => { if (toast.parentNode) toast.remove(); };
  toast.addEventListener('animationend', done, { once: true });
  // Safety net se l'animationend non scatta (es. browser in background)
  setTimeout(done, 400);
}

/**
 * Mostra un toast message.
 * @param {string} message
 * @param {'info'|'error'} type
 * @param {number} durationMs - usa Infinity per toast permanente
 */
export function showToast(message, type = 'info', durationMs = 3000) {
  const container = getContainer();
  const toast = document.createElement('div');
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  toast.dataset.toastId = id;
  toast.className = `toast${type === 'error' ? ' error' : ''}`;

  const isPermanent = !isFinite(durationMs) || durationMs <= 0;
  const isError = type === 'error';

  // Errori → di default permanenti. Se l'utente passa una duration finita su un error, la rispettiamo.
  const finalPermanent = isPermanent || (isError && durationMs === 3000);

  console.log(`[Toast] show: "${message}" (type=${type}, durationMs=${durationMs}, permanent=${finalPermanent})`);

  // Costruisci contenuto: testo + opzionale ×
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);

  if (finalPermanent) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Chiudi');
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', () => removeToast(toast));
    toast.appendChild(closeBtn);
    toast.classList.add('toast-permanent');
  }

  container.appendChild(toast);

  if (!finalPermanent) {
    setTimeout(() => removeToast(toast), durationMs);
  }

  return toast;
}

/**
 * Dismissa tutti i toast attualmente visibili (utile in transizioni di stato).
 */
export function dismissAllToasts() {
  if (!toastContainer) return;
  const all = toastContainer.querySelectorAll('.toast');
  console.log(`[Toast] dismissAllToasts: rimuovo ${all.length} toast`);
  all.forEach(removeToast);
}

/**
 * Dismissa tutti i toast 'info' (mantiene gli errori visibili).
 */
export function dismissInfoToasts() {
  if (!toastContainer) return;
  const infos = toastContainer.querySelectorAll('.toast:not(.error)');
  console.log(`[Toast] dismissInfoToasts: rimuovo ${infos.length} toast info`);
  infos.forEach(removeToast);
}

/**
 * Aggiorna il testo di un toast esistente senza riavviare il timer.
 */
export function updateToastMessage(toast, message) {
  if (!toast) return;
  const text = toast.querySelector('.toast-text');
  if (text) text.textContent = message;
  console.log('[Toast] updateToastMessage:', message);
}
