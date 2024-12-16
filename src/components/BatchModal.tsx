import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { FileInfo } from '../types/caption'

interface BatchModalProps {
  open: boolean
  onClose: () => void
  selectedFiles: FileInfo[]
}

interface BatchProgress {
  current: number
  total: number
  processing: string
}

interface BatchResult {
  type: 'batch_complete' | 'batch_cancelled'
  results: Array<{
    caption?: string
    error?: string
    image_name: string
    status?: string
  }>
}

export function BatchModal({ open, onClose, selectedFiles }: BatchModalProps) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [results, setResults] = useState<{
    processed: string[]
    failed: Record<string, string>
  }>({
    processed: [],
    failed: {}
  })

  useEffect(() => {
    if (open) {
      // Reset state when modal opens
      setRunning(false)
      setProgress(null)
      setResults({
        processed: [],
        failed: {}
      })

      // Set up event listeners
      const handleProgress = (data: BatchProgress) => {
        // Immediately update progress state when we receive an update
        setProgress(data)
      }

      const handleResult = (data: BatchResult) => {
        if (data.type === 'batch_complete') {
          const processed: string[] = []
          const failed: Record<string, string> = {}

          data.results.forEach(result => {
            if (result.caption && result.image_name) {
              processed.push(result.image_name)
            } else if (result.error && result.image_name) {
              failed[result.image_name] = result.error
            }
          })

          setResults({ processed, failed })
          setRunning(false)
          setProgress(null) // Reset progress when complete
          
          // Auto close after delay if we processed anything
          if (processed.length > 0 || Object.keys(failed).length > 0) {
            setTimeout(onClose, 1500)
          }
        } else if (data.type === 'batch_cancelled') {
          setRunning(false)
          setProgress(null)
        }
      }

      window.pyloid.EventAPI.listen('batchProgress', handleProgress)
      window.pyloid.EventAPI.listen('batchResult', handleResult)

      return () => {
        window.pyloid.EventAPI.unlisten('batchProgress')
        window.pyloid.EventAPI.unlisten('batchResult')
      }
    }
  }, [open, onClose])

  const startProcessing = async () => {
    try {
      setRunning(true)
      // Send all files to be processed as a batch
      const response = await window.pyloid.FileAPI.generate_batch_captions(
        JSON.stringify(selectedFiles.map(f => f.name))
      )
      const result = JSON.parse(response)
      
      if (result.error) {
        setResults(prev => ({
          ...prev,
          failed: { 'batch': result.error }
        }))
        setRunning(false)
      }
    } catch (error) {
      console.error('Failed to start batch processing:', error)
      setResults(prev => ({
        ...prev,
        failed: { 'batch': error instanceof Error ? error.message : String(error) }
      }))
      setRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen && !running) {
        onClose()
      }
    }}>
      <DialogContent className="bg-neutral-900 border-neutral-800 text-white sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Batch Caption Images</DialogTitle>
          <DialogDescription className="text-neutral-400">
            Processing {selectedFiles.length} images using your current settings
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {(running || progress || results.processed.length > 0) ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-neutral-300">
                  <span>{!running ? 'Completed' : 'Progress'}</span>
                  <span>
                    {progress ? `${progress.current}/${progress.total}` : 
                     `${results.processed.length}/${selectedFiles.length}`}
                  </span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full transition-all duration-300 ${
                      !running ? 'bg-green-600' : 'bg-blue-600'
                    }`}
                    style={{ 
                      width: `${progress ? 
                        (progress.current / progress.total * 100) : 
                        (results.processed.length / selectedFiles.length * 100)}%` 
                    }}
                  />
                </div>
              </div>
              
              {progress?.processing && running && (
                <div className="text-sm text-neutral-400">
                  Currently processing: {progress.processing}
                </div>
              )}
              
              {Object.keys(results.failed).length > 0 && (
                <div className="text-sm text-red-400 space-y-1">
                  <div>Failed to process:</div>
                  {Object.entries(results.failed).map(([filename, error]) => (
                    <div key={filename} className="pl-2 text-xs">
                      • {filename}: {error}
                    </div>
                  ))}
                </div>
              )}
              
              {!running && results.processed.length > 0 && (
                <div className="text-sm text-green-400">
                  Successfully processed {results.processed.length} images!
                  {Object.keys(results.failed).length > 0 && 
                    ` (${Object.keys(results.failed).length} failed)`}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-neutral-400">
              Ready to process {selectedFiles.length} images
            </div>
          )}
          
          <button 
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={startProcessing}
            disabled={running || results.processed.length > 0}
          >
            {running ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </div>
            ) : results.processed.length > 0 ? (
              'Completed!'
            ) : (
              'Start Processing'
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}