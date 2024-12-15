import os
import sys

APP_NAME = "spacecat sage"

def get_app_data_dir() -> str:
    """Get the OS-specific application data directory"""
    if sys.platform == "win32":
        # Windows: %APPDATA%\spacecat sage
        base_dir = os.environ.get("APPDATA")
        if not base_dir:
            base_dir = os.path.expanduser("~\\AppData\\Roaming")
    elif sys.platform == "darwin":
        # macOS: ~/Library/Application Support/spacecat sage
        base_dir = os.path.expanduser("~/Library/Application Support")
    else:
        # Linux: ~/.local/share/spacecat sage
        base_dir = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    
    app_dir = os.path.join(base_dir, APP_NAME)
    os.makedirs(app_dir, exist_ok=True)
    return app_dir

def get_sessions_dir() -> str:
    """Get the sessions directory path"""
    sessions_dir = os.path.join(get_app_data_dir(), "sessions")
    os.makedirs(sessions_dir, exist_ok=True)
    return sessions_dir

def get_current_session_dir() -> str:
    """Get the current session directory path"""
    current_session = os.path.join(get_sessions_dir(), "current")
    print(f"DEBUG path_utils: Accessing current session dir: {current_session}")
    print(f"DEBUG path_utils: Directory exists before makedirs: {os.path.exists(current_session)}")
    
    # Don't recreate if it exists
    if not os.path.exists(current_session):
        try:
            os.makedirs(current_session)
        except FileExistsError:
            pass  # Another thread may have created it
    
    return current_session

def get_backups_dir() -> str:
    """Get the backups directory path"""
    backups_dir = os.path.join(get_sessions_dir(), "backups")
    os.makedirs(backups_dir, exist_ok=True)
    return backups_dir

def get_settings_db_path() -> str:
    """Get the settings database path"""
    return os.path.join(get_app_data_dir(), "settings.db")