import './styles.css';
import './vendor/three-d-stage.js';

import { fetchCatalog } from './api.js';
import { createSlimeOrb } from './orb/index.js';
import { createHistory } from './history.js';
import { createMemory } from './memory.js';
import { createVoiceSession } from './session/index.js';
import { createControls } from './ui/controls.js';
import { createHistoryPanel } from './ui/history.js';
import { createMemoryPanel } from './ui/memory.js';
import { createHud } from './ui/hud.js';
import { stripStageChrome } from './ui/stage.js';
import { trackKeyboardInset } from './ui/viewport.js';

const stage = stripStageChrome(document.querySelector('three-d-stage'));

const { THREE } = await stage.ready;

const orb = createSlimeOrb({ stage, THREE });
const memory = createMemory();
const session = createVoiceSession({ memory });
const hud = createHud();
const history = createHistory();
const historyPanel = createHistoryPanel({ history, onNew: startFresh });
const memoryPanel = createMemoryPanel({ memory });

trackKeyboardInset();

const controls = createControls({
  getStatus: () => ({ connected: session.connected, busy: session.busy, muted: session.muted }),

  async onMicToggle() {
    if (session.connected) {
      session.muted = !session.muted;
      hud.setState(chipState());
      armIdleMute();
      return;
    }
    hud.setState('connecting');
    hud.clearCaption();
    history.begin({ model: session.model, voice: session.voice });
    await session.start();
    if (session.stale) setTimeout(redial, 0);
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
    if (memoryPanel.isOpen) return memoryPanel.close();
    if (historyPanel.isOpen) return historyPanel.close();
    session.cancel();
  },
});

const IDLE_MUTE_MS = 60_000;
let idle = 0;

function armIdleMute() {
  clearTimeout(idle);
  idle = 0;
  if (!session.connected || session.muted) return;
  if (session.busy || session.state === 'thinking' || session.state === 'speaking') return;
  idle = setTimeout(() => {
    if (!session.connected || session.muted) return;
    session.muted = true;
    hud.setState(chipState());
    controls.sync();
  }, IDLE_MUTE_MS);
}

function startFresh() {
  history.end();
  if (session.connected) redial();
}

function chipState() {
  if (!session.connected || !session.muted) return orb.state;
  return orb.state === 'listening' || orb.state === 'idle' ? 'muted' : orb.state;
}

function redial() {
  if (!session.connected) return;
  session.stop();
  controls.toggleMic();
}

session.on('state', (state) => {
  if (state === 'idle') {
    history.end();
    hud.hideUser();
  }
  if (state === 'thinking') hud.clearCaption();
  orb.setState(state);
  hud.setState(chipState());
  armIdleMute();
  controls.sync();
});

session.on('busy', () => {
  armIdleMute();
  controls.sync();
});

session.on('level', (level) => orb.setLevel(level));
session.on('pulse', (weight) => orb.pulse(weight));
session.on('text', (chunk) => {
  hud.appendCaption(chunk);
  armIdleMute();
});
session.on('user', (text) => {
  hud.showUser(text);
  armIdleMute();
});

session.on('message', (message) => history.append(message));

session.on('error', ({ message }) => {
  hud.showError(message);
  hud.setState(chipState());
  controls.sync();
});

try {
  const catalog = await fetchCatalog();
  if (!catalog.models.length) throw new Error('this key can’t reach any realtime model');
  const chosen = controls.setCatalog(catalog);
  session.model = chosen.model;
  session.voice = chosen.voice;
} catch (err) {
  controls.catalogUnavailable();
  hud.showError(`${err.message} — is the proxy running? (npm run dev)`);
}

window.addEventListener('pagehide', () => session.stop());

controls.sync();

if (window.matchMedia('(pointer: fine)').matches) controls.focus();
