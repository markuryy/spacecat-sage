from pyloid import (
    Pyloid,
    PyloidAPI,
    Bridge,
    TrayEvent,
    is_production,
    get_production_path,
)
from path_utils import (
    get_app_data_dir,
    get_sessions_dir,
    get_current_session_dir,
    get_backups_dir,
    get_settings_db_path
)
import os
import io
import sys
import json
import signal
import shutil
import logging
import base64
import requests
from PIL import Image
from openai import OpenAI
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from file_processor import FileProcessor
import time
import threading

app = Pyloid(app_name="spacecat-sage", single_instance=True)

if is_production():
    prod_path = get_production_path()
    if not prod_path:
        raise ValueError("Production path is None")
    app.set_icon(os.path.join(prod_path, "icons/icon.png"))
    app.set_tray_icon(os.path.join(prod_path, "icons/icon.png"))
else:
    app.set_icon("src-pyloid/icons/icon.png")
    app.set_tray_icon("src-pyloid/icons/icon.png")


############################## Tray ################################
def on_double_click():
    print("Tray icon was double-clicked.")


app.set_tray_actions(
    {
        TrayEvent.DoubleClick: on_double_click,
    }
)
app.set_tray_menu_items(
    [
        {"label": "Show Window", "callback": app.show_and_focus_main_window},
        {"label": "Exit", "callback": app.quit},
    ]
)
####################################################################

