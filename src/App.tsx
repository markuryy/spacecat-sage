import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  startTransition
} from 'react';
import {
  Settings,
  Wand2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
  FolderInput,
  FolderUp,
  Crop
} from 'lucide-react';
import AnimatedShinyText from '@/components/ui/animated-shiny-text';
import { IconBrandGithub } from '@tabler/icons-react';
import debounce from 'lodash.debounce';
import { SettingsModal } from './components/SettingsModal';
import { BatchModal } from './components/BatchModal';
import { NoApiKeyDialog } from './components/OopsNoRobots';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import ImageEditorModal from '@/components/ImageEditorModal';
import FileListSection from '@/components/FileList';
import { imageCache } from './utils/imageCache';

interface FileInfo {
  name: string
  path: string
  size: number
}

interface Settings {
  modelType: 'openai' | 'joycaption-api' | 'joycaption-local'
  openai: {
    apiKey: string | null
    model: string
  }
  joycaption: {
    apiKey: string | null
    baseUrl: string | null
    model: string
  }
  prompts: {
    captionType: string
    captionLength: string
    customPrompt: string
    extraOptions: string[]
    customName?: string
  }
  interface: {
    separateViewed: boolean
  }
}

declare global {
  interface Window {
    pyloid: {
      EventAPI: {
        listen: (event: string, callback: (data: any) => void) => void;
      };
      FileAPI: {
        // Caption generation
        generate_caption: (image_name: string, prompt: string, model: string) => Promise<string>;
        cancel_generation: () => Promise<string>;
        get_caption: (image_name: string) => Promise<string>;
        save_caption: (image_name: string, caption: string) => Promise<string>;
        
        // Session management
        create_session: () => Promise<string>;
        init_session: () => Promise<string>;
        clear_session: () => Promise<string>;
        list_session_files: () => Promise<string>;
        add_files: (file_paths: string) => Promise<string>;
        get_import_progress: () => Promise<string>;
        export_session: (export_dir: string) => Promise<string>;
        
        // Image handling
        get_image_data: (file_path: string) => Promise<string>;
        save_edited_image: (image_name: string, base64_data: string) => Promise<string>;
        select_directory: () => Promise<string>;
        
        // Settings
        get_settings: () => Promise<string>;
        save_setting: (key: string, value: string) => Promise<string>;
        
        // Viewed status
        get_viewed_images: () => Promise<string>;
        mark_image_viewed: (image_name: string) => Promise<string>;
        
        // Captions
        get_all_captions: () => Promise<string>;
      };
    };
  }
}

