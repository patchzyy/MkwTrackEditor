import type { PathLinkSection } from '../Noclip3DViewport';

export interface KmpToolsOverlayProps {
  canCreateRespawns: boolean;
  onCreateRespawns: () => void;
  /** Non-null while the connect-groups gesture is armed for that path type. */
  linkSection: PathLinkSection | null;
  onChangeLinkSection: (section: PathLinkSection | null) => void;
  drawingCheckpoints: boolean;
  onChangeDrawingCheckpoints: (drawing: boolean) => void;
  pathGroupColors: boolean;
  onChangePathGroupColors: (value: boolean) => void;
  checkpointQuads: boolean;
  onChangeCheckpointQuads: (value: boolean) => void;
}

const LINK_SECTIONS: Array<{ key: PathLinkSection; label: string }> = [
  { key: 'ENPT', label: 'Enemy' },
  { key: 'ITPT', label: 'Item' },
  { key: 'CKPT', label: 'Checkpoint' },
];

/**
 * Viewport HUD for the two KMP gestures that change what a left-drag does, plus the two
 * overlay switches that make paths readable. Everything else is a click on an existing handle,
 * so it needs no mode.
 */
export function KmpToolsOverlay({
  canCreateRespawns,
  onCreateRespawns,
  linkSection,
  onChangeLinkSection,
  drawingCheckpoints,
  onChangeDrawingCheckpoints,
  pathGroupColors,
  onChangePathGroupColors,
  checkpointQuads,
  onChangeCheckpointQuads,
}: KmpToolsOverlayProps) {
  return (
    <div className="viewportOverlayPanel kmpToolsOverlay">
      <div className="viewportOverlayHeader">
        <strong>Track tools</strong>
      </div>

      <div className="kmpToolsRow">
        <span className="kmpToolsLabel">Connect groups</span>
        <div className="kmpToolsButtons">
          {LINK_SECTIONS.map((section) => (
            <button
              key={section.key}
              type="button"
              className={`button${linkSection === section.key ? ' isActive' : ''}`}
              aria-pressed={linkSection === section.key}
              title={`Show the ${section.label.toLowerCase()} group ends and drag one onto another group to connect or disconnect them`}
              onClick={() => onChangeLinkSection(linkSection === section.key ? null : section.key)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kmpToolsRow">
        <span className="kmpToolsLabel">Draw</span>
        <div className="kmpToolsButtons">
          <button
            type="button"
            className={`button${drawingCheckpoints ? ' isActive' : ''}`}
            aria-pressed={drawingCheckpoints}
            title="Drag across the track to lay down a checkpoint"
            onClick={() => onChangeDrawingCheckpoints(!drawingCheckpoints)}
          >
            Checkpoint
          </button>
        </div>
      </div>

      <div className="kmpToolsRow">
        <span className="kmpToolsLabel">Show</span>
        <div className="kmpToolsButtons">
          <button
            type="button"
            className={`button${pathGroupColors ? ' isActive' : ''}`}
            aria-pressed={pathGroupColors}
            title="Give every path group its own colour"
            onClick={() => onChangePathGroupColors(!pathGroupColors)}
          >
            Group colours
          </button>
          <button
            type="button"
            className={`button${checkpointQuads ? ' isActive' : ''}`}
            aria-pressed={checkpointQuads}
            title="Fill the driving corridor between consecutive checkpoints"
            onClick={() => onChangeCheckpointQuads(!checkpointQuads)}
          >
            Checkpoint corridor
          </button>
        </div>
      </div>

      <button
        type="button"
        className="button"
        disabled={!canCreateRespawns}
        title="Create and assign a new respawn for every checkpoint at its nearest enemy route point, facing along the route"
        onClick={onCreateRespawns}
      >
        Create checkpoint respawns from enemy routes
      </button>

      <p className="viewportOverlayDetail">
        {drawingCheckpoints
          ? 'Drag across the track to lay down a checkpoint. Press Escape to stop drawing.'
          : linkSection
            ? 'Drag a group end handle onto another group to connect it. Drag onto a group it already leads to, to disconnect.'
            : 'A selects the active section, F frames the selection, H hides its layer, the numpad switches views.'}
      </p>
    </div>
  );
}
