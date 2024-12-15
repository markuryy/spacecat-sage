import { BotOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface NoApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onContinueManually: () => void
  onOpenSettings: () => void
}

export function NoApiKeyDialog({
  open,
  onOpenChange,
  onContinueManually,
  onOpenSettings,
}: NoApiKeyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-neutral-900 text-neutral-100 border-neutral-800">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center mb-4">
            <BotOff className="w-6 h-6 text-neutral-400" />
          </div>
          <DialogTitle className="text-xl text-center">Oops! You killed all the robots</DialogTitle>
          <DialogDescription className="text-center text-neutral-400">
            <p className="mb-2">Enter API key or continue captioning images manually</p>
            <p className="text-sm text-neutral-500 italic">Local model support is in the works for non-Linux users</p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={onContinueManually}
            className="w-full sm:w-auto text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800"
          >
            Continue Manually
          </Button>
          <Button
            onClick={onOpenSettings}
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white"
          >
            Enter API Key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
