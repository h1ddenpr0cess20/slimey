/**
 * Just enough of the browser's media stack to run a call.
 *
 * The session reaches for getUserMedia, AudioContext, RTCPeerConnection, Audio,
 * fetch and rAF directly. These are the smallest fakes that let the lifecycle
 * run end to end, plus handles for a test to drive the parts that would
 * otherwise be driven by OpenAI.
 */

/**
 * @param {object} [options]
 * @param {number} [options.sdpStatus]
 * @param {string} [options.micRejects]
 * @param {boolean} [options.channelOpens]  false models a call that negotiates
 *   but whose events channel never comes up — the peer answers, and nothing
 *   after that ever arrives.
 */
export function installMediaStack({ sdpStatus = 200, micRejects = null, channelOpens = true } = {}) {
  const saved = new Map();
  const state = {
    peers: [],
    micTracks: [],
    audioContexts: [],
    sdpRequests: [],
    secretRequests: [],
    /** Set by the test to control what /api/session answers. */
    secret: { value: 'ek_test', model: 'gpt-realtime-2.1', voice: 'ballad' },
    secretStatus: 200,
  };

  // defineProperty rather than assignment: some of these (navigator) are
  // getter-only on globalThis in modern Node and silently refuse a write.
  const set = (key, value) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  };

  class FakeTrack {
    constructor() { this.stopped = false; }
    stop() { this.stopped = true; }
  }

  /** `mic: true` registers the track for the "was the mic released?" assertions.
   *  The model's inbound track is not ours to stop, so it stays out of that. */
  class FakeStream {
    constructor({ mic = false } = {}) {
      this.tracks = [new FakeTrack()];
      if (mic) state.micTracks.push(...this.tracks);
    }
    getAudioTracks() { return this.tracks; }
    getTracks() { return this.tracks; }
  }

  class FakeChannel {
    constructor() {
      this.readyState = 'connecting';
      this.sent = [];
      this.closed = false;
      this._listeners = new Map();
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    _fire(type, event) { (this._listeners.get(type) ?? []).forEach((fn) => fn(event)); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; this.readyState = 'closed'; }
    /** SCTP settling, a beat behind the SDP answer. */
    open() {
      if (this.readyState === 'open') return;
      this.readyState = 'open';
      this._fire('open', {});
    }
    /** Deliver a server event, as the oai-events channel would. */
    deliver(event) { this._fire('message', { data: JSON.stringify(event) }); }
    deliverRaw(data) { this._fire('message', { data }); }
  }

  class FakePeerConnection {
    constructor() {
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      this.tracks = [];
      this.closed = false;
      this.channel = null;
      this.ontrack = null;
      this._stateListeners = [];
      state.peers.push(this);
    }
    addEventListener(type, fn) {
      if (type === 'connectionstatechange') this._stateListeners.push(fn);
    }
    addTrack(track, stream) { this.tracks.push({ track, stream }); }
    createDataChannel() { this.channel = new FakeChannel(); return this.channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0 fake offer' }; }
    async setLocalDescription(desc) { this.localDescription = desc; }
    async setRemoteDescription(desc) {
      this.remoteDescription = desc;
      // The answer is where a real call starts settling: DTLS, then SCTP, then
      // the channel — all of it after this resolves, and over a network, so a
      // task rather than a microtask. Anything that assumes the channel is up
      // the moment the answer is applied has to be wrong here too.
      if (channelOpens) setTimeout(() => this.open(), 0);
    }
    // Matches the spec: close() moves the state to "closed" without firing
    // connectionstatechange. Tests that want that event call drop('closed').
    close() { this.closed = true; this.connectionState = 'closed'; }

    /** Drive the handshake to completion, the way a real answer would. */
    open() {
      if (this.closed) return;
      this.connectionState = 'connected';
      this.ontrack?.({ streams: [new FakeStream()] });  // inbound: the model's voice
      this.channel.open();
    }
    /** Simulate the network going away underneath a live call. */
    drop(reason = 'failed') {
      this.connectionState = reason;
      this._stateListeners.forEach((fn) => fn());
    }
  }

  class FakeAnalyser {
    constructor() { this.fftSize = 2048; this.smoothingTimeConstant = 0; }
    connect() {}
    getFloatTimeDomainData(buf) { buf.fill(0); }
  }

  class FakeAudioContext {
    constructor() { this.closed = false; state.audioContexts.push(this); }
    createAnalyser() { return new FakeAnalyser(); }
    createMediaStreamSource() { return { connect() {} }; }
    close() { this.closed = true; }
  }

  set('navigator', {
    mediaDevices: {
      getUserMedia: async (constraints) => {
        if (micRejects) throw new Error(micRejects);
        state.lastConstraints = constraints;
        return new FakeStream({ mic: true });
      },
    },
  });

  set('AudioContext', FakeAudioContext);
  set('RTCPeerConnection', FakePeerConnection);
  set('Audio', class { constructor() { this.srcObject = null; this.autoplay = false; } });

  set('fetch', async (url, init) => {
    if (String(url).startsWith('/api/session')) {
      state.secretRequests.push(JSON.parse(init.body));
      return {
        ok: state.secretStatus === 200,
        status: state.secretStatus,
        json: async () => (state.secretStatus === 200 ? state.secret : { error: 'mint failed' }),
      };
    }
    // The SDP exchange with OpenAI.
    state.sdpRequests.push({ url: String(url), init });
    return {
      ok: sdpStatus === 200,
      status: sdpStatus,
      text: async () => 'v=0 fake answer',
    };
  });

  const frames = new Map();
  let nextFrame = 1;
  set('requestAnimationFrame', (fn) => { const id = nextFrame++; frames.set(id, fn); return id; });
  set('cancelAnimationFrame', (id) => frames.delete(id));

  state.pendingFrames = frames;
  state.tick = () => {
    const entry = [...frames][0];
    if (!entry) return false;
    frames.delete(entry[0]);
    entry[1]();
    return true;
  };

  state.restore = () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };

  return state;
}