const App = () => {
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [noApiKeyOpen, setNoApiKeyOpen] = useState<boolean>(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [currentImage, setCurrentImage] = useState<FileInfo | null>(null);
  const [loadedCaption, setLoadedCaption] = useState<string>('');
  const [editingCaption, setEditingCaption] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [viewedCaptions, setViewedCaptions] = useState<Set<string>>(new Set());

  // Initially, settings are null until loaded from backend
  const [settings, setSettings] = useState<Settings | null>(null);

  // Track files with and without captions
  const [captionedFiles, setCaptionedFiles] = useState<FileInfo[]>([]);
  const [uncaptionedFiles, setUncaptionedFiles] = useState<FileInfo[]>([]);
  const debouncedSaveRef = useRef<ReturnType<typeof debounce>>();
  const [isInitializing, setIsInitializing] = useState(false);
  const [restoringFiles, setRestoringFiles] = useState<{current: string; total: number; count: number} | null>(null);
  const [addingFiles, setAddingFiles] = useState(false);
  const [importProgress, setImportProgress] = useState<number>(0);

  const [editorOpen, setEditorOpen] = useState(false);

  // Initialize the app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsInitializing(true);
        const startTime = Date.now();
  
        // Step 1: Initialize session without clearing it
        console.log('Initializing session...');
        const sessionResponse = await window.pyloid.FileAPI.init_session();
        const sessionResult = JSON.parse(sessionResponse);
        if (sessionResult.error) {
          console.error('Error initializing session:', sessionResult.error);
          return;
        }
  
        // Step 2: Load settings (do this second so we have them for the UI)
        const settingsResponse = await window.pyloid.FileAPI.get_settings();
        const loadedSettings = JSON.parse(settingsResponse);
        if (loadedSettings && typeof loadedSettings === 'object') {
          setSettings(loadedSettings);
        } else {
          console.error('Settings are not an object:', loadedSettings);
          setSettings(null);
        }
  
        // Step 3: Load viewed status
        const viewedResponse = await window.pyloid.FileAPI.get_viewed_images();
        const viewedResult = JSON.parse(viewedResponse);
        if (!viewedResult.error) {
          setViewedCaptions(new Set(viewedResult.viewed));
        }
  
        // Step 4: Load files (do this last since it's the biggest operation)
        console.log('Loading files...');
        const filesResponse = await window.pyloid.FileAPI.list_session_files();
        const { files: initialFiles, error } = JSON.parse(filesResponse);
        if (error) {
          console.error('Error loading files:', error);
        } else if (initialFiles) {
          console.log('Loaded files:', initialFiles);
          if (initialFiles.length > 0) {
            setRestoringFiles({ current: '', total: initialFiles.length, count: 0 });
            
            // Process files in batches
            const batchSize = 50;
            const minDuration = 1000;
            const batchDelay = Math.max(16, minDuration / Math.ceil(initialFiles.length / batchSize));
            
            for (let i = 0; i < initialFiles.length; i += batchSize) {
              const batch = initialFiles.slice(i, i + batchSize);
              setRestoringFiles(prev => ({
                ...prev!,
                current: batch[batch.length - 1].name,
                count: Math.min(i + batchSize, initialFiles.length)
              }));
              await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
          }
          setFiles(initialFiles);
        }
  
        // Ensure loading screen shows for at least 1 second
        const elapsed = Date.now() - startTime;
        if (elapsed < 1000) {
          await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
        }
  
      } catch (error) {
        console.error('Error during initialization:', error);
        toast.error('Failed to initialize application');
      } finally {
        setIsInitializing(false);
        setRestoringFiles(null);
      }
    };
  
    // Start initialization
    initializeApp();
  }, []); // Empty dependency array - only run once on mount

  // Helper to get cached image URL
  const getCachedImageUrl = (path: string): string | null => {
    return imageCache.get(path) || null;
  };

  // Update file lists when files change or captions are saved
  useEffect(() => {
    const updateFileLists = async () => {
      try {
        // Get initial caption status for all files
        const response = await window.pyloid.FileAPI.get_all_captions();
        const { captions, error } = JSON.parse(response);
        if (error) {
          console.error('Error loading captions:', error);
          return;
        }

        // Sort files based on caption existence
        const captioned: FileInfo[] = [];
        const uncaptioned: FileInfo[] = [];
        
        files.forEach((file) => {
          if (captions[file.name]) {
            captioned.push(file);
          } else {
            uncaptioned.push(file);
          }
        });

        setCaptionedFiles(captioned);
        setUncaptionedFiles(uncaptioned);
      } catch (error) {
        console.error('Error updating file lists:', error);
      }
    };
    
    updateFileLists();
  }, [files]); // Only update when files array changes

  // Move file between lists when caption is saved
  useEffect(() => {
    if (!currentImage) return;
    
    if (loadedCaption) {
      // Move to captioned list if not already there
      if (!captionedFiles.some(f => f.name === currentImage.name)) {
        setCaptionedFiles(prev => [...prev, currentImage]);
        setUncaptionedFiles(prev => prev.filter(f => f.name !== currentImage.name));
      }
    } else {
      // Move to uncaptioned list if not already there
      if (!uncaptionedFiles.some(f => f.name === currentImage.name)) {
        setUncaptionedFiles(prev => [...prev, currentImage]);
        setCaptionedFiles(prev => prev.filter(f => f.name !== currentImage.name));
      }
    }
  }, [currentImage, loadedCaption]);

  // Mark caption as viewed when loading image
  useEffect(() => {
    const markAsViewed = async () => {
      if (currentImage && loadedCaption) {
        try {
          const response = await window.pyloid.FileAPI.mark_image_viewed(currentImage.name);
          const result = JSON.parse(response);
          if (result.error) {
            console.error('Error marking image as viewed:', result.error);
          } else {
            setViewedCaptions(prev => new Set([...prev, currentImage.name]));
          }
        } catch (error) {
          console.error('Error marking image as viewed:', error);
        }
      }
    };
    markAsViewed();
  }, [currentImage, loadedCaption]);

  // Load caption when switching images
  useEffect(() => {
    const loadCaption = async () => {
      if (!currentImage) {
        setLoadedCaption('');
        setEditingCaption('');
        return;
      }

      try {
        const response = await window.pyloid.FileAPI.get_caption(currentImage.name);
        const result = JSON.parse(response);
        
        if (result.error) {
          console.error('Error loading caption:', result.error);
          setLoadedCaption('');
          setEditingCaption('');
        } else {
          const caption = result.caption || '';
          setLoadedCaption(caption);
          setEditingCaption(caption);
          
          // Update file lists if caption status changed
          if (caption) {
            setCaptionedFiles(prev => {
              if (!prev.some(f => f.name === currentImage.name)) {
                return [...prev, currentImage];
              }
              return prev;
            });
            setUncaptionedFiles(prev => prev.filter(f => f.name !== currentImage.name));
          } else {
            setUncaptionedFiles(prev => {
              if (!prev.some(f => f.name === currentImage.name)) {
                return [...prev, currentImage];
              }
              return prev;
            });
            setCaptionedFiles(prev => prev.filter(f => f.name !== currentImage.name));
          }
        }
      } catch (error) {
        console.error('Error loading caption:', error);
        setLoadedCaption('');
        setEditingCaption('');
      }
    };

    loadCaption();
  }, [currentImage?.name]);

  // Handle saving edited image
  const handleSaveEditedImage = async (editedDataUrl: string) => {
    if (!currentImage) return;
    
    try {
      // Debug log the data URL
      console.log('Saving edited image for:', currentImage.name);
      console.log('Received data URL of length:', editedDataUrl.length);
      
      // Extract base64 data and verify it
      const base64data = editedDataUrl.split(',')[1];
      if (!base64data) {
        console.error('Failed to extract base64 data from data URL');
        toast.error('Failed to save edited image - invalid data format');
        return;
      }
      console.log('Extracted base64 data of length:', base64data.length);
      
      // Save edited image to backend
      console.log('Saving to backend...');
      const response = await window.pyloid.FileAPI.save_edited_image(currentImage.name, base64data);
      console.log('Backend response:', response);
      const result = JSON.parse(response);
      
      if (result.error) {
        console.error('Error saving edited image:', result.error);
        toast.error('Failed to save edited image');
      } else {
        // Update the image path immediately
        const updatedFile = { ...currentImage, path: result.path };
        console.log('Image saved successfully, updating path to:', result.path);
        
        // If this is a PNG or JPEG path, ensure we're using the right extension
        const ext = result.path.toLowerCase().split('.').pop();
        if (['jpg', 'jpeg', 'png'].includes(ext)) {
          // Update the cache with the new edited image data directly
          imageCache.set(result.path, editedDataUrl);
        } else {
          // If it's not a recognized format, clear it from cache to force a reload
          imageCache.delete(currentImage.path);
          imageCache.delete(result.path);
        }
        
        // Update all instances of this file
        setFiles(prev => prev.map(f => f.name === currentImage.name ? updatedFile : f));
        setCaptionedFiles(prev => prev.map(f => f.name === currentImage.name ? updatedFile : f));
        setUncaptionedFiles(prev => prev.map(f => f.name === currentImage.name ? updatedFile : f));
        setCurrentImage(updatedFile);
        
        // Show success message
        toast.success('Image edited successfully');
        setEditorOpen(false);
      }
    } catch (error) {
      console.error('Error saving edited image:', error);
    }
  };

  // Debounced saving of caption
  const debouncedSaveCaption = useCallback(
    debounce(async (imageName: string, captionText: string) => {
      if (!captionText.trim() || saving) return
      
      try {
        setSaving(true)
        const result = await window.pyloid.FileAPI.save_caption(imageName, captionText)
        const response = JSON.parse(result)
        if (response.error) {
          console.error('Error saving caption:', response.error)
          toast.error('Failed to save caption', {
            description: response.error
          })
        } else {
          setLoadedCaption(captionText)
        }
      } catch (error) {
        console.error('Error saving caption:', error)
        toast.error('Failed to save caption', {
          description: 'An unexpected error occurred'
        })
      } finally {
        setSaving(false)
      }
    }, 500),
    [saving]
  )

  // Cancel any pending saves when unmounting
  useEffect(() => {
    return () => {
      debouncedSaveRef.current?.cancel()
    }
  }, [])

  // Handle caption changes
  const handleCaptionChange = useCallback((text: string) => {
    if (!currentImage) return
    setEditingCaption(text)

    // Cancel any pending saves
    debouncedSaveRef.current?.cancel()

    // Save the caption
    debouncedSaveCaption(currentImage.name, text)
  }, [currentImage, debouncedSaveCaption])

  // Handle manual caption save (e.g., on Shift+Enter)
  const handleManualSave = async () => {
    if (!currentImage || saving) return

    setSaving(true)
    try {
      const response = await window.pyloid.FileAPI.save_caption(
        currentImage.name,
        editingCaption
      )
      const result = JSON.parse(response)
      
      if (result.error) {
        console.error('Error saving caption:', result.error)
        toast.error('Failed to save caption', {
          description: result.error
        })
        return false
      } else {
        setLoadedCaption(editingCaption)
        
        // Update file metadata
        // const updatedFile = { name: currentImage.name, hasCaption: true } // TODO: Fix image editing
        setFiles(prev => prev.map(f => f.name === currentImage.name ? { ...f, hasCaption: true } : f))
        setCaptionedFiles(prev => prev.map(f => f.name === currentImage.name ? { ...f, hasCaption: true } : f))
        setUncaptionedFiles(prev => prev.filter(f => f.name !== currentImage.name))
        
        if (currentImage?.name === currentImage.name) {
          setCurrentImage(prev => prev ? { ...prev, hasCaption: true } : prev)
        }
        return true
      }
    } catch (error) {
      console.error('Error saving caption:', error)
      toast.error('Failed to save caption', {
        description: 'An unexpected error occurred'
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  // Handle image selection with save cancellation
  const handleImageSelect = async (file: FileInfo) => {
    if (file.name === currentImage?.name || saving || generating) return

    // If generating, ask to cancel
    if (generating) {
      const confirmCancel = window.confirm(
        'Caption generation in progress. Cancel it and switch images?'
      )
      if (!confirmCancel) return
      await cancelGeneration()
    }

    // Cancel any pending saves
    debouncedSaveRef.current?.cancel()

    // If there are unsaved changes, save them first
    if (currentImage && editingCaption !== loadedCaption) {
      const saveSuccessful = await handleManualSave()
      if (!saveSuccessful) {
        const confirmSwitch = window.confirm(
          'Failed to save current caption. Switch image anyway? Your changes will be lost.'
        )
        if (!confirmSwitch) return
      }
    }

    // Batch all state updates together
    startTransition(() => {
      setCurrentImage(file)
      setLoadedCaption('')
      setEditingCaption('')
    })
  }
  
  // Handle selecting a folder
  const handleAddFiles = async () => {
    try {
      const response = await window.pyloid.FileAPI.select_directory();
      const result = JSON.parse(response);
      
      if (result.error) {
        console.error('Folder selection error:', result.error);
        return;
      }
      
      // Only show loading after folder is selected
      setAddingFiles(true);
      
      // Add the selected folder to the session
      const addResponse = await window.pyloid.FileAPI.add_files(JSON.stringify([result.path]));
      const addResult = JSON.parse(addResponse);
      
      if (addResult.error) {
        console.error('Error adding files:', addResult.error);
        setAddingFiles(false);
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
      setAddingFiles(false);
    }
  };

  const loadingToastId = useRef<string | number | null>(null);

  const generateCaption = useCallback(async () => {
    if (!currentImage || !settings) return;
    
    try {
      // Clear any existing toasts before starting
      if (loadingToastId.current) {
        toast.dismiss(loadingToastId.current);
        loadingToastId.current = null;
      }
      
      setGenerating(true);
      const prompt = settings.prompts.customPrompt || `Generate a ${settings.prompts.captionType} ${settings.prompts.captionLength} caption for this image.`;
      
      const response = await window.pyloid.FileAPI.generate_caption(
        currentImage.name,
        prompt,
        settings.modelType === 'openai' ? settings.openai.model : settings.joycaption.model
      );
      
      // Let the event handlers handle the response
      const result = JSON.parse(response);
      if (result.error && !result.status) { // Only show error if not "started" status
        setGenerating(false);
      }
    } catch (error) {
      console.error('Error generating caption:', error);
      setGenerating(false);
    }
  }, [currentImage, settings]);

  const handleGenerateClick = () => {
    const hasApiKey = settings?.openai?.apiKey || settings?.joycaption?.apiKey;
    if (!hasApiKey) {
      setNoApiKeyOpen(true);
      return;
    }

    // If there are selected files, show batch modal
    if (selectedFiles.length > 0) {
      setModalOpen(true);
      return;
    }

    // Otherwise generate caption for current image
    generateCaption();
  };

  // Handle cancelling caption generation
  const cancelGeneration = async () => {
    try {
      const response = await window.pyloid.FileAPI.cancel_generation();
      const result = JSON.parse(response);
      if (result.error) {
        console.error('Error cancelling generation:', result.error);
        toast.error('Failed to cancel generation');
      } else {
        if (loadingToastId.current) {
          toast.dismiss(loadingToastId.current);
          loadingToastId.current = null;
        }
        toast.error('Caption generation cancelled');
      }
    } catch (error) {
      console.error('Error cancelling generation:', error);
      toast.error('Failed to cancel generation');
    } finally {
      setGenerating(false);
    }
  };

  // Handle batch processing
  const handleBatchProcess = async (file: FileInfo) => {
    if (!settings) return;
    try {
      const model = settings.modelType === 'openai' ? settings.openai.model : settings.joycaption.model;
      const prompt = settings.prompts.customPrompt || `Generate a ${settings.prompts.captionType} ${settings.prompts.captionLength} caption for this image.`;
      
      const response = await window.pyloid.FileAPI.generate_caption(
        file.name,
        prompt,
        model
      )
      const result = JSON.parse(response)
      
      if (result.error) {
        console.error('Error generating caption:', result.error)
        toast.error('Failed to generate caption', {
          description: result.error
        })
      } else if (result.caption) {
        await window.pyloid.FileAPI.save_caption(file.name, result.caption)
      }
    } catch (error) {
      console.error('Error in batch processing:', error)
      toast.error('Failed to process batch', {
        description: 'An unexpected error occurred'
      })
      throw error // Re-throw to show progress failure
    }
  };

  // Export session to directory
  const handleExport = async () => {
    try {
      // Save any pending changes first
      if (currentImage && editingCaption !== loadedCaption) {
        const saveSuccessful = await handleManualSave()
        if (!saveSuccessful) {
          const confirmExport = window.confirm(
            'Failed to save current caption. Export anyway? Your latest changes might not be included.'
          )
          if (!confirmExport) return
        }
      }

      // Let user select directory using native dialog
      const dirResponse = await window.pyloid.FileAPI.select_directory()
      const dirResult = JSON.parse(dirResponse)
      if (dirResult.error || !dirResult.path) {
        console.error('Error selecting directory:', dirResult.error)
        toast.error('Failed to select directory', {
          description: dirResult.error
        })
        return
      }

      // Export files
      const exportResponse = await window.pyloid.FileAPI.export_session(dirResult.path)
      const exportResult = JSON.parse(exportResponse)
      if (exportResult.error) {
        console.error('Error exporting session:', exportResult.error)
        toast.error('Failed to export session', {
          description: exportResult.error
        })
      } else {
        console.log('Session exported successfully')
        toast.error('Session exported successfully')
      }
    } catch (error) {
      console.error('Error exporting session:', error)
      toast.error('Failed to export session', {
        description: 'An unexpected error occurred'
      })
    }
  }

  const clearSession = async () => {
    try {
      const response = await window.pyloid.FileAPI.clear_session();
      const result = JSON.parse(response);
      if (result.error) {
        console.error('Error clearing session:', result.error);
        toast.error('Failed to clear session', {
          description: result.error
        });
      } else {
        // Clear all state
        setFiles([]);
        setSelectedFiles([]);
        setCurrentImage(null);
        setLoadedCaption('');
        setEditingCaption('');
        setCaptionedFiles([]);
        setUncaptionedFiles([]);
        setViewedCaptions(new Set());  // Also clear viewed captions state

        // Clear the image cache
        imageCache.clear();
        console.log('Cleared image cache');
        
        toast.success('Session cleared successfully');
      }
    } catch (error) {
      console.error('Error clearing session:', error);
      toast.error('Failed to clear session', {
        description: 'An unexpected error occurred'
      });
    }
  }

  useEffect(() => {
    let lastToastTime = 0;
    const TOAST_DEBOUNCE_MS = 1000; // Prevent duplicate toasts within 1 second

    const showToastDebounced = (message: string, type: 'success' | 'error' | 'loading') => {
      const now = Date.now();
      if (now - lastToastTime > TOAST_DEBOUNCE_MS) {
        lastToastTime = now;
        if (loadingToastId.current) {
          toast.dismiss(loadingToastId.current);
          loadingToastId.current = null;
        }
        
        switch (type) {
          case 'success':
            toast.error(message, { duration: 3000 });
            break;
          case 'error':
            toast.error(message, { duration: 3000 });
            break;
          case 'loading':
            loadingToastId.current = toast.loading(message, { duration: 3000 });
            break;
        }
      }
    };

    if (window.pyloid?.EventAPI) {
      console.log('Setting up event listeners');
      window.pyloid.EventAPI.listen('showToast', (data: { message: string, type: 'success' | 'error' | 'loading' }) => {
        showToastDebounced(data.message, data.type);
      });

      window.pyloid.EventAPI.listen('handleCaptionResult', (result: { caption?: string, error?: string }) => {
        if (result.error) {
          showToastDebounced(result.error, 'error');
        } else if (result.caption) {
          // Update the caption text immediately
          setEditingCaption(result.caption);
          setLoadedCaption(result.caption);
          handleCaptionResult(result);
        }
        setGenerating(false);
      });
    }

    return () => {
      if (loadingToastId.current) {
        toast.dismiss(loadingToastId.current);
        loadingToastId.current = null;
      }
    };
  }, []);

  // Handle caption generation result
  const handleCaptionResult = useCallback(async (result: any) => {
    if (result.error) {
      console.error('Error generating caption:', result.error)
      toast.error('Failed to generate caption', {
        description: result.error
      })
      return
    }

    const { caption, image_name } = result
    if (!caption || !image_name) {
      console.error('Invalid caption result:', result)
      return
    }

    // Always update caption state for the current image
    if (currentImage?.name === image_name) {
      setEditingCaption(caption)
      setLoadedCaption(caption)
    }
      
    // Update file metadata in all lists
    const updateFileInList = (list: FileInfo[]) => 
      list.map(f => f.name === image_name ? { ...f, hasCaption: true } : f)
    
    setFiles(prev => updateFileInList(prev))
    setCaptionedFiles(prev => updateFileInList(prev))
    setUncaptionedFiles(prev => prev.filter(f => f.name !== image_name))
    
    if (currentImage?.name === image_name) {
      setCurrentImage(prev => prev ? { ...prev, hasCaption: true } : prev)
    }

  }, [currentImage])

  const handleSettingsChange = async (newSettings: Settings) => {
    setSettings(newSettings);
    // Save each setting to backend
    try {
      for (const [key, value] of Object.entries(newSettings)) {
        const response = await window.pyloid.FileAPI.save_setting(key, JSON.stringify(value));
        const result = JSON.parse(response);
        if (result.error) {
          console.error(`Error saving setting ${key}:`, result.error);
          toast.error(`Failed to save setting ${key}`, {
            description: result.error
          })
        }
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings', {
        description: 'An unexpected error occurred'
      })
    }
  };

  const handleContinueManually = useCallback(() => {
    setNoApiKeyOpen(false);
    generateCaption();
  }, []);

  const handleOpenSettings = useCallback(() => {
    setNoApiKeyOpen(false);
    setSettingsOpen(true);
  }, []);

  const { uncaptionedSection, captionedSection, viewedSection } = useMemo(() => {
    if (!settings) {
      return {
        uncaptionedSection: { title: "Uncaptioned", files: [] as FileInfo[] },
        captionedSection: { title: "Captioned", files: [] as FileInfo[] },
        viewedSection: null as { title: string, files: FileInfo[] } | null
      };
    }

    const uncaptioned = uncaptionedFiles;
    let captioned = captionedFiles;
    let viewed: FileInfo[] = [];

    if (settings.interface.separateViewed) {
      viewed = captionedFiles.filter(f => viewedCaptions.has(f.name));
      captioned = captionedFiles.filter(f => !viewedCaptions.has(f.name));
    }

    return {
      uncaptionedSection: {
        title: "Uncaptioned",
        files: uncaptioned,
      },
      captionedSection: {
        title: settings.interface.separateViewed ? "Captioned (Unviewed)" : "Captioned",
        files: captioned,
      },
      viewedSection: settings.interface.separateViewed ? {
        title: "Reviewed",
        files: viewed,
      } : null,
    };
  }, [uncaptionedFiles, captionedFiles, viewedCaptions, settings?.interface?.separateViewed]);

  useEffect(() => {
    if (addingFiles) {
      const interval = setInterval(async () => {
        const response = await window.pyloid.FileAPI.get_import_progress();
        const data = JSON.parse(response);
        
        if (data.complete) {
          setAddingFiles(false);
          setImportProgress(0);
          // Process the imported files
          if (data.files && data.files.length > 0) {
            // Refresh the file list
            const filesResponse = await window.pyloid.FileAPI.list_session_files();
            const { files, error } = JSON.parse(filesResponse);
            if (error) {
              console.error('Error refreshing files:', error);
              toast.error('Failed to refresh files', {
                description: error
              })
            } else if (files) {
              console.log('File list updated:', files);
              setFiles(files);
              setSelectedFiles([]);
            }
          }
        } else {
          setImportProgress(data.progress);
        }
      }, 100);

      return () => clearInterval(interval);
    }
  }, [addingFiles]);

  const LoadingOverlay = () => (
    <div className="fixed bottom-4 right-4 bg-neutral-800 rounded-lg p-4 shadow-lg flex items-center space-x-3">
      <div className="flex flex-col space-y-2">
        <div className="text-sm text-neutral-300">Importing files...</div>
        <div className="w-48 h-2 bg-neutral-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-500 transition-all duration-300 ease-out"
            style={{ width: `${importProgress}%` }}
          />
        </div>
        <div className="text-xs text-neutral-400 text-right">{importProgress}%</div>
      </div>
    </div>
  );

  if (settings === null) {
    return (
      <div className="h-screen w-screen bg-neutral-900 text-white flex items-center justify-center">
        <div className="flex flex-col items-center space-y-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm text-neutral-400">Loading settings...</span>
        </div>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="h-screen w-screen bg-neutral-900 text-white flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4 max-w-sm w-full px-6">
          <div className="flex items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm text-neutral-400">Initializing session...</span>
          </div>
          
          {restoringFiles && (
            <div className="w-full space-y-2">
              <div className="flex justify-between text-sm text-neutral-400">
                <span>Restoring files...</span>
                <span>{Math.floor((restoringFiles.count / restoringFiles.total) * 100)}%</span>
              </div>
              
              {/* Progress bar background */}
              <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                {/* Animated progress bar */}
                <div 
                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                  style={{ 
                    width: `${(restoringFiles.count / restoringFiles.total) * 100}%`,
                    background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
                  }} 
                />
              </div>

              {/* Optional: Show current file being processed */}
              <div className="text-xs text-neutral-500 truncate">
                {restoringFiles.current}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-neutral-900 text-white overflow-hidden flex flex-col">
      {(addingFiles || isInitializing) && <LoadingOverlay />}

      {/* Header */}
      <div className="border-b border-neutral-800 p-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">spacecat sage</span>
          <a
            href="https://github.com/markuryy/spacecat-sage"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-full border border-black/5 bg-neutral-100 text-xs text-white transition-all ease-in hover:cursor-pointer hover:bg-neutral-200 dark:border-white/5 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            <AnimatedShinyText className="inline-flex items-center justify-center px-2 py-0.5 transition ease-out hover:text-neutral-600 hover:duration-300 hover:dark:text-neutral-400">
              <IconBrandGithub className="size-3 mr-1" />
              <span>alpha</span>
            </AnimatedShinyText>
          </a>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="p-2 hover:bg-neutral-800 rounded-md text-neutral-400 hover:text-neutral-300"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Settings</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="p-2 hover:bg-neutral-800 rounded-md text-neutral-400 hover:text-neutral-300"
                  onClick={clearSession}
                >
                  <Trash2 size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Clear All</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-sm font-medium text-neutral-200"
                  onClick={handleExport}
                >
                  <FolderUp size={14} />
                  <span>Export</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Export dataset to new folder</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <div className="w-72 border-r border-neutral-800 flex flex-col">
          <div className="p-3 border-b border-neutral-800 space-y-3">
            <div className="flex flex-col gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleAddFiles}
                      className="w-full py-5 border border-neutral-700 border-dashed rounded flex items-center justify-center gap-2 text-neutral-400 hover:bg-neutral-800/50 cursor-pointer"
                    >
                      <FolderInput className="w-4 h-4" />
                      <span className="text-sm font-medium">import folder</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Import from Folder</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* File lists */}
          <div className="flex-1 overflow-y-auto">
            <FileListSection
              title="Uncaptioned"
              files={uncaptionedSection.files}
              selectedFiles={selectedFiles}
              onFileSelect={(file, checked) => {
                setSelectedFiles((prev) =>
                  checked
                    ? [...prev, file.name]
                    : prev.filter((f) => f !== file.name)
                );
              }}
              onSelectionChange={(files, checked) => {
                setSelectedFiles((prev) =>
                  checked
                    ? [...new Set([...prev, ...files.map((f) => f.name)])]
                    : prev.filter(
                        (f) => !files.map((uf) => uf.name).includes(f)
                      )
                );
              }}
              currentImage={currentImage}
              onImageSelect={handleImageSelect}
              defaultOpen={true}
            />
            <FileListSection
              title={
                settings.interface.separateViewed
                  ? "Captioned (Unviewed)"
                  : "Captioned"
              }
              files={captionedSection.files}
              selectedFiles={selectedFiles}
              onFileSelect={(file, checked) => {
                setSelectedFiles((prev) =>
                  checked
                    ? [...prev, file.name]
                    : prev.filter((f) => f !== file.name)
                );
              }}
              onSelectionChange={(files, checked) => {
                setSelectedFiles((prev) =>
                  checked
                    ? [...new Set([...prev, ...files.map((f) => f.name)])]
                    : prev.filter(
                        (f) => !files.map((cf) => cf.name).includes(f)
                      )
                );
              }}
              currentImage={currentImage}
              onImageSelect={handleImageSelect}
              viewedCaptions={viewedCaptions}
            />
            {viewedSection && (
              <FileListSection
                title="Reviewed"
                files={viewedSection.files}
                selectedFiles={selectedFiles}
                onFileSelect={(file, checked) => {
                  setSelectedFiles((prev) =>
                    checked
                      ? [...prev, file.name]
                      : prev.filter((f) => f !== file.name)
                  );
                }}
                onSelectionChange={(files, checked) => {
                  setSelectedFiles((prev) =>
                    checked
                      ? [...new Set([...prev, ...files.map((f) => f.name)])]
                      : prev.filter(
                          (f) => !files.map((vf) => vf.name).includes(f)
                        )
                  );
                }}
                currentImage={currentImage}
                onImageSelect={handleImageSelect}
                viewedCaptions={viewedCaptions}
                isLastSection={true}
              />
            )}
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 p-6 flex flex-col items-center justify-center">
          {currentImage ? (
            <>
              <div className="flex-1 min-h-0 flex flex-col items-center max-w-[600px] w-full">
                <div className="w-full aspect-square bg-neutral-800 rounded-lg overflow-hidden mb-4 relative">
                  <img 
                    src={getCachedImageUrl(currentImage.path) || currentImage.path}
                    alt={currentImage.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex justify-center items-center gap-2 mb-4">
                  <button
                    className="p-1.5 rounded hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      const index = files.findIndex(
                        (f) => f.name === currentImage.name
                      );
                      if (index > 0) {
                        setCurrentImage(files[index - 1]);
                      }
                    }}
                    disabled={generating}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm min-w-[4rem] text-center">
                    {files.findIndex((f) => f.name === currentImage.name) + 1} /{" "}
                    {files.length}
                  </span>
                  <button
                    className="p-1.5 rounded hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      const index = files.findIndex(
                        (f) => f.name === currentImage.name
                      );
                      if (index < files.length - 1) {
                        setCurrentImage(files[index + 1]);
                      }
                    }}
                    disabled={generating}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="w-full space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono truncate max-w-[60%] flex">
                      {(() => {
                        const name = currentImage.name;
                        const lastDotIndex = name.lastIndexOf(".");
                        if (lastDotIndex === -1) return name;

                        const nameWithoutExt = name.slice(0, lastDotIndex);
                        const ext = name.slice(lastDotIndex);

                        if (nameWithoutExt.length <= 20) return name;

                        const start = nameWithoutExt.slice(0, 12);
                        const end = nameWithoutExt.slice(-5);
                        return `${start}...${end}${ext}`;
                      })()}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="p-1.5 hover:bg-neutral-800 rounded"
                              onClick={() => setEditingCaption(loadedCaption)}
                              disabled={generating}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Reset to saved caption</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {generating ? (
                        <button
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs font-medium flex items-center gap-2"
                          onClick={cancelGeneration}
                        >
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Cancel Generation</span>
                        </button>
                      ) : (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium flex items-center gap-2 min-w-[100px] whitespace-nowrap"
                                onClick={handleGenerateClick}
                                disabled={generating}
                              >
                                <Wand2 className="w-3 h-3 flex-shrink-0" />
                                <span className="flex-1">
                                  Generate
                                  {selectedFiles.length > 0
                                    ? ` (${selectedFiles.length})`
                                    : ""}
                                </span>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Generate caption for current image</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {/* NEW BUTTON TO OPEN EDITOR */}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-xs font-medium flex items-center gap-2"
                              onClick={() => setEditorOpen(true)}
                              disabled={generating}
                            >
                              <Crop className="w-4 h-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Open image editor</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>

                  <textarea
                    className="w-full h-24 bg-neutral-800 rounded p-3 text-sm resize-none"
                    placeholder="Image caption will appear here..."
                    value={editingCaption}
                    onChange={(e) => handleCaptionChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.shiftKey) {
                        e.preventDefault();
                        handleManualSave();
                      }
                    }}
                  />

                  <div className="flex items-center justify-between text-xs text-neutral-400">
                    <span>Press Shift + Enter to save</span>
                    <span>{editingCaption.length}/500</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-neutral-400">
              No image selected
            </div>
          )}
        </div>
      </div>

      <BatchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onProcess={handleBatchProcess}
        selectedFiles={files.filter((file) =>
          selectedFiles.includes(file.name)
        )}
      />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSettingsChange={handleSettingsChange}
        initialSettings={settings}
      />

      <NoApiKeyDialog
        open={noApiKeyOpen}
        onOpenChange={setNoApiKeyOpen}
        onContinueManually={handleContinueManually}
        onOpenSettings={handleOpenSettings}
      />

      {/* IMAGE EDITOR MODAL */}
      {currentImage && editorOpen && (
        <ImageEditorModal
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          src={imageCache.get(currentImage.path) || currentImage.path}
          onSave={handleSaveEditedImage}
        />
      )}

      <Toaster />
    </div>
  );
};

export default App;
