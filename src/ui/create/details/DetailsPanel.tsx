import { NO_ASSETS, type CreateAssets } from '../palette/assets';
import type { CreateSession } from '../session/types';
import type { CreateTools } from '../tools/useCreateTools';
import '../create-tools.css';
import './details.css';
import { MultiDetails } from './MultiDetails';
import { PieceDetails } from './PieceDetails';
import { PointDetails } from './PointDetails';
import { PropDetails } from './PropDetails';
import { RoadDetails } from './RoadDetails';
import { SectionDetails } from './SectionDetails';
import { StartDetails, StrokeDetails } from './SimpleDetails';
import { TrackDetails } from './TrackDetails';

/**
 * The right "Details" dock: contextual, simple by default. Nothing selected shows the track's own
 * settings; clicking a road, point, section, piece or object shows exactly that.
 */
export function DetailsPanel({ session, tools, assets = NO_ASSETS }: { session: CreateSession; tools: CreateTools; assets?: CreateAssets }) {
  const selection = session.selection;
  let body;
  if (!session.project) body = null;
  else if (selection.length === 0) body = <TrackDetails session={session} />;
  else if (selection.length > 1) body = <MultiDetails session={session} />;
  else {
    const sel = selection[0];
    switch (sel.kind) {
      case 'road':
        body = <RoadDetails key={sel.roadId} session={session} roadId={sel.roadId} />;
        break;
      case 'point':
        body = <PointDetails key={sel.pointId} session={session} roadId={sel.roadId} pointId={sel.pointId} onSelectRoad={() => session.select([{ kind: 'road', roadId: sel.roadId }])} />;
        break;
      case 'section':
        body = <SectionDetails key={sel.sectionId} session={session} roadId={sel.roadId} sectionId={sel.sectionId} onSelectRoad={() => session.select([{ kind: 'road', roadId: sel.roadId }])} />;
        break;
      case 'piece':
        body = <PieceDetails key={sel.pieceId} session={session} pieceId={sel.pieceId} />;
        break;
      case 'prop':
        body = <PropDetails key={sel.propId} session={session} propId={sel.propId} assets={assets} />;
        break;
      case 'start':
        body = <StartDetails session={session} tools={tools} />;
        break;
      case 'stroke':
        body = <StrokeDetails key={sel.strokeId} session={session} strokeId={sel.strokeId} />;
        break;
    }
  }
  return (
    <div className="createMode crDetailsPanel" data-create-slot="details">
      {body}
    </div>
  );
}
