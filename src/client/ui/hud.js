/**
 * Everything the page shows but doesn't take input from: the state chip, the
 * line of what you said, and the slime's caption.
 *
 * Read-only by design — it renders what it's told and never reaches for the
 * session.
 */

/* Models emit markdown despite the persona asking for none. Inline spans only.
   Order matters: `code` first, `**` before `*`. */
const INLINE = [
  { tag: 'code', re: /`([^`\n]+)`/ },
  { tag: 'strong', re: /\*\*(\S|\S[\s\S]*?\S)\*\*/ },
  { tag: 'strong', re: /__(\S|\S[\s\S]*?\S)__/ },
  { tag: 's', re: /~~(\S|\S[\s\S]*?\S)~~/ },
  // Guarded on both sides, so snake_case and `3 * 4 * 5` stay as they were said.
  { tag: 'em', re: /(?<![\w*])\*(\S|\S[\s\S]*?\S)\*(?!\w)/ },
  { tag: 'em', re: /(?<![\w_])_(\S|\S[\s\S]*?\S)_(?!\w)/ },
];

/** The leftmost span in `text`, ties going to whichever rule is listed first. */
function firstSpan(text) {
  let found = null;
  for (const { tag, re } of INLINE) {
    const m = re.exec(text);
    if (m && (!found || m.index < found.at)) {
      found = { tag, at: m.index, width: m[0].length, body: m[1] };
    }
  }
  return found;
}

/** Markdown → nodes. Never innerHTML: this is model output. */
function render(text, into) {
  let rest = text;
  for (let span = firstSpan(rest); span; span = firstSpan(rest)) {
    if (span.at) into.append(rest.slice(0, span.at));
    const el = into.ownerDocument.createElement(span.tag);
    // Everything nests except code, where the point is that it doesn't.
    if (span.tag === 'code') el.append(span.body);
    else render(span.body, el);
    into.append(el);
    rest = rest.slice(span.at + span.width);
  }
  if (rest) into.append(rest);
  return into;
}

export function createHud(root = document) {
  const statusEl = root.querySelector('#status');
  const captionEl = root.querySelector('#caption');
  const youEl = root.querySelector('#you');

  // Re-rendered whole each delta: a span and its closer arrive in different chunks.
  let turn = '';

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
      turn += chunk;
      captionEl.classList.remove('error');
      captionEl.classList.add('visible');
      captionEl.replaceChildren();
      render(turn, captionEl);
      captionEl.scrollTop = captionEl.scrollHeight;
    },

    clearCaption() {
      turn = '';
      captionEl.replaceChildren();
      captionEl.classList.remove('visible', 'error');
    },

    showError(message) {
      turn = ''; // ours, not the model's: shown verbatim, and it ends the turn
      captionEl.textContent = message;
      captionEl.classList.add('visible', 'error');
    },
  };
}
