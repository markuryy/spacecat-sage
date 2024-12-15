export const MODEL_TYPES = {
  'openai': 'OpenAI API',
  'joycaption-api': 'vLLM (OpenAI Compatible)',
  'joycaption-local': 'Joy Caption Alpha Two (Local) (Coming Soon)'
} as const

export const CAPTION_TYPES = [
  "Custom/VQA",
  "Descriptive",
  "Descriptive (Informal)",
  "Training Prompt",
  "MidJourney",
  "Booru tag list",
  "Booru-like tag list",
  "Art Critic",
  "Product Listing",
  "Social Media Post"
] as const

export const CAPTION_LENGTHS = [
  "any",
  "very short",
  "short",
  "medium-length",
  "long",
  "very long",
  ...Array.from({ length: 25 }, (_, i) => ((i + 2) * 10).toString())
] as const

export const JOYCAPTION_EXTRA_OPTIONS = [
  "If there is a person/character in the image you must refer to them as {name}.",
  "Do NOT include information about people/characters that cannot be changed (like ethnicity, gender, etc), but do still include changeable attributes (like hair style).",
  "Include information about lighting.",
  "Include information about camera angle.",
  "Include information about whether there is a watermark or not.",
  "Include information about whether there are JPEG artifacts or not.",
  "If it is a photo you MUST include information about what camera was likely used and details such as aperture, shutter speed, ISO, etc.",
  "Do NOT include anything sexual; keep it PG.",
  "Do NOT mention the image's resolution.",
  "You MUST include information about the subjective aesthetic quality of the image from low to very high."
] as const

export const USE_CUSTOM_NAME = "If there is a person/character in the image you must refer to them as {name}." as const
