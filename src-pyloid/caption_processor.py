import json
import base64
import os
from typing import Optional, Dict, List, Any, Callable, Union, Generator
from dataclasses import dataclass
from PySide6.QtCore import QThread, Signal
from openai import OpenAI, AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam, ChatCompletionUserMessageParam
import asyncio
import sqlite3
from PIL import Image
import io
from contextlib import contextmanager
import time

@dataclass
class CaptionSettings:
    """Settings for caption generation"""
    model_type: str  # 'openai' or 'vllm'
    model_name: str
    api_key: str
    base_url: Optional[str] = None
    prompt: Optional[str] = None

@dataclass
class CaptionResult:
    """Result of caption generation"""
    image_name: str
    caption: Optional[str] = None
    error: Optional[str] = None
    status: str = "pending"

class CaptionBatchWorker(QThread):
    """Worker thread for batch caption generation"""
    progress = Signal(dict)  # Emits progress updates
    result = Signal(dict)    # Emits final results
    
    def __init__(self, processor: 'CaptionProcessor', image_names: List[str], settings: Dict[str, Any]):
        super().__init__()
        self.processor = processor
        self.image_names = image_names
        self.settings = settings
        self._should_stop = False
        self._event_loop: Optional[asyncio.AbstractEventLoop] = None

    def run(self) -> None:
        """Execute batch processing"""
        try:
            self._event_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._event_loop)
            
            results: List[Dict[str, Any]] = []
            total = len(self.image_names)
            
            for i, image_name in enumerate(self.image_names, 1):
                if self._should_stop:
                    break
                    
                # Emit progress
                self.progress.emit({
                    "current": i,
                    "total": total,
                    "processing": image_name
                })
                
                # Process single image
                result = self._event_loop.run_until_complete(
                    self.processor._generate_caption(image_name, self.settings)
                )
                results.append(result)
                
                # Small delay to prevent UI freeze
                time.sleep(0.1)
            
            # Emit final results
            self.result.emit({
                "type": "batch_complete" if not self._should_stop else "batch_cancelled",
                "results": results
            })
            
        except Exception as e:
            self.result.emit({
                "type": "batch_complete",
                "results": [{"error": str(e), "status": "error"}]
            })
        finally:
            if self._event_loop:
                self._event_loop.close()

    def stop(self) -> None:
        """Stop batch processing"""
        self._should_stop = True

