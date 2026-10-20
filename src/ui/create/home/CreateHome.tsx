import { Copy, Download, Ellipsis, FileUp, FolderOpen, Pencil, Plus, RefreshCw, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '../../components/Button';
import { EmptyState, Skeleton } from '../../components/EmptyState';
import { MenuSurface, type MenuSection } from '../../components/Menu';
import { relativeTime } from '../session/projectFile';
import type { CreateProjectSummary, CreateSession } from '../session/types';
import { themeGradient } from '../kitImages';
import { TrackOutline } from './TrackOutline';

/**
 * The Create home screen: shown instead of the editor while no design is open. One big way to
 * start (New track), one way to bring a design in, and the saved designs to carry on with.
 */
export function CreateHome({ session }: { session: CreateSession }) {
  const { kit, kitError, projects } = session;
  const importRef = useRef<HTMLInputElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CreateProjectSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void session.refreshProjects().finally(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // Once, when the home screen appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = kit !== null;

  return (
    <div className="createMode createHome" data-create-home>
      <div className="createHomeScroll">
        <div className="createHomeInner">
          <header className="createHero">
            <span className="createKicker">
              <Sparkles size={13} /> Create mode
            </span>
            <h1 className="createHeroTitle">Build your own Mario Kart Wii track</h1>
            <p className="createHeroLead">
              Pick a world, draw a road, add boosts, item boxes and scenery, then drive it. The game files are made for you.
            </p>
          </header>

          {kitError && (
            <div className="createNotice createNotice--error" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>Create mode could not start</strong>
                <p>{kitError}</p>
                <p className="createNoticeHint">Check your connection, then try again. Your saved tracks are safe.</p>
              </div>
              <Button icon={<RefreshCw size={14} />} onClick={session.retryKit}>
                Try again
              </Button>
            </div>
          )}

          <section className="createStartRow" aria-label="Start">
            <button
              type="button"
              className="createNewCard"
              onClick={session.openWizard}
              disabled={!!kitError}
              data-create-action="new-track"
            >
              <span className="createNewIcon" aria-hidden="true">
                <Plus size={30} strokeWidth={2.2} />
              </span>
              <span className="createNewText">
                <strong>New track</strong>
                <span>{ready || !kitError ? 'Choose a world and a starting shape. It takes about a minute.' : 'Not available right now.'}</span>
              </span>
              {!ready && !kitError && <span className="createNewBusy">Getting ready...</span>}
            </button>
            <button type="button" className="createImportCard" onClick={() => importRef.current?.click()} data-create-action="import">
              <FileUp size={20} aria-hidden="true" />
              <span className="createImportText">
                <strong>Open a design file</strong>
                <span>Carry on with a track someone sent you (.mkwcreate.json).</span>
              </span>
            </button>
            <input
              ref={importRef}
              hidden
              type="file"
              accept=".json,.mkwcreate.json,application/json"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void session.importProjectFile(file);
              }}
            />
          </section>

          <section className="createContinue" aria-label="Your tracks">
            <div className="createSectionHead">
              <h2>Continue</h2>
              {projects.length > 0 && <span className="createSectionCount">{projects.length}</span>}
            </div>
            {!loaded ? (
              <div className="createGrid" aria-busy="true">
                {[0, 1, 2].map((n) => (
                  <Skeleton key={n} height={206} radius="var(--radius-lg)" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <EmptyState
                icon={<FolderOpen size={22} />}
                title="No tracks yet"
                description="The tracks you build are kept in this browser, so you can pick them up again here."
                size="md"
              />
            ) : (
              <div className="createGrid">
                {projects.map((summary) => (
                  <ProjectCard
                    key={summary.id}
                    summary={summary}
                    session={session}
                    renaming={renaming === summary.id}
                    onStartRename={() => setRenaming(summary.id)}
                    onStopRename={() => setRenaming(null)}
                    onAskDelete={() => setConfirmDelete(summary)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {confirmDelete && (
        <DeleteDialog
          summary={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            void session.deleteProject(id);
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({
  summary,
  session,
  renaming,
  onStartRename,
  onStopRename,
  onAskDelete,
}: {
  summary: CreateProjectSummary;
  session: CreateSession;
  renaming: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  onAskDelete: () => void;
}) {
  const theme = session.kit?.theme(summary.themeId) ?? null;
  const [menu, setMenu] = useState<{ top: number; left: number; bottom: number; right: number } | null>(null);
  const [opening, setOpening] = useState(false);

  const open = () => {
    if (opening || !session.kit) return;
    setOpening(true);
    void session.openProject(summary.id).finally(() => setOpening(false));
  };

  const sections: MenuSection[] = [
    {
      id: 'main',
      items: [
        { id: 'open', label: 'Open', icon: <FolderOpen size={15} />, onSelect: open },
        { id: 'rename', label: 'Rename', icon: <Pencil size={15} />, onSelect: onStartRename },
        { id: 'duplicate', label: 'Duplicate', icon: <Copy size={15} />, onSelect: () => void session.duplicateProject(summary.id) },
        { id: 'export', label: 'Export design file', icon: <Download size={15} />, onSelect: () => session.exportProjectFile(summary.id) },
      ],
    },
    { id: 'danger', items: [{ id: 'delete', label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: onAskDelete }] },
  ];

  return (
    <article className="createCard" data-create-project={summary.id}>
      <button
        type="button"
        className="createCardMain"
        onClick={open}
        disabled={!session.kit || opening}
        aria-label={`Open ${summary.name}`}
        data-create-open
      >
        <span className="createCardThumb" style={{ background: themeGradient(theme?.accent) }}>
          <TrackOutline points={summary.outline} closed={summary.closed} emptyLabel="No road yet" />
        </span>
      </button>
      <div className="createCardBody">
        <div className="createCardTitleRow">
          {renaming ? (
            <RenameField
              initial={summary.name}
              onDone={(name) => {
                onStopRename();
                if (name && name !== summary.name) void session.renameProject(summary.id, name);
              }}
            />
          ) : (
            <strong className="createCardName" title={summary.name}>
              {summary.name}
            </strong>
          )}
          <IconButton
            icon={<Ellipsis size={16} />}
            tooltip="More"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right });
            }}
          />
        </div>
        <div className="createCardMeta">
          <span className="createWorldChip">
            <span className="createWorldDot" style={{ background: themeGradient(theme?.accent) }} aria-hidden="true" />
            {theme?.label ?? (session.kit ? 'Unknown world' : '...')}
          </span>
          <span className="createCardTime">Edited {relativeTime(summary.updatedAt)}</span>
        </div>
      </div>
      {menu && <MenuSurface anchor={menu} sections={sections} label={`${summary.name} actions`} align="end" onClose={() => setMenu(null)} />}
    </article>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="createRenameField"
      value={value}
      maxLength={60}
      aria-label="Track name"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onDone(value.trim() || null);
        if (event.key === 'Escape') onDone(null);
      }}
    />
  );
}

function DeleteDialog({ summary, onCancel, onConfirm }: { summary: CreateProjectSummary; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <div className="createScrim" onPointerDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="createDialog" role="alertdialog" aria-modal="true" aria-labelledby="create-delete-title" aria-describedby="create-delete-text">
        <h2 id="create-delete-title" className="createDialogTitle">
          Delete "{summary.name}"?
        </h2>
        <p id="create-delete-text" className="createDialogText">
          This track will be removed from this browser. If you exported a design file or a track file, those stay where they are.
        </p>
        <div className="createDialogActions">
          <Button ref={cancelRef} onClick={onCancel}>
            Keep it
          </Button>
          <Button variant="danger" icon={<Trash2 size={14} />} onClick={onConfirm} data-create-action="confirm-delete">
            Delete track
          </Button>
        </div>
      </div>
    </div>
  );
}
