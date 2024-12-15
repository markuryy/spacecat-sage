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

            prompts = self._settings.get('prompts', {})
            prompt = prompts.get('customPrompt', '')
            custom_name = prompts.get('customName')
            extra_options = prompts.get('extraOptions', [])

            # Handle custom name replacement if specified
            if custom_name and "If there is a person/character in the image you must refer to them as {name}." in extra_options:
                prompt = prompt.replace("{name}", custom_name)

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
                            return json.dumps({"error": "Invalid response from model", "image_name": self._image_name})

                except Exception as e:
                    last_error = str(e)
                    retry_count += 1
                    if retry_count >= max_retries:
                        break
                    await asyncio.sleep(1)  # Wait before retrying

            return json.dumps({
                "error": f"Failed after {max_retries} attempts: {last_error}",
                "image_name": self._image_name
            })

        except Exception as e:
            return json.dumps({
                "error": str(e),
                "image_name": self._image_name
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
                        return json.dumps({"error": "Image might be corrupted or unsupported"})
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