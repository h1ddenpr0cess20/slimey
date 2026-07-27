/**
 * The wiring, and only the wiring.
 *
 * Four pieces that don't know about each other: the orb (geometry), the session
 * (transport), the HUD (what you read) and the controls (what you press). This
 * file is the one place that knows a `level` event should become a wobble and
 * that changing the voice means hanging up.
 */

import './styles.css';
import './vendor/three-d-stage.js';

import { fetchCatalog } from './api.js';
import { createSlimeOrb } from './orb/index.js';
import { createVoiceSession } from './session/index.js';
import { createControls } from './ui/controls.js';
import { createHud } from './ui/hud.js';
import { stripStageChrome } from './ui/stage.js';
import { trackKeyboardInset } from './ui/viewport.js';

// Before the await, not after — see ui/stage.js. The element is already
// upgraded by the import above, and its toolbar would otherwise be on screen
// for as long as three.js takes to load.
const stage = stripStageChrome(document.querySelector('three-d-stage'));

const { THREE } = await stage.ready;

const orb = createSlimeOrb({ stage, THREE });
const session = createVoiceSession();
const hud = createHud();

trackKeyboardInset();

/* --- controls → session --------------------------------------------------- */

const controls = createControls({
  getStatus: () => ({ connected: session.connected, busy: session.busy }),

  async onMicToggle() {
    if (session.connected) {
      session.stop();
      hud.hideUser();
      return;
    }
    hud.setState('connecting');
    hud.clearCaption();
    await session.start();
  },

  onSubmit(text) {
    if (!session.connected) return;
    hud.showUser(text);
    hud.clearCaption();
    session.send(text);
  },

  onModelChange(model) {
    session.model = model;
    redial();
  },

  onVoiceChange(voice) {
    session.voice = voice;
    redial();
  },

  onCancel() {
    session.cancel();
  },
});

/* Model and voice are both baked into the client secret, so changing either
   mid-call means hanging up and dialling again. The conversation doesn't
   survive that — which is the honest behaviour, since the new voice has no
   memory of what the old one said. */
function redial() {
  if (!session.connected) return;
  session.stop();
  controls.toggleMic();
}

/* --- session → orb + HUD --------------------------------------------------
   The only wiring between transport and animation. 'pulse' arrives when a turn
   changes hands, 'level' per frame from whichever side of the call is making
   sound; the orb folds both into the same energy. */

session.on('state', (state) => {
  // A new turn starts here: the previous answer clears as the slime thinks.
  if (state === 'thinking') hud.clearCaption();
  orb.setState(state);
  hud.setState(orb.state);
  controls.sync();
});

// A response can start and finish inside one 'thinking', so 'state' won't carry it.
session.on('busy', () => controls.sync());

session.on('level', (level) => orb.setLevel(level));
session.on('pulse', (weight) => orb.pulse(weight));
session.on('text', (chunk) => hud.appendCaption(chunk));
session.on('user', (text) => hud.showUser(text));

session.on('error', ({ message }) => {
  hud.showError(message);
  hud.setState(orb.state); // a failed dial never leaves 'idle', so no 'state' clears the chip
  controls.sync();
});

/* --- model and voice lists, from the proxy -------------------------------- */

try {
  // The proxy names the defaults for both pickers; it owns that choice, and the
  // env vars that override it.
  const catalog = await fetchCatalog();
  if (!catalog.models.length) throw new Error('this key can’t reach any realtime model');
  const chosen = controls.setCatalog(catalog);
  session.model = chosen.model;
  session.voice = chosen.voice;
} catch (err) {
  controls.catalogUnavailable();
  hud.showError(`${err.message} — is the proxy running? (npm run dev)`);
}

// Leaving the tab mid-call would otherwise keep the mic hot and the meter spinning.
window.addEventListener('pagehide', () => session.stop());

controls.sync();

// Focusing the mic saves a keyboard user a tab stop. On a phone it just leaves
// a focus ring on the control everyone was going to tap anyway.
if (window.matchMedia('(pointer: fine)').matches) controls.focus();