############################## Bridge ##############################
class FileAPI(PyloidAPI):
    def __init__(self):
        super().__init__()
        self._init_lock = threading.Lock()
        self._initialized = False
        self.api_key = None
        self.session_dir = None
        self.db_path = None
        self._current_request = None
        self.settings_db_path = get_settings_db_path()
        self.file_processor = None
        print("DEBUG FileAPI: Starting initialization")
        self.init_global_settings()
        self.load_api_key()
        print("DEBUG FileAPI: Finished initialization")
        self.ensure_initialized()

    def ensure_initialized(self):
        """Ensure session is initialized exactly once"""
        with self._init_lock:
            if not self._initialized:
                self.init_session()
                self._initialized = True

    def import_caption_from_text_file(self, image_path):
        """Import caption from associated text file"""
        try:
            if not self.file_processor:
                print("ERROR: No file processor available")
                return False
            return self.file_processor.import_caption_from_text_file(image_path)
        except Exception as e:
            print(f"Error importing caption for {image_path}: {str(e)}")
            return False

    def init_global_settings(self):
        """Initialize global settings database"""
        try:
            with sqlite3.connect(self.settings_db_path) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS api_keys (
                        service TEXT PRIMARY KEY,
                        key TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.commit()
        except Exception as e:
            print(f"Error initializing global settings: {str(e)}")

    @Bridge(result=str)
    def init_session(self):
        """Initialize or load existing session"""
        if self._initialized and self.session_dir and os.path.exists(self.session_dir):
            print("DEBUG: Session already initialized, skipping")
            return json.dumps({"success": True})

        try:
            print("DEBUG FileAPI: Starting init_session")
            
            # Get session directory path without creating it
            self.session_dir = get_current_session_dir()
            self.db_path = os.path.join(self.session_dir, 'captions.db')
            
            # Only create directory if it doesn't exist
            if not os.path.exists(self.session_dir):
                print("DEBUG: Creating new session directory")
                os.makedirs(self.session_dir, exist_ok=True)
            else:
                print(f"DEBUG: Using existing session directory: {self.session_dir}")
                
            # Initialize DB if needed
            if not os.path.exists(self.db_path):
                print("DEBUG: Database doesn't exist, initializing")
                self.init_db()
            else:
                print("DEBUG: Verifying existing database")
                try:
                    with self.get_db() as conn:
                        conn.execute("PRAGMA integrity_check")
                except sqlite3.Error as e:
                    print(f"Database integrity check failed: {e}")
                    self._backup_and_reinit_db()

            # Initialize file processor
            if not self.file_processor:
                print("DEBUG: Creating new file processor")
                self.file_processor = FileProcessor(self.session_dir)
                self.file_processor.caption_processor.set_session_dir(self.session_dir)

            self._initialized = True
            return json.dumps({"success": True})

        except Exception as e:
            print(f"Error initializing session: {str(e)}")
            return json.dumps({"error": str(e)})

    def _backup_and_reinit_db(self):
        """Backup corrupted database and create new one"""
        if os.path.exists(str(self.db_path)):
            backup_path = f"{self.db_path}.backup_{int(time.time())}"
            shutil.copy2(str(self.db_path), str(backup_path))
            print(f"Backed up potentially corrupted database to {backup_path}")
        self.init_db()

    @contextmanager
    def get_global_db(self):
        """Get global settings database connection with automatic closing"""
        conn = sqlite3.connect(self.settings_db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def init_db(self):
        """Initialize session database schema"""
        try:
            with self.get_db() as conn:
                # Create tables if they don't exist
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS captions (
                        image_name TEXT PRIMARY KEY,
                        caption TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS viewed_images (
                        image_name TEXT PRIMARY KEY,
                        viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.commit()
                print("Database schema initialized successfully")
        except Exception as e:
            print(f"Error initializing database schema: {str(e)}")
            raise

    @contextmanager
    def get_db(self):
        """Get database connection with automatic closing"""
        if not self.db_path:
            raise Exception("No active session")
        
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    @Bridge(result=str)
    def create_window(self):
        """Create a window with this instance as the API"""
        self.ensure_initialized()
        window = self.app.create_window(
            title="spacecat sage",
            js_apis=[self],  # Use this instance instead of creating a new one
        )

        window.set_size(800, 600)
        window.set_position(0, 0)

        if is_production():
            prod_path = get_production_path()
            if prod_path is None:
                raise ValueError("Production path is None")
            window.load_file(os.path.join(prod_path, "build/index.html"))
        else:
            window.load_url("http://localhost:5173")
            
        window.show_and_focus()
        return json.dumps({"success": True})

    @Bridge(result=str)
    def backup_session(self):
        """Create a backup of the current session"""
        try:
            if not self.session_dir or not os.path.exists(self.session_dir):
                return json.dumps({"error": "No active session to backup"})

            backups_dir = get_backups_dir()
            backup_name = f'session_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
            backup_path = os.path.join(backups_dir, backup_name)
            shutil.copytree(self.session_dir, backup_path, dirs_exist_ok=True)

            return json.dumps({
                "success": True, 
                "backup_path": backup_path
            })
        except Exception as e:
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def create_session(self):
        """Create a new session directory and database"""
        try:
            # Only backup if session exists
            if self.session_dir and os.path.exists(self.session_dir):
                backup_result = json.loads(self.backup_session())
                if 'error' in backup_result:
                    return json.dumps({"error": f"Backup failed: {backup_result['error']}"})

                # Clear the current session
                # shutil.rmtree(self.session_dir)
                
            # Reset initialization flag
            self._initialized = False
            
            # Re-initialize session
            self.ensure_initialized()
            return json.dumps({"success": True})

        except Exception as e:
            print(f"Error creating session: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(str, result=str)
    def get_session_path(self, filename):
        """Get the full path for a file in the session directory"""
        if not self.session_dir:
            return json.dumps({"error": "No active session"})
        
        file_path = os.path.join(self.session_dir, filename)
        return json.dumps({"path": file_path})

    @Bridge(str, result=str)
    def add_files(self, file_paths_str):
        """Add files to session by copying them"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})

            # Parse the JSON string into a list of paths
            try:
                file_paths = json.loads(file_paths_str)
                if isinstance(file_paths, str):
                    file_paths = [file_paths]
            except json.JSONDecodeError:
                # If not valid JSON, treat as a single path
                file_paths = [file_paths_str]
            
            print("DEBUG: Session directory:", self.session_dir)
            print("DEBUG: Adding files:", file_paths)
            
            # Initialize file processor if needed
            if not self.file_processor:
                print("DEBUG: Creating new file processor for session:", self.session_dir)
                self.file_processor = FileProcessor(self.session_dir)
            else:
                print("DEBUG: Using existing file processor for session:", self.session_dir)
                # Ensure session dir is set correctly
                self.file_processor.session_dir = self.session_dir
                self.file_processor.caption_processor.set_session_dir(self.session_dir)
            
            print("DEBUG: Starting file processing")
            # Start processing files in background
            self.file_processor.process_files(file_paths)
            
            return json.dumps({"success": True, "message": "Processing files..."})
            
        except Exception as e:
            print(f"Error adding files: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def get_import_progress(self):
        """Get the current import progress and processed files if complete"""
        try:
            if not self.file_processor:
                return json.dumps({"progress": 0, "error": "No active file processor"})
            
            progress = self.file_processor.current_progress
            print(f"DEBUG: Import progress: {progress}%")
            
            if progress == 100:
                # Get processed files and reset progress
                processed_files = self.file_processor.get_processed_files()
                print(f"DEBUG: Processing complete, got {len(processed_files)} files")
                
                # Verify files exist in session directory
                verified_files = []
                if self.session_dir:  # Check if session_dir is not None
                    for file in processed_files:
                        if isinstance(file, dict) and 'name' in file:
                            file_path = os.path.join(str(self.session_dir), str(file['name']))
                            if os.path.exists(file_path):
                                verified_files.append(file)
                            else:
                                print(f"WARNING: Processed file not found in session: {file_path}")
                
                return json.dumps({
                    "progress": 0,
                    "complete": True,
                    "files": verified_files
                })
            return json.dumps({"progress": progress})
        except Exception as e:
            print(f"Error getting import progress: {str(e)}")
            return json.dumps({"progress": 0, "error": str(e)})

    @Bridge(str, str, result=str)
    def save_caption(self, image_name, caption):
        """Save caption to database"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})
        
            with self.get_db() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO captions (image_name, caption, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                """, (image_name, caption))
                conn.commit()
            
            return json.dumps({"success": True})
        except Exception as e:
            print(f"Error saving caption: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(str, result=str)
    def get_caption(self, image_name):
        """Get caption from database"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})

            with self.get_db() as conn:
                result = conn.execute(
                    "SELECT caption FROM captions WHERE image_name = ?",
                    (image_name,)
                ).fetchone()
                
                caption = result[0] if result else ""
                return json.dumps({"caption": caption})
        except Exception as e:
            print(f"Error getting caption: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def export_captions(self):
        """Export all captions to text files"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})
                
            with self.get_db() as conn:
                captions = conn.execute("SELECT * FROM captions").fetchall()
                
                for row in captions:
                    base_name = os.path.splitext(row['image_name'])[0]
                    caption_path = os.path.join(self.session_dir, base_name + '.txt')
                    with open(caption_path, 'w', encoding='utf-8') as f:
                        f.write(row['caption'])

            return json.dumps({"success": True})
        except Exception as e:
            print(f"Error exporting captions: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def clear_session(self):
        """Clear all files in the current session"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})

            # Backup the session before clearing
            backup_result = json.loads(self.backup_session())
            if 'error' in backup_result:
                return json.dumps({"error": f"Backup failed before clearing: {backup_result['error']}"})

            # Remove all files in the session directory
            for file in os.listdir(self.session_dir):
                file_path = os.path.join(self.session_dir, file)
                if os.path.isfile(file_path):
                    os.remove(file_path)
            
            # Reinitialize the database after clearing
            self.init_db()

            # Reset the file processor
            if self.file_processor:
                self.file_processor = FileProcessor(self.session_dir)
                self.file_processor.caption_processor.set_session_dir(self.session_dir)
            
            return json.dumps({"success": True})
        except Exception as e:
            print(f"Error clearing session: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def list_session_files(self):
        """List all files in session with optimized loading"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"files": [], "error": "No active session"})
            
            files = []
            
            # First just get the list of files without loading content
            all_files = sorted([
                f for f in os.listdir(self.session_dir) 
                if os.path.isfile(os.path.join(self.session_dir, f)) and f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif'))
            ])
            
            for file in all_files:
                try:
                    base_name = os.path.splitext(file)[0]
                    caption_file = base_name + '.txt'
                    # Initially just return the file path and metadata
                    files.append({
                        "name": file,
                        "path": os.path.join(self.session_dir, file),  # Return actual file path
                        "size": os.path.getsize(os.path.join(self.session_dir, file)),
                        "hasCaption": os.path.exists(os.path.join(self.session_dir, caption_file))
                    })
                except Exception as e:
                    print(f"Error processing file {file}: {str(e)}")
                    continue
                    
            return json.dumps({"files": files})
        except Exception as e:
            print(f"Error listing files: {str(e)}")
            return json.dumps({"files": [], "error": str(e)})

    @Bridge(str, result=str)
    def get_image_data(self, file_path):
        """Get image data for a specific file"""
        try:
            if not os.path.exists(file_path):
                return json.dumps({"error": "File not found"})

            with open(file_path, 'rb') as img_file:
                encoded = base64.b64encode(img_file.read()).decode()
                mime_type = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif'
                }[os.path.splitext(file_path)[1].lower()]
                return json.dumps({
                    "path": f"data:{mime_type};base64,{encoded}"
                })
        except Exception as e:
            print(f"Error loading image data: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def select_directory(self):
        """Let user select a directory for export"""
        try:
            directory = self.app.select_directory_dialog()
            if directory:
                return json.dumps({"path": directory})
            return json.dumps({"error": "No directory selected"})
        except Exception as e:
            print(f"Error selecting directory: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(str, result=str)
    def export_session(self, export_dir):
        """Export session files to specified directory"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})
                
            # Create timestamped export folder
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            export_path = os.path.join(export_dir, f"spacecat_export_{timestamp}")
            os.makedirs(export_path, exist_ok=True)

            # Get all captions from database
            captions_dict = {}
            with self.get_db() as conn:
                captions = conn.execute("SELECT * FROM captions").fetchall()
                for row in captions:
                    captions_dict[row['image_name']] = row['caption']

            # Copy all image files from session directory
            files_copied = 0
            for src_file in os.listdir(self.session_dir):
                if os.path.isfile(os.path.join(self.session_dir, src_file)) and src_file.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
                    # Copy image file
                    dst_file = os.path.join(export_path, src_file)
                    shutil.copy2(os.path.join(self.session_dir, src_file), dst_file)
                    files_copied += 1

                    # Write caption if exists
                    if src_file in captions_dict:
                        base_name = os.path.splitext(src_file)[0]
                        caption_file = os.path.join(export_path, base_name + '.txt')
                        with open(caption_file, 'w', encoding='utf-8') as f:
                            f.write(captions_dict[src_file])

            return json.dumps({"success": True, "files_copied": files_copied, "export_path": export_path})
        except Exception as e:
            print(f"Error exporting session: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(str, result=str)
    def set_api_key(self, api_key):
        """Set OpenAI API key"""
        try:
            self.api_key = api_key
            with self.get_global_db() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO api_keys (service, key, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                """, ('openai', api_key))
                conn.commit()
            return json.dumps({"success": True})
        except Exception as e:
            return json.dumps({"error": str(e)})

    @Bridge(str, result=str)
    def set_joycaption_api_key(self, api_key):
        """Set JoyCaption API key"""
        try:
            with self.get_global_db() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO api_keys (service, key, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                """, ('joycaption', api_key))
                conn.commit()
            return json.dumps({"success": True})
        except Exception as e:
            return json.dumps({"error": str(e)})

    def load_api_key(self):
        """Load OpenAI API key from global settings"""
        try:
            with self.get_global_db() as conn:
                result = conn.execute(
                    "SELECT key FROM api_keys WHERE service = ?",
                    ('openai',)
                ).fetchone()
                if result:
                    self.api_key = result['key'].strip('"')  # Strip quotes from API key
        except Exception as e:
            print(f"Error loading API key: {str(e)}")

    def get_session_dir(self) -> str:
        """Get the session directory path"""
        if not self.session_dir:
            self.session_dir = get_current_session_dir()
        return self.session_dir

    def get_settings_file(self) -> str:
        """Get the settings file path"""
        return get_settings_db_path()

    def handle_get_settings(self):
        """Get settings from file"""
        try:
            settings_file = self.get_settings_file()
            if os.path.exists(settings_file):
                open(settings_file, 'a').close()
        except Exception as e:
            print(f"Error getting settings: {str(e)}")

    def _get_default_settings(self):
        """Get default settings"""
        return {
            'modelType': 'openai',
            'openai': {
                'apiKey': None,
                'model': 'gpt-4o'  # Always default to gpt-4o
            },
            'joycaption': {
                'apiKey': None,
                'baseUrl': None,
                'model': 'joycaption-alpha-two'
            },
            'prompts': {
                'captionType': 'Descriptive',
                'captionLength': 'medium-length',
                'customPrompt': '',
                'extraOptions': []
            },
            'interface': {
                'separateViewed': False
            }
        }

    @Bridge(result=str)
    def get_settings(self):
        """Get all settings from the global settings database"""
        try:
            with self.get_global_db() as conn:
                cursor = conn.cursor()
                settings = self._get_default_settings()

                # Get API keys first
                cursor.execute("SELECT service, key FROM api_keys")
                for row in cursor.fetchall():
                    service, key = row
                    if service == 'openai':
                        settings['openai']['apiKey'] = key.strip('"') if key else None
                    elif service == 'joycaption':
                        settings['joycaption']['apiKey'] = key.strip('"') if key else None

                # Then get other settings
                cursor.execute("SELECT key, value FROM settings")
                for row in cursor.fetchall():
                    key, value = row
                    try:
                        # Try to parse the value as JSON
                        try:
                            parsed_value = json.loads(value)
                        except json.JSONDecodeError:
                            parsed_value = value

                        # Handle nested settings with dot notation
                        parts = key.split('.')
                        current = settings
                        for part in parts[:-1]:
                            if part not in current:
                                current[part] = {}
                            current = current[part]
                        current[parts[-1]] = parsed_value
                    except Exception as e:
                        print(f"Error parsing setting {key}: {e}")
                        continue

                return json.dumps(settings)
        except Exception as e:
            print(f"Error getting settings: {e}")
            return json.dumps(self._get_default_settings())

    @Bridge(str, str, result=str)
    def save_setting(self, key: str, value: str) -> str:
        """Save a setting to the global settings database."""
        try:
            # Parse the JSON string value
            try:
                parsed_value = json.loads(value)
            except json.JSONDecodeError:
                parsed_value = value
                
            # Store the parsed value in memory
            parts = key.split('.')
            current = self._get_default_settings()
            for part in parts[:-1]:
                if part not in current:
                    current[part] = {}
                current = current[part]
            current[parts[-1]] = parsed_value
            
            # Store the original JSON string in the database
            with self.get_global_db() as conn:
                cursor = conn.cursor()
                
                # Try to parse value as JSON if it's a string
                if isinstance(value, str):
                    try:
                        value = json.loads(value)
                    except json.JSONDecodeError:
                        pass
                
                # Convert value to string for storage
                if isinstance(value, (dict, list)):
                    value = json.dumps(value)
                elif value is None:
                    value = ''
                else:
                    value = str(value)
                
                cursor.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                    (key, value)
                )
                conn.commit()
                return json.dumps({"success": True})
        except Exception as e:
            return json.dumps({"error": str(e)})

    @Bridge(str, result=str)
    def generate_caption(self, image_name):
        """Generate caption for an image using model from settings"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})

            if not self.file_processor:
                return json.dumps({"error": "File processor not initialized"})

            # Get current settings
            settings = {}
            try:
                settings_result = self.get_settings()
                settings = json.loads(settings_result)
            except Exception as e:
                print(f"Error loading settings: {str(e)}")
                return json.dumps({"error": "Failed to load settings"})

            # Track last progress update to prevent spamming
            last_progress_time = [0]
            min_progress_interval = 1.0  # seconds

            def on_progress(msg):
                current_time = time.time()
                if current_time - last_progress_time[0] >= min_progress_interval:
                    print(f"Progress: {msg}")
                    self.window.emit('showToast', {'message': msg, 'type': 'loading'})
                    last_progress_time[0] = int(current_time)

            def on_result(result):
                print(f"Caption result: {result}")
                # Let frontend handle saving and UI updates
                self.window.emit('handleCaptionResult', result)

            self.file_processor.caption_processor.progress.connect(on_progress)
            self.file_processor.caption_processor.result.connect(on_result)

            # Start async caption generation
            self.file_processor.caption_processor.generate_caption_async(image_name, settings['modelType'], settings)
            return json.dumps({"status": "started"})

        except Exception as e:
            print(f"Error starting caption generation: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def cancel_generation(self):
        """Cancel ongoing caption generation"""
        try:
            if self.file_processor and self.file_processor.caption_processor:
                self.file_processor.caption_processor.cancel_generation()
                return json.dumps({"success": True})
            return json.dumps({"error": "No active caption generation"})
        except Exception as e:
            print(f"Error cancelling generation: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(str, result=str)
    def mark_image_viewed(self, image_name):
        self.ensure_initialized()
        """Mark an image as viewed"""
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})

            with self.get_db() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO viewed_images (image_name, viewed_at)
                    VALUES (?, CURRENT_TIMESTAMP)
                """, (image_name,))
                conn.commit()
            
            return json.dumps({"success": True})
        except Exception as e:
            print(f"Error marking image as viewed: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(str, result=str)
    def unmark_image_viewed(self, image_name):
        """Remove viewed status from an image"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})

            with self.get_db() as conn:
                conn.execute("DELETE FROM viewed_images WHERE image_name = ?", (image_name,))
                conn.commit()
            
            return json.dumps({"success": True})
        except Exception as e:
            print(f"Error unmarking image as viewed: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def get_viewed_images(self):
        """Get list of viewed images"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})

            with self.get_db() as conn:
                viewed = conn.execute("SELECT image_name FROM viewed_images").fetchall()
                viewed_list = [row['image_name'] for row in viewed]
            
            return json.dumps({"viewed": viewed_list})
        except Exception as e:
            print(f"Error getting viewed images: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(str, str, result=str)
    def save_edited_image(self, image_name, base64_data):
        """Save edited image to session directory"""
        self.ensure_initialized()
        try:
            if not self.session_dir:
                return json.dumps({"error": "No active session"})

            # Remove header from base64 data
            if ',' in base64_data:
                base64_data = base64_data.split(',', 1)[1]

            # Decode base64 to binary
            image_data = base64.b64decode(base64_data)

            # Load image using PIL to preserve format and metadata
            img = Image.open(io.BytesIO(image_data))

            # Determine format based on original file extension
            original_format = os.path.splitext(image_name)[1].lower()
            save_format = None
            if original_format in ['.jpg', '.jpeg']:
                save_format = 'JPEG'
                if img.mode == 'RGBA':
                    # Convert RGBA to RGB for JPEG
                    img = img.convert('RGB')
            elif original_format == '.png':
                save_format = 'PNG'
            else:
                # Default to PNG for unknown formats
                save_format = 'PNG'
                image_name = os.path.splitext(image_name)[0] + '.png'

            # Save to file with no compression
            image_path = os.path.join(self.session_dir, image_name)
            img.save(image_path, format=save_format, quality=100, subsampling=0)

            return json.dumps({
                "success": True,
                "path": image_path
            })
        except Exception as e:
            print(f"Error saving edited image: {str(e)}")
            return json.dumps({"error": str(e)})

    @Bridge(result=str)
    def get_all_captions(self):
        """Get all captions from database in a single call"""
        self.ensure_initialized()
        try:
            with self.get_db() as conn:
                cursor = conn.execute("SELECT image_name, caption FROM captions")
                captions = {row['image_name']: row['caption'] for row in cursor}
                return json.dumps({"captions": captions})
        except Exception as e:
            return json.dumps({"error": str(e)})

####################################################################

# Create a single instance of FileAPI
file_api = FileAPI()

if is_production():
    window = app.create_window(
        title="spacecat sage",
        js_apis=[file_api],  # Use the single instance
    )
    window.set_size(800, 600)
    window.set_position(0, 0)
    window.set_dev_tools(False)  # Explicitly set
    
    prod_path = get_production_path()
    if prod_path is None:
        raise ValueError("Production path is None")
    window.load_file(os.path.join(prod_path, "build/index.html"))
else:
    window = app.create_window(
        title="spacecat sage (dev)",
        js_apis=[file_api],  # Use the single instance
        dev_tools=True,
    )
    window.set_size(800, 600)
    window.set_position(0, 0)
    window.load_url("http://localhost:5173")
        
window.show_and_focus()

app.run()  # run