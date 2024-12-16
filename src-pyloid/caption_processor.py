import json
import base64
import os
from PySide6.QtCore import QThread, Signal
from openai import OpenAI, AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam, ChatCompletionUserMessageParam
import asyncio
import sqlite3

class CaptionProcessor(QThread):
    # Signals for progress updates
    progress = Signal(str)  # For status updates
    result = Signal(str)    # For final result

    def __init__(self, session_dir=None):
        super().__init__()
        self.session_dir = session_dir
        self._current_task = None  # For cancellation
        self.api_key = None
        # Request parameters
        self._image_name = None
        self._model_type = None
        self._settings = None
        self._event_loop = None

    def set_session_dir(self, session_dir):
        """Set the session directory"""
        self.session_dir = session_dir

    def set_api_key(self, api_key):
        """Set OpenAI API key"""
        self.api_key = api_key.strip('"') if api_key else None
        print(f"DEBUG CaptionProcessor: API key set to: {self.api_key[:4] if self.api_key else None}...")

    def generate_caption_async(self, image_name, model_type, settings):
        """Start async caption generation"""
        self._image_name = image_name
        self._model_type = model_type
        self._settings = settings
        self.start()

    def run(self):
        """Thread execution"""
        try:
            # Create event loop for this thread
            self._event_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._event_loop)
            
            result = self._event_loop.run_until_complete(self._generate_caption())
            self.result.emit(result)
        except Exception as e:
            self.result.emit(json.dumps({"error": str(e)}))
        finally:
            if self._event_loop:
                self._event_loop.close()
                self._event_loop = None

    def _construct_prompt(self, settings):
        """Construct the prompt based on settings"""
        prompts = settings.get('prompts', {})
        caption_type = prompts.get('captionType', 'Descriptive')
        caption_length = prompts.get('captionLength', 'medium-length')
        custom_prompt = prompts.get('customPrompt', '')
        custom_name = prompts.get('customName', '')
        extra_options = prompts.get('extraOptions', [])

        # If using custom prompt, use that directly
        if caption_type == 'Custom/VQA':
            final_prompt = custom_prompt or "Write a descriptive caption for this image."
        else:
            # Check if caption_length is a number (word count)
            is_word_count = caption_length.isdigit()
            
            # Construct base prompt based on caption type
            if caption_type == "Descriptive":
                if is_word_count:
                    final_prompt = f"Write a descriptive caption for this image in a formal tone within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} descriptive caption for this image in a formal tone."
            elif caption_type == "Descriptive (Informal)":
                if is_word_count:
                    final_prompt = f"Write a descriptive caption for this image in a casual tone within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} descriptive caption for this image in a casual tone."
            elif caption_type == "Training Prompt" or caption_type == "Stable Diffusion":
                if is_word_count:
                    final_prompt = f"Write a stable diffusion prompt for this image within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} stable diffusion prompt for this image."
            elif caption_type == "MidJourney":
                if is_word_count:
                    final_prompt = f"Write a MidJourney prompt for this image within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} MidJourney prompt for this image."
            elif caption_type == "Booru tag list":
                if is_word_count:
                    final_prompt = f"Write a list of Booru tags for this image within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} list of Booru tags for this image."
            elif caption_type == "Booru-like tag list":
                if is_word_count:
                    final_prompt = f"Write a list of Booru-like tags for this image within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} list of Booru-like tags for this image."
            elif caption_type == "Art Critic":
                if is_word_count:
                    final_prompt = f"Analyze this image like an art critic would with information about its composition, style, symbolism, the use of color, light, any artistic movement it might belong to, etc. Keep it within {caption_length} words."
                else:
                    final_prompt = f"Analyze this image like an art critic would with information about its composition, style, symbolism, the use of color, light, any artistic movement it might belong to, etc. Keep it {caption_length}."
            elif caption_type == "Product Listing":
                if is_word_count:
                    final_prompt = f"Write a caption for this image as though it were a product listing. Keep it under {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} caption for this image as though it were a product listing."
            elif caption_type == "Social Media Post":
                if is_word_count:
                    final_prompt = f"Write a caption for this image as if it were being used for a social media post. Limit the caption to {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} caption for this image as if it were being used for a social media post."
            else:
                # Default to formal descriptive
                if is_word_count:
                    final_prompt = f"Write a descriptive caption for this image in a formal tone within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} descriptive caption for this image in a formal tone."

        # Add extra options to the prompt
        if extra_options:
            final_prompt += "\n\nAdditional requirements:\n" + "\n".join(f"- {option.replace('{name}', custom_name) if custom_name and '{name}' in option else option}" for option in extra_options)

        return final_prompt

    async def _generate_caption(self):
        """Generate caption based on model type and settings"""
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session", "image_name": self._image_name})

            if not self._image_name:
                return json.dumps({"error": "No image name provided", "image_name": self._image_name})

            image_path = os.path.join(self.session_dir, self._image_name)
            if not os.path.exists(image_path) or not os.path.isfile(image_path):
                return json.dumps({"error": f"Image file not found: {image_path}", "image_name": self._image_name})

            if not self._settings:
                return json.dumps({"error": "No settings provided", "image_name": self._image_name})

            # Construct the prompt using the new method
            prompt = self._construct_prompt(self._settings)

            model, api_key, base_url = None, None, None
            if self._model_type == 'openai':
                openai_settings = self._settings.get('openai', {})
                model = openai_settings.get('model', "gpt-4o")
                api_key = openai_settings.get('apiKey') or self.api_key
            else:  # vLLM
                vllm_settings = self._settings.get('joycaption', {})
                model = vllm_settings.get('model', 'llama-joycaption-alpha-two-hf-llava')
                api_key = vllm_settings.get('apiKey')
                base_url = vllm_settings.get('baseUrl')
                if not base_url:
                    return json.dumps({"error": "vLLM base URL not set", "image_name": self._image_name})

            if not api_key:
                return json.dumps({"error": "API key not set", "image_name": self._image_name})

            if not model:
                return json.dumps({"error": "Model not specified", "image_name": self._image_name})

            max_retries = 3
            retry_count = 0
            last_error = None

            while retry_count < max_retries:
                try:
                    result = await self._generate_caption_with_openai_sdk(
                        image_path,
                        prompt,
                        model,
                        api_key,
                        base_url
                    )

                    try:
                        result_data = json.loads(result)
                        if 'caption' in result_data:
                            caption = result_data['caption']
                            if not self._is_rejection_response(caption):
                                # Save caption to database
                                db_path = os.path.join(self.session_dir, 'captions.db')
                                with sqlite3.connect(db_path) as conn:
                                    conn.execute("""
                                        INSERT OR REPLACE INTO captions (image_name, caption, updated_at)
                                        VALUES (?, ?, CURRENT_TIMESTAMP)
                                    """, (self._image_name, caption))
                                    conn.commit()

                                # Return both caption and image name
                                return json.dumps({
                                    "caption": caption,
                                    "image_name": self._image_name,
                                    "status": "success"
                                })

                    except json.JSONDecodeError:
                        if retry_count == max_retries - 1:
                            self.progress.emit(f"Failed to process {self._image_name}: Invalid response from model")
                            return json.dumps({
                                "error": "Invalid response from model",
                                "image_name": self._image_name,
                                "status": "error"
                            })

                except Exception as e:
                    last_error = str(e)
                    retry_count += 1
                    if retry_count >= max_retries:
                        break
                    await asyncio.sleep(1)  # Wait before retrying

            self.progress.emit(f"Failed to process {self._image_name} after {max_retries} attempts")
            return json.dumps({
                "error": f"Failed after {max_retries} attempts: {last_error}",
                "image_name": self._image_name,
                "status": "error"
            })

        except Exception as e:
            self.progress.emit(f"Error processing {self._image_name}: {str(e)}")
            return json.dumps({
                "error": str(e),
                "image_name": self._image_name,
                "status": "error"
            })

    def _is_rejection_response(self, caption):
        """Check if the caption appears to be a rejection or error"""
        rejection_indicators = [
            "sorry",
            "i apologize",
            "cannot",
            "unable to",
            "failed to",
            "could not",
            "error",
            "invalid",
            "not able to",
        ]
        if not caption:
            return True
        return any(indicator in caption.lower() for indicator in rejection_indicators)

    async def _generate_caption_with_openai_sdk(self, image_path: str, prompt: str, model: str, api_key: str, base_url: str | None = None):
        """Generate caption using OpenAI SDK for both OpenAI and vLLM endpoints"""
        try:
            with open(image_path, "rb") as image_file:
                image_data = image_file.read()
                if not image_data:
                    raise ValueError("Empty image file")

            # Initialize OpenAI client with appropriate base_url if using vLLM
            client = AsyncOpenAI(
                api_key=api_key,
                base_url=base_url if base_url else "https://api.openai.com/v1"
            )

            # Create the messages payload
            content: list[ChatCompletionMessageParam] = [
                ChatCompletionUserMessageParam(
                    role="user",
                    content=[
                        {
                            "type": "text",
                            "text": prompt or "Generate a detailed description of this image."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64.b64encode(image_data).decode('utf-8')}"
                            }
                        }
                    ]
                )
            ]

            print("DEBUG: Sending OpenAI request with model:", model)
            
            # Store the task for potential cancellation
            self._current_task = asyncio.create_task(
                client.chat.completions.create(
                    model=model,
                    messages=content,
                    max_tokens=500
                )
            )

            try:
                # Wait for the response
                response = await self._current_task
                
                if response.choices and response.choices[0].message.content:
                    caption = response.choices[0].message.content
                    if self._is_rejection_response(caption):
                        return json.dumps({"error": "Model politely declined the image", "image_name": self._image_name})
                    return json.dumps({"caption": caption})
                else:
                    return json.dumps({"error": "No caption generated"})

            except asyncio.CancelledError:
                return json.dumps({"error": "Caption generation cancelled"})

        except Exception as e:
            return json.dumps({"error": str(e)})

    def cancel_generation(self):
        """Cancel the current caption generation request if any"""
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()
            self._current_task = None

    def generate_batch_captions(self, image_names, model_type, settings):
        """Generate captions for multiple images"""
        self._model_type = model_type
        self._settings = settings
        results = []
        
        for i, image_name in enumerate(image_names):
            try:
                # Emit progress update before processing each image
                self.progress.emit(json.dumps({
                    "current": i + 1,
                    "total": len(image_names),
                    "processing": image_name
                }))
                
                # Process the image
                if not self._event_loop:
                    self._event_loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(self._event_loop)
                
                # Generate caption
                result = self._event_loop.run_until_complete(self._generate_caption_for_batch(image_name))
                results.append(json.loads(result))
                
                # Emit another progress update after processing
                self.progress.emit(json.dumps({
                    "current": i + 1,
                    "total": len(image_names),
                    "processing": image_name
                }))
                
            except asyncio.CancelledError:
                self.result.emit(json.dumps({
                    "type": "batch_cancelled",
                    "processed": i
                }))
                return
            except Exception as e:
                results.append({
                    "error": str(e),
                    "image_name": image_name
                })
        
        # Send final results
        self.result.emit(json.dumps({
            "type": "batch_complete",
            "results": results
        }))

    async def _generate_caption_for_batch(self, image_name):
        """Modified version of _generate_caption for batch processing"""
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session", "image_name": image_name})

            if not image_name:
                return json.dumps({"error": "No image name provided", "image_name": image_name})

            image_path = os.path.join(self.session_dir, image_name)
            if not os.path.exists(image_path) or not os.path.isfile(image_path):
                return json.dumps({"error": f"Image file not found: {image_path}", "image_name": image_name})

            if not self._settings:
                return json.dumps({"error": "No settings provided", "image_name": image_name})

            # Construct the prompt using the new method
            prompt = self._construct_prompt(self._settings)

            model, api_key, base_url = None, None, None
            if self._model_type == 'openai':
                openai_settings = self._settings.get('openai', {})
                model = openai_settings.get('model', "gpt-4o")
                api_key = openai_settings.get('apiKey') or self.api_key
            else:  # vLLM
                vllm_settings = self._settings.get('joycaption', {})
                model = vllm_settings.get('model', 'llama-joycaption-alpha-two-hf-llava')
                api_key = vllm_settings.get('apiKey')
                base_url = vllm_settings.get('baseUrl')
                if not base_url:
                    return json.dumps({"error": "vLLM base URL not set", "image_name": image_name})

            if not api_key:
                return json.dumps({"error": "API key not set", "image_name": image_name})

            if not model:
                return json.dumps({"error": "Model not specified", "image_name": image_name})

            max_retries = 3
            retry_count = 0
            last_error = None

            while retry_count < max_retries:
                try:
                    result = await self._generate_caption_with_openai_sdk(
                        image_path,
                        prompt,
                        model,
                        api_key,
                        base_url
                    )

                    try:
                        result_data = json.loads(result)
                        if 'caption' in result_data:
                            caption = result_data['caption']
                            if not self._is_rejection_response(caption):
                                # Save caption to database
                                db_path = os.path.join(self.session_dir, 'captions.db')
                                with sqlite3.connect(db_path) as conn:
                                    conn.execute("""
                                        INSERT OR REPLACE INTO captions (image_name, caption, updated_at)
                                        VALUES (?, ?, CURRENT_TIMESTAMP)
                                    """, (image_name, caption))
                                    conn.commit()

                                # Return both caption and image name
                                return json.dumps({
                                    "caption": caption,
                                    "image_name": image_name,
                                    "status": "success"
                                })

                    except json.JSONDecodeError:
                        if retry_count == max_retries - 1:
                            self.progress.emit(f"Failed to process {image_name}: Invalid response from model")
                            return json.dumps({
                                "error": "Invalid response from model",
                                "image_name": image_name,
                                "status": "error"
                            })

                except Exception as e:
                    last_error = str(e)
                    retry_count += 1
                    if retry_count >= max_retries:
                        break
                    await asyncio.sleep(1)  # Wait before retrying

            self.progress.emit(f"Failed to process {image_name} after {max_retries} attempts")
            return json.dumps({
                "error": f"Failed after {max_retries} attempts: {last_error}",
                "image_name": image_name,
                "status": "error"
            })

        except Exception as e:
            self.progress.emit(f"Error processing {image_name}: {str(e)}")
            return json.dumps({
                "error": str(e),
                "image_name": image_name,
                "status": "error"
            })