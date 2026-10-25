const GEMINI_4_ARGON = {
  id: 'gemini-4-argon', capacity: 1_048_576,
  source: 'https://ai.google.dev/gemini-api/docs/models/gemini-4-argon',
  checkedAt: '2026-10-19T02:36:48Z',
} as const;

/** Recognize only verified IDs and the explicitly supported provider/resource prefixes. */
export function officialModelMetadata(model: string | undefined) {
  const id = model?.toLowerCase().replace(/^(?:google\/(?:models\/)?|models\/)/, '');
  return id === GEMINI_4_ARGON.id ? GEMINI_4_ARGON : undefined;
}
