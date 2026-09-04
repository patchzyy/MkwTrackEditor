import { Boxes, ChevronDown, Clock, Download, FileUp, FolderOpen, Package } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../components/Button';
import { MenuSurface, type MenuSection } from '../components/Menu';
import type { RecentTrack } from './recentFiles';

/**
 * The File menu. Hidden `<input type="file">` elements do the actual picking; the menu items
 * just click them, which keeps the browser's "user gesture" requirement satisfied.
 */
export function FileMenu({
  canExport,
  recentTracks,
  onOpenFiles,
  onImportCommonArchive,
  onExport,
  onOpenRecent,
  onClearRecent,
  onOpenModelInStudio,
}: {
  canExport: boolean;
  recentTracks: RecentTrack[];
  onOpenFiles: (files: FileList | null) => void;
  onImportCommonArchive: (files: FileList | null) => void;
  onExport: () => void;
  onOpenRecent: (entry: RecentTrack) => void;
  onClearRecent: () => void;
  /** Opens one `.brres` / `.szs` / `.u8` model archive in the Model Studio. */
  onOpenModelInStudio?: (files: FileList | null) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const trackInputRef = useRef<HTMLInputElement | null>(null);
  const commonInputRef = useRef<HTMLInputElement | null>(null);
  const studioInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);

  const rect = open ? triggerRef.current?.getBoundingClientRect() : undefined;

  const sections: MenuSection[] = [
    {
      id: 'open',
      items: [
        {
          id: 'open-track',
          label: 'Open track…',
          icon: <FolderOpen size={15} />,
          shortcut: 'Ctrl+O',
          onSelect: () => trackInputRef.current?.click(),
        },
        {
          id: 'import-common',
          label: 'Import Common.szs…',
          icon: <Package size={15} />,
          onSelect: () => commonInputRef.current?.click(),
        },
        ...(onOpenModelInStudio
          ? [
              {
                id: 'open-model-studio',
                label: 'Open model in Studio…',
                icon: <Boxes size={15} />,
                onSelect: () => studioInputRef.current?.click(),
              },
            ]
          : []),
        {
          id: 'export',
          label: 'Export track…',
          icon: <Download size={15} />,
          shortcut: 'Ctrl+S',
          disabled: !canExport,
          disabledReason: 'No track loaded',
          onSelect: onExport,
        },
      ],
    },
    {
      id: 'recent',
      title: 'Recent tracks',
      items:
        recentTracks.length === 0
          ? [{ id: 'recent-empty', label: 'Nothing opened yet', icon: <Clock size={15} />, disabled: true }]
          : [
              ...recentTracks.map((entry, index) => ({
                id: `recent-${index}-${entry.name}`,
                label: entry.name,
                icon: <FileUp size={15} />,
                disabled: !entry.url,
                disabledReason: entry.url ? undefined : 'Pick this file again to reopen it',
                onSelect: () => onOpenRecent(entry),
              })),
              { id: 'recent-clear', label: 'Clear recent list', icon: <Clock size={15} />, onSelect: onClearRecent },
            ],
    },
  ];

  return (
    <>
      <Button
        ref={triggerRef}
        icon={<FolderOpen size={15} />}
        active={open}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        File
        <ChevronDown size={13} className="uiButtonChevron" />
      </Button>
      {open && rect && (
        <MenuSurface
          label="File"
          anchor={{ top: rect.top, left: rect.left, bottom: rect.bottom + 4, right: rect.right }}
          sections={sections}
          onClose={() => setOpen(false)}
          minWidth={252}
        />
      )}
      <input
        ref={trackInputRef}
        hidden
        type="file"
        accept=".szs"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          onOpenFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={commonInputRef}
        hidden
        type="file"
        accept=".szs"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          onImportCommonArchive(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={studioInputRef}
        hidden
        type="file"
        accept=".brres,.szs,.u8"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          onOpenModelInStudio?.(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}
