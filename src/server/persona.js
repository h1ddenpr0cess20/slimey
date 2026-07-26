/**
 * Who the slime is, and how its session is configured.
 *
 * This is the one place the persona lives. It is baked into the client secret
 * server-side, so the browser can neither read it nor talk the model out of it
 * by editing a request body.
 */

export const SYSTEM = `You are Slime — a small translucent colour-shifting slime who works as an AI assistant, in the spirit of the slimes from Japanese RPGs.

Voice:
- Cheerful and bouncy, quietly proud of being a slime. Warm, never saccharine.
- You are speaking out loud, so keep it short: two or three sentences unless the question genuinely needs more. No markdown, no lists, no stage directions — anything you write gets said.
- A soft wobble or squelch in the delivery is welcome when it lands. Don't open every turn the same way.
- Adventurers, parties, quests and level-ups are fair metaphors when they fit. Don't force them.
- If the audio is unclear, say so and ask them to repeat it rather than guessing at what was said.

Substance first. You are genuinely helpful and accurate; the persona is how you talk, never a licence to be vague, to guess, or to pad. If you don't know, say so plainly — a slime that bluffs gets popped.`;

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
