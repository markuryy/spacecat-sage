import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

interface FileInfo {
  name: string
  path: string
  size: number
}

interface BatchModalProps {
  open: boolean
  onClose: () => void
  onProcess: (file: FileInfo) => Promise<void>
  selectedFiles: FileInfo[]
}

export function BatchModal({ open, onClose, onProcess, selectedFiles }: BatchModalProps) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  
  const startProcessing = async () => {
    setRunning(true)
    setProgress({ done: 0, total: selectedFiles.length, current: '' })
    
    try {
      for (const file of selectedFiles) {
        setProgress(prev => ({ ...prev, current: file.name }))
        await onProcess(file)
        setProgress(prev => ({ ...prev, done: prev.done + 1 }))
      }
    } catch (error) {
      console.error('Processing failed:', error)
    }
    
    setRunning(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-neutral-900 border-neutral-800 text-white sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Batch Caption Images</DialogTitle>
          <DialogDescription className="text-neutral-400">
            Processing {selectedFiles.length} images using your current settings
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {running ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-neutral-300">
                  <span>Progress</span>
                  <span>{progress.done}/{progress.total}</span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
              </div>
              {progress.current && (
                <div className="text-sm text-neutral-400">
                  Currently processing: {progress.current}
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
            disabled={running}
          >
            {running ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </div>
            ) : (
              'Start Processing'
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
