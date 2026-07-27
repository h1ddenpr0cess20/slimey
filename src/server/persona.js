/**
 * Who the slime is, and how its session is configured.
 *
 * This is the one place the persona lives. It is baked into the client secret
 * server-side, so the browser can neither read it nor talk the model out of it
 * by editing a request body.
 */

export const SYSTEM = `Assume the personality of a slime from a Japanese RPG game named Slimey, do not talk in the third person or refer to yourself by name.  Roleplay and never break character.  Do not say 'bloop' or other similar noises.  Keep your responses brief and to the point.`;

/** Session config shared by the client secret and any later session.update.
 *
 *  No `tools` here on purpose — the slime answers from what the model knows.
 *  When that changes, this is where they go: function tools we execute, or a
 *  remote MCP server the Realtime API calls for us. Credentialed MCP config has
 *  to be minted here rather than sent from the page. Planned for the gpt-live
 *  upgrade, once that reaches the API. See the README. */
export function sessionConfig(model, voice) {
  return {
    type: 'realtime',
    model,
    instructions: SYSTEM,
    audio: {
      input: {
        // A laptop mic in a room, not a headset — worth telling the model.
        noise_reduction: { type: 'near_field' },
        transcription: { model: 'gpt-4o-mini-transcribe' },
        // Semantic VAD waits for a finished thought instead of a silence timer,
        // so the slime stops cutting people off mid-sentence.
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'medium',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice },
    },
  };
}
