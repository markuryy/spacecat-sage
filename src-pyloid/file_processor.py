from PySide6.QtCore import QThread, Signal
import shutil
import os
import queue
import threading
import sqlite3
from contextlib import contextmanager
from caption_processor import CaptionProcessor
import json
from path_utils import (
    get_app_data_dir,
    get_sessions_dir,
    get_current_session_dir,
    get_backups_dir,
    get_settings_db_path
)

class FileProcessor(QThread):
    def __init__(self, session_dir: str):
        """Initialize the FileProcessor with a session directory"""
        super().__init__()
        if not isinstance(session_dir, str):
            print("ERROR: Invalid session directory")
            return
        print(f"DEBUG FileProcessor: Initializing with session dir: {session_dir}")
        if os.path.exists(session_dir):
            files = os.listdir(session_dir)
            print(f"DEBUG FileProcessor: Files in directory at init: {files}")
        self.session_dir = session_dir
        self.queue = queue.Queue()
        self._stop_event = threading.Event()
        self.current_progress = 0
        self.processed_files = []
        
        # Use utility function to get database path
        self.db_path = os.path.join(session_dir, 'captions.db')
        self.caption_processor = CaptionProcessor()
        self.caption_processor.set_session_dir(session_dir)
        
        # Initialize database
        with self.get_db() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS captions (
                    image_name TEXT PRIMARY KEY,
                    caption TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
    
    @contextmanager
    def get_db(self):
        """Get database connection with automatic closing"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
    
    def process_files(self, file_paths):
        """Add files to the processing queue"""
        if isinstance(file_paths, str):
            file_paths = [file_paths]
            
        self.processed_files = []  # Reset processed files
        total_added = 0
        
        if not isinstance(file_paths, (list, tuple)):
            print("ERROR: file_paths must be a string or list of strings")
            return
                
        for path in file_paths:
            try:
                # Ensure path is a string and exists
                path_str = str(path).strip('"\'')
                if os.path.exists(path_str):
                    print(f"DEBUG: Adding file to queue: {path_str}")
                    self.queue.put(path_str)
                    
                    # Also check for and queue associated text file
                    base_name = os.path.splitext(path_str)[0]
                    txt_path = f"{base_name}.txt"
                    if os.path.exists(txt_path):
                        print(f"DEBUG: Found caption file: {txt_path}")
                        self.queue.put(txt_path)
                        
                    total_added += 1
                else:
                    print(f"DEBUG: File does not exist: {path_str}")
            except Exception as e:
                print(f"Error adding file to queue: {str(e)}")
        
        print(f"DEBUG: Added {total_added} files to processing queue")
        if not self.isRunning() and total_added > 0:
            print("DEBUG: Starting file processor thread")
            self._stop_event.clear()  # Reset stop event
            self.start()

    def import_caption_from_text_file(self, image_path):
        """Import caption from associated text file"""
        try:
            base_name = os.path.splitext(image_path)[0]
            txt_path = f"{base_name}.txt"
            if os.path.exists(txt_path):
                print(f"DEBUG: Importing caption from {txt_path}")
                with open(txt_path, 'r', encoding='utf-8') as f:
                    caption = f.read().strip()
                    image_name = os.path.basename(image_path)
                    with self.get_db() as conn:
                        conn.execute("""
                            INSERT OR REPLACE INTO captions (image_name, caption, updated_at)
                            VALUES (?, ?, CURRENT_TIMESTAMP)
                        """, (image_name, caption))
                        conn.commit()
                return True
            return False
        except Exception as e:
            print(f"Error importing caption for {image_path}: {str(e)}")
            return False

    
    def run(self):
        """Process files in the queue"""
        files_processed = 0
        total_files = self.queue.qsize()
        print(f"DEBUG: Processing {total_files} files")
        
        while not self._stop_event.is_set():
            try:
                try:
                    file_path = self.queue.get_nowait()
                except queue.Empty:
                    break
                
                if not file_path or not isinstance(file_path, str):
                    continue
                    
                if os.path.isfile(file_path):
                    _, ext = os.path.splitext(file_path)
                    if ext.lower() in {'.jpg', '.jpeg', '.png', '.gif'}:
                        try:
                            # Ensure session directory exists
                            if not self.session_dir or not isinstance(self.session_dir, str):
                                print("ERROR: Invalid session directory")
                                continue
                                
                            if not os.path.exists(self.session_dir):
                                print(f"DEBUG: Creating session directory: {self.session_dir}")
                                os.makedirs(self.session_dir)
                            
                            # Copy file to session directory
                            dest_path = os.path.join(str(self.session_dir), os.path.basename(file_path))
                            print(f"DEBUG: Copying {file_path} to {dest_path}")
                            
                            # Copy the file
                            shutil.copy2(str(file_path), str(dest_path))
                            
                            # Import caption if text file exists
                            has_caption = False
                            base_name = os.path.splitext(file_path)[0]
                            txt_path = f"{base_name}.txt"
                            if os.path.exists(txt_path):
                                print(f"DEBUG: Importing caption from {txt_path}")
                                # First read the caption from the source text file
                                try:
                                    with open(txt_path, 'r', encoding='utf-8') as f:
                                        caption = f.read().strip()
                                        image_name = os.path.basename(dest_path)
                                        # Then save it to the database using the destination image name
                                        with self.get_db() as conn:
                                            conn.execute("""
                                                INSERT OR REPLACE INTO captions (image_name, caption, updated_at)
                                                VALUES (?, ?, CURRENT_TIMESTAMP)
                                            """, (image_name, caption))
                                            conn.commit()
                                            has_caption = True
                                            print(f"DEBUG: Successfully imported caption for {image_name}: {caption[:50]}...")
                                except Exception as e:
                                    print(f"Error importing caption from {txt_path}: {str(e)}")
                            
                            # Verify the file was copied
                            if os.path.exists(dest_path):
                                print(f"DEBUG: Successfully copied file to {dest_path}")
                            else:
                                print(f"ERROR: File copy failed - {dest_path} does not exist")
                                continue
                            
                            # Add to processed files list
                            file_info = {
                                "name": os.path.basename(dest_path),
                                "path": str(dest_path),
                                "size": os.path.getsize(dest_path),
                                "hasCaption": has_caption
                            }
                            self.processed_files.append(file_info)
                            print(f"DEBUG: Added file info: {file_info}")
                            
                        except Exception as e:
                            print(f"Error processing image {file_path}: {str(e)}")
                            continue
                
                elif os.path.isdir(file_path):
                    # Add all image files in directory to queue
                    print(f"DEBUG: Processing directory: {file_path}")
                    image_files = []
                    for root, _, files in os.walk(str(file_path)):
                        for file in files:
                            _, ext = os.path.splitext(file)
                            if ext.lower() in {'.jpg', '.jpeg', '.png', '.gif'}:
                                full_path = os.path.join(str(root), str(file))
                                image_files.append(full_path)
                                total_files += 1
                    
                    # Sort to ensure consistent ordering
                    image_files.sort()
                    print(f"DEBUG: Found {len(image_files)} images in directory")
                    for file in image_files:
                        if isinstance(file, str):
                            self.queue.put(file)
                            
                files_processed += 1
                self.current_progress = int((files_processed / total_files) * 100) if total_files > 0 else 0
                print(f"DEBUG: Progress: {self.current_progress}% ({files_processed}/{total_files})")
                
            except Exception as e:
                print(f"Error processing file: {str(e)}")
                continue
        
        print("DEBUG: File processing complete")
        # Keep progress at 100 until files are retrieved
        self.current_progress = 100
    
    def get_processed_files(self):
        """Return the list of processed files"""
        return self.processed_files
    
    def stop(self):
        """Stop the processing thread"""
        self._stop_event.set()
        self.wait()