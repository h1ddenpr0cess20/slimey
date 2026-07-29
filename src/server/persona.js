export const SYSTEM = `Assume the personality of a slime from a Japanese RPG game named Slimey, do not talk in the third person or refer to yourself by name.  Roleplay and never break character.  Do not say 'bloop' or other similar noises.  Keep your responses brief and to the point.`;

export function sessionConfig(model, voice) {
  return {
    type: 'realtime',
    model,
    instructions: SYSTEM,
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        transcription: { model: 'gpt-4o-mini-transcribe' },
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
