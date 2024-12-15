import { useState, useEffect, useCallback, useRef } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Check, Loader2 } from 'lucide-react'
import { CAPTION_TYPES, CAPTION_LENGTHS, JOYCAPTION_EXTRA_OPTIONS, MODEL_TYPES, USE_CUSTOM_NAME } from './constants'
import debounce from 'lodash.debounce'
import { toast } from 'sonner'

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

type NestedSettingsKey = string

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSettingsChange?: (newSettings: Settings) => void
  initialSettings?: Settings
}

const DEFAULT_SETTINGS: Settings = {
  modelType: 'openai',
  openai: {
    apiKey: null,
    model: 'gpt-4o'
  },
  joycaption: {
    apiKey: null,
    baseUrl: null,
    model: 'llama-joycaption-alpha-two-hf-llava'
  },
  prompts: {
    captionType: 'Custom/VQA',
    captionLength: 'long',
    customPrompt: 'Write a descriptive caption for this image.',
    extraOptions: [],
    customName: ''
  },
  interface: {
    separateViewed: false
  }
}

export function SettingsModal({ open, onOpenChange, onSettingsChange, initialSettings }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings || DEFAULT_SETTINGS)
  const [activeSection, setActiveSection] = useState<'model' | 'prompts' | 'interface'>('model')
  const [saveIndicator, setSaveIndicator] = useState<'saving' | 'saved' | null>(null)
  const debouncedSaveRef = useRef<ReturnType<typeof debounce>>();

  const debouncedSave = useCallback(
    debounce(async (key: string, value: any, newSettings: Settings) => {
      try {
        setSaveIndicator('saving')

        const response = await window.pyloid.FileAPI.save_setting(key, JSON.stringify(value))
        const result = JSON.parse(response) as { error?: string }
        
        if (result.error) {
          throw new Error(result.error)
        }

        onSettingsChange?.(newSettings)
        setSaveIndicator('saved')
        setTimeout(() => setSaveIndicator(null), 2000)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setSaveIndicator(null)
        toast.error('Failed to save settings', {
          description: errorMessage,
        })
      }
    }, 500),
    [onSettingsChange]
  )

  useEffect(() => {
    return () => {
      debouncedSaveRef.current?.cancel()
    }
  }, [])

  const updateSetting = async (key: NestedSettingsKey, value: any) => {
    try {
      const newSettings = { ...settings }
      const parts = key.split('.')
      let current = newSettings
      
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i] as keyof typeof current
        if (!(part in current)) {
          current[part] = {} as any
        }
        current = current[part] as any
      }
      
      const lastPart = parts[parts.length - 1] as keyof typeof current
      current[lastPart] = value

      setSettings(newSettings)
      
      debouncedSaveRef.current?.cancel()
      debouncedSaveRef.current = debouncedSave
      debouncedSave(key, value, newSettings)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update setting';
      toast.error('Failed to update settings', {
        description: errorMessage,
      })
    }
  }

  const handleDialogClick = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  useEffect(() => {
    const loadSettings = async () => {
      if (!open) return
      if (initialSettings) {
        setSettings(initialSettings)
        return
      }
      try {
        const response = await window.pyloid.FileAPI.get_settings()
        const loadedSettings = JSON.parse(response)
        if (loadedSettings && typeof loadedSettings === 'object') {
          setSettings({
            ...DEFAULT_SETTINGS,
            ...loadedSettings,
            openai: {
              ...DEFAULT_SETTINGS.openai,
              ...(loadedSettings.openai || {})
            },
            joycaption: {
              ...DEFAULT_SETTINGS.joycaption,
              ...(loadedSettings.joycaption || {})
            },
            prompts: {
              ...DEFAULT_SETTINGS.prompts,
              ...(loadedSettings.prompts || {})
            },
            interface: {
              ...DEFAULT_SETTINGS.interface,
              ...(loadedSettings.interface || {})
            }
          })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load settings';
        toast.error('Failed to load settings', {
          description: errorMessage,
        })
      }
    }
    loadSettings()
  }, [open, initialSettings])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="bg-neutral-900 text-neutral-100 p-0 gap-0 max-w-2xl outline-none focus:outline-none" 
        aria-describedby="settings-modal-description"
        onClick={handleDialogClick}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription id="settings-modal-description" className="sr-only">
          Configure application settings including model selection, API keys, and caption preferences
        </DialogDescription>

        <div className="flex h-[80vh] relative">
          {/* Sidebar */}
          <div className="w-48 border-r border-neutral-800 p-4 space-y-2">
            <button
              onClick={() => setActiveSection('model')}
              className={`w-full text-left px-3 py-2 rounded-md focus:outline-none ${
                activeSection === 'model'
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-400 hover:bg-neutral-800/50'
              }`}
            >
              Model & API
            </button>
            <button
              onClick={() => setActiveSection('prompts')}
              className={`w-full text-left px-3 py-2 rounded-md focus:outline-none ${
                activeSection === 'prompts'
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-400 hover:bg-neutral-800/50'
              }`}
            >
              Prompts
            </button>
            <button
              onClick={() => setActiveSection('interface')}
              className={`w-full text-left px-3 py-2 rounded-md focus:outline-none ${
                activeSection === 'interface'
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-400 hover:bg-neutral-800/50'
              }`}
            >
              Interface
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="space-y-6 max-w-xl mx-auto">
              {/* Section Headers */}
              <div className="mb-6">
                <h2 className="text-xl font-medium">
                  {activeSection === 'model' && 'Model & API Settings'}
                  {activeSection === 'prompts' && 'Caption Prompts'}
                  {activeSection === 'interface' && 'Interface Settings'}
                </h2>
                <p className="text-sm text-neutral-400 mt-1">
                  {activeSection === 'model' && 'Configure your AI model and API settings'}
                  {activeSection === 'prompts' && 'Customize your captioning preferences'}
                  {activeSection === 'interface' && 'Adjust your interface preferences'}
                </p>
              </div>

              {activeSection === 'model' && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-neutral-300">Model Type</Label>
                    <Select
                      value={settings.modelType}
                      onValueChange={(value) => updateSetting('modelType', value)}
                    >
                      <SelectTrigger className="bg-neutral-800 border-neutral-700 text-neutral-100">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(MODEL_TYPES).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {settings.modelType === 'openai' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-neutral-300">OpenAI API Key</Label>
                        <Input
                          type="password"
                          value={settings.openai.apiKey || ''}
                          onCompositionStart={(e) => e.preventDefault()}
                          onCompositionEnd={(e) => e.preventDefault()}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const value = e.target.value;
                            updateSetting('openai.apiKey', value);
                          }}
                          className="bg-neutral-800 border-neutral-700 text-neutral-100"
                          placeholder='sk-...'
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-neutral-300">Model</Label>
                        <Input
                          value={settings.openai.model}
                          onCompositionStart={(e) => e.preventDefault()}
                          onCompositionEnd={(e) => e.preventDefault()}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const value = e.target.value;
                            updateSetting('openai.model', value);
                          }}
                          className="bg-neutral-800 border-neutral-700 text-neutral-100"
                          placeholder="e.g., gpt-4o"
                        />
                      </div>
                    </>
                  )}

                  {settings.modelType === 'joycaption-api' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-neutral-300">Base URL (Required)</Label>
                        <Input
                          value={settings.joycaption.baseUrl || ''}
                          onCompositionStart={(e) => e.preventDefault()}
                          onCompositionEnd={(e) => e.preventDefault()}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const value = e.target.value;
                            updateSetting('joycaption.baseUrl', value);
                          }}
                          className="bg-neutral-800 border-neutral-700 text-neutral-100"
                          placeholder="e.g., https://api.runpod.ai/v2/your-endpoint-id/openai/v1"
                        />
                        <p className="text-sm text-neutral-400 selectable-text">
                          The expected format for RunPod Serverless instances of vLLM is https://api.runpod.ai/v2/your_endpoint_id/openai/v1
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-neutral-300">API Key</Label>
                        <Input
                          type="password"
                          value={settings.joycaption.apiKey || ''}
                          onCompositionStart={(e) => e.preventDefault()}
                          onCompositionEnd={(e) => e.preventDefault()}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const value = e.target.value;
                            updateSetting('joycaption.apiKey', value);
                          }}
                          className="bg-neutral-800 border-neutral-700 text-neutral-100"
                          placeholder='rpa_...'
                        />
                        <p className="text-sm text-neutral-400">
                          Optional: Only required for some API endpoints
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-neutral-300">Model Name (Required)</Label>
                        <Input
                          value={settings.joycaption.model}
                          onCompositionStart={(e) => e.preventDefault()}
                          onCompositionEnd={(e) => e.preventDefault()}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const value = e.target.value;
                            updateSetting('joycaption.model', value);
                          }}
                          className="bg-neutral-800 border-neutral-700 text-neutral-100"
                          placeholder="joycaption-alpha-two"
                        />
                        <p className="text-sm text-neutral-400 selectable-text">
                          fancyfeast/llama-joycaption-alpha-two-hf-llava is recommended
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeSection === 'prompts' && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-neutral-300">Caption Type</Label>
                    <Select
                      value={settings.prompts.captionType}
                      onValueChange={(value) => updateSetting('prompts.captionType', value)}
                    >
                      <SelectTrigger className="bg-neutral-800 border-neutral-700 text-neutral-100">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CAPTION_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {settings.prompts.captionType === 'Custom/VQA' ? (
                    <div className="space-y-2">
                      <Label className="text-neutral-300">Custom Prompt</Label>
                      <textarea
                        value={settings.prompts.customPrompt}
                        onCompositionStart={(e) => e.preventDefault()}
                        onCompositionEnd={(e) => e.preventDefault()}
                        onKeyDown={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const value = e.target.value;
                          updateSetting('prompts.customPrompt', value);
                        }}
                        className="w-full h-32 px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-100 resize-none focus:outline-none focus:ring-2 focus:ring-neutral-600"
                        placeholder="Write a descriptive caption for this image."
                      />
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label className="text-neutral-300">Caption Length</Label>
                        <Select
                          value={settings.prompts.captionLength}
                          onValueChange={(value) => updateSetting('prompts.captionLength', value)}
                        >
                          <SelectTrigger className="bg-neutral-800 border-neutral-700 text-neutral-100">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CAPTION_LENGTHS.map((length) => (
                              <SelectItem key={length} value={length}>
                                {length}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-neutral-300">Extra Options</Label>
                        <div className="space-y-2">
                          {JOYCAPTION_EXTRA_OPTIONS.map((option) => (
                            <div key={option} className="flex items-center space-x-2">
                              <Checkbox
                                checked={settings.prompts.extraOptions.includes(option)}
                                onCheckedChange={(checked) => {
                                  const newOptions = checked
                                    ? [...settings.prompts.extraOptions, option]
                                    : settings.prompts.extraOptions.filter((o) => o !== option)
                                  updateSetting('prompts.extraOptions', newOptions)
                                }}
                                className="bg-neutral-800 border-neutral-700"
                              />
                              <Label className="text-neutral-300 text-sm">{option}</Label>
                            </div>
                          ))}
                        </div>
                      </div>

                      {settings.prompts.extraOptions.includes(USE_CUSTOM_NAME) && (
                        <div className="space-y-2">
                          <Label className="text-neutral-300">Custom Name</Label>
                          <Input
                            value={settings.prompts.customName || ''}
                            onCompositionStart={(e) => e.preventDefault()}
                            onCompositionEnd={(e) => e.preventDefault()}
                            onKeyDown={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const value = e.target.value;
                              updateSetting('prompts.customName', value);
                            }}
                            className="bg-neutral-800 border-neutral-700 text-neutral-100"
                            placeholder="Enter a custom name"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeSection === 'interface' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <Label className="text-neutral-300">Separate Viewed Images</Label>
                    <Switch
                      checked={settings.interface.separateViewed}
                      onCheckedChange={(checked) =>
                        updateSetting('interface.separateViewed', checked)
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Save indicator */}
          <div className="absolute bottom-4 left-4 flex items-center gap-2 text-sm">
            {saveIndicator === 'saving' && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-neutral-400">Saving...</span>
              </>
            )}
            {saveIndicator === 'saved' && (
              <>
                <Check className="w-3 h-3 text-green-500" />
                <span className="text-green-500">Saved</span>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
