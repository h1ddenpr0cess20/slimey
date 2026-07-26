/**
 * Everything the page shows but doesn't take input from: the state chip, the
 * line of what you said, and the slime's caption.
 *
 * Read-only by design — it renders what it's told and never reaches for the
 * session.
 */

export function createHud(root = document) {
  const statusEl = root.querySelector('#status');
  const captionEl = root.querySelector('#caption');
  const youEl = root.querySelector('#you');

  return {
    /** idle | listening | thinking | speaking, plus the synthetic 'connecting'. */
    setState(state) {
      statusEl.dataset.state = state;
      statusEl.textContent = state;
    },

    showUser(text) {
      youEl.textContent = text;
      youEl.classList.add('visible');
    },

    hideUser() {
      youEl.classList.remove('visible');
    },

    appendCaption(chunk) {
      captionEl.classList.remove('error');
      captionEl.classList.add('visible');
      captionEl.textContent += chunk;
      captionEl.scrollTop = captionEl.scrollHeight;
    },

    clearCaption() {
      captionEl.textContent = '';
      captionEl.classList.remove('visible', 'error');
    },

    showError(message) {
      captionEl.textContent = message;
      captionEl.classList.add('visible', 'error');
    },
  };
}
