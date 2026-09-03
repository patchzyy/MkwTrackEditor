import type { GxTevStageDoc } from '../../lib/gxMaterial';
import { EmptyState } from '../components';
import {
  biasLabel,
  caLabel,
  ccLabel,
  channelLabel,
  konstAlphaLabel,
  konstColorLabel,
  registerLabel,
  scaleLabel,
  slotLabel,
  tevOpLabel,
} from './gxOptions';

/**
 * Read-only view of exactly what will be written to the material's TEV block. The node graph is
 * the authoring model; this is the truth, so an advanced author can check the lowering rather
 * than trusting it.
 */
export function StagesTable({ stages }: { stages: readonly GxTevStageDoc[] }) {
  if (stages.length === 0) {
    return (
      <EmptyState
        size="sm"
        title="No stages"
        description="This material's shader compiles to no TEV stages, so it draws nothing."
      />
    );
  }

  return (
    <div className="materialStagesScroll">
      <table className="materialStagesTable">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Texture</th>
            <th scope="col">Coords</th>
            <th scope="col">Channel</th>
            <th scope="col">Konst</th>
            <th scope="col" className="materialStagesGroup">Colour A</th>
            <th scope="col">B</th>
            <th scope="col">C</th>
            <th scope="col">D</th>
            <th scope="col">Op</th>
            <th scope="col">Bias</th>
            <th scope="col">Scale</th>
            <th scope="col">Clamp</th>
            <th scope="col">Into</th>
            <th scope="col" className="materialStagesGroup">Alpha A</th>
            <th scope="col">B</th>
            <th scope="col">C</th>
            <th scope="col">D</th>
            <th scope="col">Op</th>
            <th scope="col">Bias</th>
            <th scope="col">Scale</th>
            <th scope="col">Clamp</th>
            <th scope="col">Into</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage, index) => (
            <tr key={index}>
              <th scope="row">{index}</th>
              <td>{slotLabel(stage.texMap)}</td>
              <td>{slotLabel(stage.texCoordId)}</td>
              <td>{channelLabel(stage.channelId)}</td>
              <td>{`${konstColorLabel(stage.konstColorSel)} / ${konstAlphaLabel(stage.konstAlphaSel)}`}</td>
              <td className="materialStagesGroup">{ccLabel(stage.colorInA)}</td>
              <td>{ccLabel(stage.colorInB)}</td>
              <td>{ccLabel(stage.colorInC)}</td>
              <td>{ccLabel(stage.colorInD)}</td>
              <td>{tevOpLabel(stage.colorOp)}</td>
              <td>{biasLabel(stage.colorBias)}</td>
              <td>{scaleLabel(stage.colorScale)}</td>
              <td>{stage.colorClamp ? 'Yes' : 'No'}</td>
              <td>{registerLabel(stage.colorRegId)}</td>
              <td className="materialStagesGroup">{caLabel(stage.alphaInA)}</td>
              <td>{caLabel(stage.alphaInB)}</td>
              <td>{caLabel(stage.alphaInC)}</td>
              <td>{caLabel(stage.alphaInD)}</td>
              <td>{tevOpLabel(stage.alphaOp)}</td>
              <td>{biasLabel(stage.alphaBias)}</td>
              <td>{scaleLabel(stage.alphaScale)}</td>
              <td>{stage.alphaClamp ? 'Yes' : 'No'}</td>
              <td>{registerLabel(stage.alphaRegId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
