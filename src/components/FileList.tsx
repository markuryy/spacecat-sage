import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ChevronDown, CheckCircle2 } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { imageCache } from '../utils/imageCache';
import { useVirtualizer } from '@tanstack/react-virtual';

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
}, (prevProps, nextProps) => {
  return prevProps.path === nextProps.path && prevProps.alt === nextProps.alt;
});

interface VirtualizedContentProps {
  items: any[];
  renderItem: (item: any) => React.ReactNode;
  itemHeight: number;
}

const VirtualizedContent: React.FC<VirtualizedContentProps> = React.memo(({
  items,
  renderItem,
  itemHeight
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={items[virtualRow.index].name}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderItem(items[virtualRow.index])}
          </div>
        ))}
      </div>
    </div>
  );
});

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

  const renderFileItem = useCallback((file: FileInfo) => (
    <div 
      key={file.name}
      className="h-full w-full group border-b last:border-b-0 border-neutral-800/50"
      onClick={() => onImageSelect(file)}
    >
      <div className="flex items-center gap-3 p-3 h-full hover:bg-neutral-800 cursor-pointer">
        <div className="relative w-12 h-12 flex-shrink-0">
          <ImageThumbnail 
            key={file.path}
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
  ), [selectedFiles, onFileSelect, onImageSelect, viewedCaptions]);

  return (
    <Collapsible 
      defaultOpen={defaultOpen} 
      className={`flex flex-col ${!isLastSection ? "border-b border-neutral-800" : ""}`}
    >
      <CollapsibleTrigger className="w-full flex-shrink-0">
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
      <CollapsibleContent className="flex-1 min-h-0">
        <div className="h-[240px]">
          <VirtualizedContent
            items={files}
            renderItem={renderFileItem}
            itemHeight={72}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default FileListSection;