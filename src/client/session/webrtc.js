/**
 * The WebRTC half of the call: peer connection, data channel, SDP handshake.
 *
 * Talks to OpenAI directly with the ephemeral secret the proxy minted. Audio
 * never goes near our own server — only the secret does.
 */

const REALTIME_URL = 'https://api.openai.com/v1/realtime/calls';

/**
 * @param {object}   options
 * @param {string}   options.secret     ephemeral client secret from /api/session
 * @param {MediaStream} options.micStream
 * @param {(event: object) => void} options.onEvent   parsed oai-events frames
 * @param {(stream: MediaStream) => void} options.onTrack  the model's voice
 * @param {(reason: string | null) => void} options.onClose  dropped or hung up
 */
export async function connect({ secret, micStream, onEvent, onTrack, onClose }) {
  const pc = new RTCPeerConnection();

  pc.ontrack = (e) => onTrack(e.streams[0]);
  pc.addTrack(micStream.getAudioTracks()[0], micStream);

  const channel = pc.createDataChannel('oai-events');
  channel.addEventListener('message', (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* a frame we can't parse is a frame we don't animate */
    }
  });

  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      onClose(pc.connectionState === 'failed' ? 'the call dropped' : null);
    }
  });

  await pc.setLocalDescription(await pc.createOffer());
  const answer = await fetch(REALTIME_URL, {
    method: 'POST',
    body: pc.localDescription.sdp,
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/sdp' },
  });
  if (!answer.ok) throw new Error(`realtime handshake failed (${answer.status})`);
  await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });

  return {
    pc,
    /** True once the data channel can carry conversation items. */
    get open() { return channel.readyState === 'open'; },
    send(message) {
      if (channel.readyState !== 'open') return false;
      channel.send(JSON.stringify(message));
      return true;
    },
    close() {
      channel.close();
      pc.close();
    },
  };
}
