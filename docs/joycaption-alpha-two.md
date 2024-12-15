# spacecat sage & joycaption alpha two

spacecat sage relies on the openai api. joycaption alpha two works with vllm, which has an openai-style api and works pretty well.

here's what you need to know about joycaption alpha two:
- it's single-turn only
- needs specific prompts (listed below)
- formal descriptions work best from what i've seen

you can run vllm on linux or build from source if you want to deal with networking setup. i just use runpod serverless because it's way simpler - you just switch the openai base url and use your runpod api key. eventually i want to bundle the inference code into the app for local generation, but my laptop gets hot lol (and hf transformers isn't as optimized as vllm)

## setting up runpod serverless

1. login to runpod and find serverless in the sidebar
2. look for "serverless vLLM" in quick deploy and hit configure
3. use these settings:
   - huggingface model: `fancyfeast/llama-joycaption-alpha-two-hf-llava` (no token needed)
   - enable prefix caching
   - max model length: 4096

4. after it deploys:
   - grab your endpoint id (looks like `5u73gkb6m7wjuk`)
   - in sage:
     - pick vLLM as model type
     - base url is `https://api.runpod.ai/v2/[your endpoint id]/openai/v1`
     - get an api key from [runpod settings](https://www.runpod.io/console/user/settings)
     - use the same model name from before

## the actual prompts

system prompt (this is just for reference):
```
You are a helpful image captioner.
```

### descriptive captions
formal:
```
Write a descriptive caption for this image in a formal tone.
Write a descriptive caption for this image in a formal tone within {word_count} words.
Write a {length} descriptive caption for this image in a formal tone.
```

casual:
```
Write a descriptive caption for this image in a casual tone.
Write a descriptive caption for this image in a casual tone within {word_count} words.
Write a {length} descriptive caption for this image in a casual tone.
```

### ai art prompts
stable diffusion:
```
Write a stable diffusion prompt for this image.
Write a stable diffusion prompt for this image within {word_count} words.
Write a {length} stable diffusion prompt for this image.
```

midjourney:
```
Write a MidJourney prompt for this image.
Write a MidJourney prompt for this image within {word_count} words.
Write a {length} MidJourney prompt for this image.
```

### tag lists
booru:
```
Write a list of Booru tags for this image.
Write a list of Booru tags for this image within {word_count} words.
Write a {length} list of Booru tags for this image.
```

booru-like:
```
Write a list of Booru-like tags for this image.
Write a list of Booru-like tags for this image within {word_count} words.
Write a {length} list of Booru-like tags for this image.
```

### other styles
art critic:
```
Analyze this image like an art critic would with information about its composition, style, symbolism, the use of color, light, any artistic movement it might belong to, etc.
Analyze this image like an art critic would with information about its composition, style, symbolism, the use of color, light, any artistic movement it might belong to, etc. Keep it within {word_count} words.
Analyze this image like an art critic would with information about its composition, style, symbolism, the use of color, light, any artistic movement it might belong to, etc. Keep it {length}.
```

product listing:
```
Write a caption for this image as though it were a product listing.
Write a caption for this image as though it were a product listing. Keep it under {word_count} words.
Write a {length} caption for this image as though it were a product listing.
```

social media:
```
Write a caption for this image as if it were being used for a social media post.
Write a caption for this image as if it were being used for a social media post. Limit the caption to {word_count} words.
Write a {length} caption for this image as if it were being used for a social media post.
```

## caption length options
- presets: any, very short, short, medium-length, long, very long
- or specific word counts from 20 to 260 (in steps of 10)

## extra options
you can enable any of these:
```
If there is a person/character in the image you must refer to them as {name}.
Do NOT include information about people/characters that cannot be changed (like ethnicity, gender, etc), but do still include changeable attributes (like hair style).
Include information about lighting.
Include information about camera angle.
Include information about whether there is a watermark or not.
Include information about whether there are JPEG artifacts or not.
If it is a photo you MUST include information about what camera was likely used and details such as aperture, shutter speed, ISO, etc.
Do NOT include anything sexual; keep it PG.
Do NOT mention the image's resolution.
You MUST include information about the subjective aesthetic quality of the image from low to very high.
Include information on the image's composition style, such as leading lines, rule of thirds, or symmetry.
Do NOT mention any text that is in the image.
Specify the depth of field and whether the background is in focus or blurred.
If applicable, mention the likely use of artificial or natural lighting sources.
Do NOT use any ambiguous language.
Include whether the image is sfw, suggestive, or nsfw.
ONLY describe the most important elements of the image.
```

if you use the name option, there's a separate input field for the actual name.

for what it's worth, i mostly just use these two because they work best:
```
Write a short descriptive caption for this image in a formal tone.
```
```
Write a long descriptive caption for this image in a formal tone.
```

if you need something specific that these don't cover, there are probably better specialized tools out there.