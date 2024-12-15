import React, { useEffect, useRef, useState } from 'react';
import { Cropper, CropperRef } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import 'react-advanced-cropper/dist/themes/corners.css';
import { RotateCcw, RefreshCw, FlipHorizontal, FlipVertical, Check, X, Lock, Unlock } from 'lucide-react';

interface ImageEditorModalProps {
  open: boolean;
  onClose: () => void;
  src: string;
  onSave: (dataUrl: string) => void;
}

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({ open, onClose, src, onSave }) => {
  const cropperRef = useRef<CropperRef>(null);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspectLocked, setAspectLocked] = useState(false);

  useEffect(() => {
    if (!open) {
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    if (cropperRef.current) {
      const canvas = cropperRef.current.getCanvas();
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Apply rotation and flips after cropping if needed
          const finalCanvas = document.createElement('canvas');
          const { width, height } = canvas;
          finalCanvas.width = width;
          finalCanvas.height = height;
          const finalCtx = finalCanvas.getContext('2d');
          if (finalCtx) {
            finalCtx.translate(width / 2, height / 2);
            finalCtx.rotate((rotation * Math.PI) / 180);
            finalCtx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
            finalCtx.drawImage(canvas, -width / 2, -height / 2);
          }
          onSave(finalCanvas.toDataURL());
        }
      }
    }
    onClose();
  };

  const handleReset = () => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    // Reset cropper
    if (cropperRef.current) {
      cropperRef.current.reset();
    }
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleFlipH = () => {
    setFlipH((prev) => !prev);
  };

  const handleFlipV = () => {
    setFlipV((prev) => !prev);
  };

  const toggleAspectLock = () => {
    setAspectLocked(!aspectLocked);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-neutral-900 p-4 rounded-md max-w-xl w-full flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white text-sm font-medium">Image Editor</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200">
            <X size={16} />
          </button>
        </div>
        <div className="relative w-full h-96 bg-neutral-800 rounded overflow-hidden">
          <Cropper
            ref={cropperRef}
            src={src}
            className="w-full h-full"
            stencilProps={{
              aspectRatio: aspectLocked ? 1 : undefined,
              theme: 'corners',
              movable: true,
              resizable: true,
            }}
            style={{
              transform: `
                rotate(${rotation}deg)
                scaleX(${flipH ? -1 : 1})
                scaleY(${flipV ? -1 : 1})
              `,
              transition: 'transform 0.2s ease',
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={handleReset} className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-white flex items-center gap-1">
              <RefreshCw size={14} />
              Reset
            </button>
            <button onClick={handleRotate} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded text-white">
              <RotateCcw size={16} />
            </button>
            <button onClick={handleFlipH} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded text-white">
              <FlipHorizontal size={16} />
            </button>
            <button onClick={handleFlipV} className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded text-white">
              <FlipVertical size={16} />
            </button>
            <button 
              onClick={toggleAspectLock} 
              className={`p-2 rounded text-white ${aspectLocked ? 'bg-blue-600 hover:bg-blue-700' : 'bg-neutral-800 hover:bg-neutral-700'}`}
            >
              {aspectLocked ? <Lock size={16} /> : <Unlock size={16} />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm text-white flex items-center gap-1">
              <X size={14} />
              Cancel
            </button>
            <button onClick={handleSave} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm text-white flex items-center gap-1">
              <Check size={14} />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageEditorModal;
