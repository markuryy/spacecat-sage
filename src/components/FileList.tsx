import React, { useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ChevronDown, CheckCircle2 } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { imageCache } from '../utils/imageCache';

interface FileInfo {
  name: string;
  path: string;
  size: number;
}

interface ImageThumbnailProps {
  path: string;
  alt: string;
  onClick?: (e: React.MouseEvent) => void;
  onLoad?: (dataUrl: string) => void;
}

const ImageThumbnail: React.FC<ImageThumbnailProps> = React.memo(({ path, alt, onClick, onLoad }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(imageCache.get(path) ?? null);
  const [loading, setLoading] = useState(!dataUrl);
  
  useEffect(() => {
    if (!dataUrl && !imageCache.has(path)) {
      setLoading(true);
      window.pyloid.FileAPI.get_image_data(path)
        .then(response => {
          const result = JSON.parse(response);
          if (result.path) {
            imageCache.set(path, result.path);
            setDataUrl(result.path);
            onLoad?.(result.path);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else if (dataUrl) {
      onLoad?.(dataUrl);
    }
  }, [path, dataUrl, onLoad]);

  if (loading) {
    return (
      <div className="w-full h-full bg-neutral-800 rounded flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
      </div>
    );
  }

  return dataUrl ? (
    <img 
      src={dataUrl}
      alt={alt}
      className="w-full h-full rounded bg-neutral-800 object-cover"
      onClick={onClick}
      loading="lazy"
    />
  ) : null;
});

interface VirtualizedContentProps {
  files: FileInfo[];
  selectedFiles: string[];
  viewedCaptions?: Set<string>;
  onFileSelect: (file: FileInfo, checked: boolean) => void;
  onImageSelect: (file: FileInfo) => void;
}

const VirtualizedContent: React.FC<VirtualizedContentProps> = ({
  files,
  selectedFiles,
  viewedCaptions,
  onFileSelect,
  onImageSelect,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="max-h-[240px] overflow-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const file = files[virtualRow.index];
          return (
            <div
              key={file.name}
              className="absolute top-0 left-0 w-full group border-b last:border-b-0 border-neutral-800/50"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div 
                className="flex items-center gap-3 p-3 hover:bg-neutral-800 cursor-pointer"
                onClick={() => onImageSelect(file)}
              >
                <div className="relative w-12 h-12">
                  <ImageThumbnail 
                    path={file.path}
                    alt={file.name}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="absolute top-0 left-0 p-1">
                    <Checkbox 
                      checked={selectedFiles.includes(file.name)}
                      onCheckedChange={(checked) => {
                        onFileSelect(file, checked as boolean);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-neutral-700/50 border-neutral-600 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                    />
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-sm truncate">{file.name}</div>
                  {viewedCaptions?.has(file.name) && (
                    <div className="flex items-center gap-1 text-xs text-green-500">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Viewed</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface FileListSectionProps {
  title: string;
  files: FileInfo[];
  selectedFiles: string[];
  onFileSelect: (file: FileInfo, checked: boolean) => void;
  onSelectionChange: (files: FileInfo[], checked: boolean) => void;
  currentImage: FileInfo | null;
  onImageSelect: (file: FileInfo) => void;
  viewedCaptions?: Set<string>;
  defaultOpen?: boolean;
  isLastSection?: boolean;
}

const FileListSection: React.FC<FileListSectionProps> = ({
  title,
  files,
  selectedFiles,
  onFileSelect,
  onSelectionChange,
  onImageSelect,
  viewedCaptions,
  defaultOpen = true,
  isLastSection = false,
}) => {
  const allSelected = files.length > 0 && files.every(f => selectedFiles.includes(f.name));

  return (
    <Collapsible defaultOpen={defaultOpen} className={!isLastSection ? "border-b border-neutral-800" : ""}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between w-full py-2 px-3 hover:bg-neutral-800 cursor-pointer">
          <div className="flex items-center gap-3">
            <div onClick={(e) => e.stopPropagation()}>
              <Checkbox 
                checked={allSelected}
                onCheckedChange={(checked) => {
                  onSelectionChange(files, checked as boolean);
                }}
                className="ml-1 bg-neutral-700/50 border-neutral-600 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
              />
            </div>
            <span className="text-xs font-medium text-neutral-400">
              {title} ({files.length})
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-neutral-400 transition-transform duration-200 ease-in-out data-[state=open]:rotate-180" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <VirtualizedContent
          files={files}
          selectedFiles={selectedFiles}
          viewedCaptions={viewedCaptions}
          onFileSelect={onFileSelect}
          onImageSelect={onImageSelect}
        />
      </CollapsibleContent>
    </Collapsible>
  );
};

export default FileListSection;