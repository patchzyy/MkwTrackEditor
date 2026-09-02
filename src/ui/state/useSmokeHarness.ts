import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { countSectionEntities } from '../../lib/kmpEdit';
import type { KmpEntity } from '../../lib/kmp';
import type { NoclipBrresSummary } from '../../lib/noclipBrres';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { CourseAssetDatabase } from '../../lib/courseAssets';
import type { TrackDocument } from '../../lib/track';

/**
 * Instrumentation used by `scripts/browser-smoke*.mjs`. It only runs when the page was opened with
 * `?smokeTrack=` / `?smokeCallback=`; the plain `?track=` parameter never enables any of this.
 */
export function useSmokeHarness({
  smokeMode,
  smokeCallbackUrl,
  status,
  commonLoadStatus,
  track,
  trackRef,
  selected,
  commonArchive,
  commonBrresSummaries,
  courseAssetDb,
  copySelectedEntity,
  duplicateSelectedEntity,
  undoEdit,
  redoEdit,
}: {
  smokeMode: boolean;
  smokeCallbackUrl: string | null;
  status: string;
  commonLoadStatus: string;
  track: TrackDocument | null;
  trackRef: MutableRefObject<TrackDocument | null>;
  selected: KmpEntity | null;
  commonArchive: CommonResourceArchive | null;
  commonBrresSummaries: Record<string, NoclipBrresSummary>;
  courseAssetDb: CourseAssetDatabase | null;
  copySelectedEntity: () => void;
  duplicateSelectedEntity: () => void;
  undoEdit: () => void;
  redoEdit: () => void;
}) {
  const [smokeUndoRedoWorked, setSmokeUndoRedoWorked] = useState<'pending' | 'yes' | 'no'>('pending');
  const smokeReportRef = useRef<string | null>(null);
  const smokeUndoRedoStartedRef = useRef(false);

  useEffect(() => {
    if (!smokeCallbackUrl || typeof document === 'undefined') return;
    let cancelled = false;
    const sendReport = () => {
      const rendererStatus = document.querySelector('.rendererStatus')?.textContent?.trim() ?? '';
      const report = {
        status,
        commonLoadStatus,
        rendererStatus,
        loaded: track !== null,
        rendered: rendererStatus.includes('sigma'),
        hasCommonArchiveLoaded: commonArchive !== null,
        commonObjectCount: commonArchive?.objFlow.entries.length ?? 0,
        commonSummaryCount: Object.keys(commonBrresSummaries).length,
        hasCourseAssetDb: courseAssetDb !== null,
        hasViewportCanvas: document.querySelector('canvas.noclipCanvas') !== null,
        hasLegacyPointHandles: document.querySelector('.kmp3dHandle') !== null,
        hasNonblankViewportProbe: document.querySelector('[data-viewport-sample="nonblank"]') !== null,
        hasSmokeSelectedGobjRendered: document.querySelector('[data-smoke-selected-gobj-rendered="yes"]') !== null,
        hasSmokeSelectedGobjSnapped: document.querySelector('[data-smoke-selected-gobj-snapped="yes"]') !== null,
        hasSmokeMouseLook: document.querySelector('[data-smoke-mouselook="yes"]') !== null,
        hasSmokeUndoRedo: smokeUndoRedoWorked === 'yes',
        hasAvailableObjectResource: document.querySelector('.thumbnail.objectPreview[data-state="available"]') !== null,
        hasObjectThumbnailImage:
          document.querySelector('.thumbnail.objectPreview[data-state="available"][data-preview="image"] img[src^="data:image/png;base64,"]') !== null,
        hasInspectorToggle: document.querySelector('[aria-label="Hide inspector"], [aria-label="Show inspector"]') !== null,
        hasContentBrowserToggle: document.querySelector('[aria-label="Collapse content browser"], [aria-label="Expand content browser"]') !== null,
      };
      const ready =
        report.loaded &&
        report.rendered &&
        report.hasViewportCanvas &&
        !report.hasLegacyPointHandles &&
        report.hasNonblankViewportProbe &&
        report.hasSmokeSelectedGobjRendered &&
        report.hasSmokeSelectedGobjSnapped &&
        report.hasSmokeMouseLook &&
        report.hasSmokeUndoRedo &&
        report.hasAvailableObjectResource &&
        report.hasObjectThumbnailImage &&
        report.hasInspectorToggle &&
        report.hasContentBrowserToggle;
      const payload = JSON.stringify({ ...report, ready });
      if (payload === smokeReportRef.current) return;
      smokeReportRef.current = payload;
      const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
      if (!navigator.sendBeacon?.(smokeCallbackUrl, blob)) {
        void fetch(smokeCallbackUrl, { method: 'POST', mode: 'no-cors', body: blob });
      }
    };
    sendReport();
    const interval = window.setInterval(() => {
      if (cancelled) return;
      sendReport();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [smokeCallbackUrl, status, commonLoadStatus, track, commonArchive, commonBrresSummaries, courseAssetDb, smokeUndoRedoWorked]);

  useEffect(() => {
    if (!smokeMode || smokeUndoRedoStartedRef.current || !track?.kmp || !selected || selected.section !== 'GOBJ') return;
    const beforeCount = countSectionEntities(track.kmp.entities, 'GOBJ');
    if (beforeCount === 0) return;
    smokeUndoRedoStartedRef.current = true;
    setSmokeUndoRedoWorked('pending');
    copySelectedEntity();
    duplicateSelectedEntity();

    const frame1 = window.requestAnimationFrame(() => {
      const afterDuplicateCount = countSectionEntities(trackRef.current?.kmp?.entities ?? [], 'GOBJ');
      if (afterDuplicateCount !== beforeCount + 1) {
        setSmokeUndoRedoWorked('no');
        return;
      }
      undoEdit();
      const frame2 = window.requestAnimationFrame(() => {
        const afterUndoCount = countSectionEntities(trackRef.current?.kmp?.entities ?? [], 'GOBJ');
        if (afterUndoCount !== beforeCount) {
          setSmokeUndoRedoWorked('no');
          return;
        }
        redoEdit();
        const frame3 = window.requestAnimationFrame(() => {
          const afterRedoCount = countSectionEntities(trackRef.current?.kmp?.entities ?? [], 'GOBJ');
          setSmokeUndoRedoWorked(afterRedoCount === beforeCount + 1 ? 'yes' : 'no');
        });
        return () => window.cancelAnimationFrame(frame3);
      });
      return () => window.cancelAnimationFrame(frame2);
    });

    return () => window.cancelAnimationFrame(frame1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smokeMode, selected, track]);
}
