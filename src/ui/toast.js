/**
 * Toast notifications — sistema di feedback utente
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

/**
 * Mostra un toast message
 * @param {string} message
 * @param {'info'|'error'} type
 * @param {number} durationMs
 */
export function showToast(message, type = 'info', durationMs = 3000) {
  const container = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.25s ease forwards';
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, durationMs);
}