class CaptionProcessor:
    """Handles image caption generation using OpenAI API or vLLM endpoint"""
    
    def __init__(self, session_dir: Optional[str] = None):
        self.session_dir = session_dir
        self._batch_worker: Optional[CaptionBatchWorker] = None
        self._progress_callback: Optional[Callable[[str], None]] = None
        self._result_callback: Optional[Callable[[str], None]] = None

    def set_session_dir(self, session_dir: str) -> None:
        """Set the session directory"""
        self.session_dir = session_dir

    @contextmanager
    def get_db(self) -> Generator[sqlite3.Connection, None, None]:
        """Database connection context manager"""
        if not self.session_dir:
            raise ValueError("No active session")
            
        conn = sqlite3.connect(os.path.join(self.session_dir, 'captions.db'))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _construct_prompt(self, settings: Dict[str, Any]) -> str:
        """Construct prompt based on settings"""
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
            is_word_count = str(caption_length).isdigit()
            
            # Construct base prompt based on caption type
            if caption_type == "Descriptive":
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a descriptive caption for this image in a formal tone."
                elif is_word_count:
                    final_prompt = f"Write a descriptive caption for this image in a formal tone within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} descriptive caption for this image in a formal tone."
            elif caption_type == "Descriptive (Informal)":
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a descriptive caption for this image in a casual tone."
                elif is_word_count:
                    final_prompt = f"Write a descriptive caption for this image in a casual tone within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} descriptive caption for this image in a casual tone."
            elif caption_type == "Training Prompt" or caption_type == "Stable Diffusion":
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a stable diffusion prompt for this image."
                elif is_word_count:
                    final_prompt = f"Write a stable diffusion prompt for this image within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} stable diffusion prompt for this image."
            elif caption_type == "MidJourney":
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a MidJourney prompt for this image."
                elif is_word_count:
                    final_prompt = f"Write a MidJourney prompt for this image within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} MidJourney prompt for this image."
            elif caption_type == "Booru tag list":
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a list of Booru tags for this image."
                elif is_word_count:
                    final_prompt = f"Write a list of Booru tags for this image within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} list of Booru tags for this image."
            elif caption_type == "Booru-like tag list":
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a list of Booru-like tags for this image."
                elif is_word_count:
                    final_prompt = f"Write a list of Booru-like tags for this image within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} list of Booru-like tags for this image."
            elif caption_type == "Art Critic":
                base = "Analyze this image like an art critic would with information about its composition, style, symbolism, the use of color, light, any artistic movement it might belong to, etc."
                if not caption_length or caption_length == "any":
                    final_prompt = base
                elif is_word_count:
                    final_prompt = f"{base} Keep it within {caption_length} words."
                else:
                    final_prompt = f"{base} Keep it {caption_length}."
            elif caption_type == "Product Listing":
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a caption for this image as though it were a product listing."
                elif is_word_count:
                    final_prompt = f"Write a caption for this image as though it were a product listing. Keep it under {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} caption for this image as though it were a product listing."
            elif caption_type == "Social Media Post":
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a caption for this image as if it were being used for a social media post."
                elif is_word_count:
                    final_prompt = f"Write a caption for this image as if it were being used for a social media post. Limit the caption to {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} caption for this image as if it were being used for a social media post."
            else:
                # Default to formal descriptive
                if not caption_length or caption_length == "any":
                    final_prompt = "Write a descriptive caption for this image in a formal tone."
                elif is_word_count:
                    final_prompt = f"Write a descriptive caption for this image in a formal tone within {caption_length} words."
                else:
                    final_prompt = f"Write a {caption_length} descriptive caption for this image in a formal tone."

        # Add extra options if any
        if extra_options:
            extra_reqs = "\n".join(
                f"- {option.replace('{name}', custom_name) if custom_name and '{name}' in option else option}"
                for option in extra_options
            )
            final_prompt += f"\n\nAdditional requirements:\n{extra_reqs}"

        return final_prompt

    async def _generate_caption(self, image_name: str, settings: Dict[str, Any]) -> Dict[str, Any]:
        """Generate caption for a single image"""
        print(f"_generate_caption: Starting for {image_name}")
        try:
            if not self.session_dir:
                print("_generate_caption: No active session")
                return {"error": "No active session", "image_name": image_name, "status": "error"}

            image_path = os.path.join(self.session_dir, image_name)
            print(f"_generate_caption: Checking image path: {image_path}")
            if not os.path.exists(image_path):
                print(f"_generate_caption: Image not found at {image_path}")
                return {"error": f"Image not found: {image_path}", "image_name": image_name, "status": "error"}

            # Get API settings
            print("_generate_caption: Getting API settings")
            model_type = settings.get('modelType', 'openai')
            if model_type == 'openai':
                api_settings = settings.get('openai', {})
                model = api_settings.get('model', 'gpt-4-vision-preview')
                api_key = api_settings.get('apiKey')
                base_url = None
                print(f"_generate_caption: Using OpenAI model: {model}")
            else:  # vllm/joycaption
                api_settings = settings.get('joycaption', {})
                model = api_settings.get('model', 'llama-joycaption-alpha-two-hf-llava')
                api_key = api_settings.get('apiKey')
                base_url = api_settings.get('baseUrl')
                print(f"_generate_caption: Using vLLM model: {model}")
                if not base_url:
                    print("_generate_caption: vLLM base URL not set")
                    return {"error": "vLLM base URL not set", "image_name": image_name, "status": "error"}

            if not api_key:
                print("_generate_caption: API key not set")
                return {"error": "API key not set", "image_name": image_name, "status": "error"}

            # Construct prompt
            print("_generate_caption: Constructing prompt")
            prompt = self._construct_prompt(settings)
            print(f"_generate_caption: Prompt constructed: {prompt[:50]}...")

            # Read and encode image
            print(f"_generate_caption: Reading image file: {image_path}")
            try:
                with open(image_path, "rb") as img_file:
                    image_data = img_file.read()
                    if not image_data:
                        print("_generate_caption: Empty image file")
                        return {"error": "Empty image file", "image_name": image_name, "status": "error"}
                    print(f"_generate_caption: Successfully read image data ({len(image_data)} bytes)")
            except Exception as e:
                print(f"_generate_caption: Error reading image file: {str(e)}")
                return {"error": f"Error reading image: {str(e)}", "image_name": image_name, "status": "error"}

            # Initialize API client
            print("_generate_caption: Initializing API client")
            try:
                client = AsyncOpenAI(
                    api_key=api_key,
                    base_url=base_url if base_url else "https://api.openai.com/v1"
                )
                print("_generate_caption: API client initialized")
            except Exception as e:
                print(f"_generate_caption: Error initializing API client: {str(e)}")
                return {"error": f"API client error: {str(e)}", "image_name": image_name, "status": "error"}

            # Create message payload
            print("_generate_caption: Creating message payload")
            try:
                base64_image = base64.b64encode(image_data).decode('utf-8')
                messages: List[ChatCompletionMessageParam] = [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }]
                print("_generate_caption: Message payload created")
            except Exception as e:
                print(f"_generate_caption: Error creating message payload: {str(e)}")
                return {"error": f"Message payload error: {str(e)}", "image_name": image_name, "status": "error"}

            # Make API call
            print("_generate_caption: Making API call")
            try:
                response = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=500
                )
                print("_generate_caption: API call completed successfully")

                if response.choices and response.choices[0].message.content:
                    caption = response.choices[0].message.content.strip()
                    print(f"_generate_caption: Caption generated: {caption[:50]}...")
                    
                    # Save to database
                    print("_generate_caption: Saving to database")
                    try:
                        with self.get_db() as conn:
                            conn.execute("""
                                INSERT OR REPLACE INTO captions (image_name, caption, updated_at)
                                VALUES (?, ?, CURRENT_TIMESTAMP)
                            """, (image_name, caption))
                            conn.commit()
                        print("_generate_caption: Successfully saved to database")
                    except Exception as e:
                        print(f"_generate_caption: Database error: {str(e)}")
                        # Continue even if database save fails
                    
                    return {
                        "caption": caption,
                        "image_name": image_name,
                        "status": "success"
                    }
                else:
                    print("_generate_caption: No caption generated from API response")
                    return {"error": "No caption generated", "image_name": image_name, "status": "error"}

            except Exception as e:
                print(f"_generate_caption: API call error: {str(e)}")
                return {"error": str(e), "image_name": image_name, "status": "error"}

        except Exception as e:
            print(f"_generate_caption: Unexpected error: {str(e)}")
            return {"error": str(e), "image_name": image_name, "status": "error"}

    def generate_caption_async(self, image_name: str, settings: Dict[str, Any], 
                             progress_callback: Callable[[str], None], 
                             result_callback: Callable[[str], None]) -> None:
        """Start async caption generation for a single image using batch worker"""
        print("Starting single caption generation (via batch worker)...")
        
        # Only clean up batch worker if it exists
        if self._batch_worker and self._batch_worker.isRunning():
            self._batch_worker.stop()
            self._batch_worker.wait()

        try:
            # Create batch worker with single image
            self._batch_worker = CaptionBatchWorker(self, [image_name], settings)
            
            # Connect signals for single image processing
            def handle_progress(progress_data: dict):
                if progress_callback:
                    progress_callback(f"Processing {progress_data.get('processing', '')}...")
            
            def handle_result(result_data: dict):
                if result_callback:
                    if result_data.get('type') in ['batch_complete', 'batch_cancelled']:
                        results = result_data.get('results', [])
                        if results:
                            # Send the first (and only) result
                            result_callback(json.dumps(results[0]))
            
            self._batch_worker.progress.connect(handle_progress)
            self._batch_worker.result.connect(handle_result)
            
            print("Starting batch worker for single image...")
            self._batch_worker.start()
            print("Batch worker started successfully")
            
        except Exception as e:
            print(f"Error starting batch worker: {str(e)}")
            if result_callback:
                result_callback(json.dumps({
                    "error": str(e),
                    "image_name": image_name,
                    "status": "error"
                }))

    def generate_batch_captions(self, image_names: List[str], settings: Dict[str, Any]) -> CaptionBatchWorker:
        """Start batch caption generation"""
        if self._batch_worker and self._batch_worker.isRunning():
            self._batch_worker.stop()
            self._batch_worker.wait()

        self._batch_worker = CaptionBatchWorker(self, image_names, settings)
        self._batch_worker.start()
        return self._batch_worker

    def cancel_generation(self) -> None:
        """Cancel ongoing caption generation"""
        if self._batch_worker and self._batch_worker.isRunning():
            self._batch_worker.stop()
            self._batch_worker.wait()