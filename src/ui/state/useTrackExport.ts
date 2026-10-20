import type { Dispatch, SetStateAction } from 'react';
import type { CommonResourceArchive } from '../../lib/objflow';
import { exportTrack, validateExportBytes, validateTrack, type TrackDocument } from '../../lib/track';
import { presentValidationIssue } from '../labels';

/**
 * Runs validation, then packs and downloads the edited `.szs`.
 *
 * `downloadExport` reports whether a file was actually written, so the shell can clear its
 * "edited, not exported yet" marker only when the user really has the bytes.
 */
export function useTrackExport({
  track: currentTrack,
  commonArchive,
  setStatus,
}: {
  track: TrackDocument | null;
  commonArchive: CommonResourceArchive | null;
  setStatus: Dispatch<SetStateAction<string>>;
}) {
  /** `trackOverride` exports a document newer than the last render (Create mode's fresh compile). */
  function downloadExport(trackOverride?: TrackDocument | null): boolean {
    const track = trackOverride ?? currentTrack;
    if (!track) return false;
    const issues = validateTrack(track, { common: commonArchive });
    if (issues.length > 0) {
      const errors = issues.filter((issue) => issue.level === 'error').length;
      const warnings = issues.length - errors;
      const summary = issues
        .slice(0, 8)
        .map((issue) => {
          const presented = presentValidationIssue(issue.message);
          return `${issue.level.toUpperCase()}: ${presented.summary}${presented.detail ? ` (${presented.detail})` : ''}`;
        })
        .join('\n');
      const suffix = issues.length > 8 ? `\n...and ${issues.length - 8} more.` : '';
      const proceed = window.confirm(`Export with ${errors} errors and ${warnings} warnings?\n\n${summary}${suffix}`);
      if (!proceed) {
        setStatus('Export cancelled after validation review.');
        return false;
      }
      setStatus(`Exporting with ${errors} validation errors and ${warnings} warnings.`);
    }
    const bytes = exportTrack(track, { common: commonArchive });
    const exportIssues = validateExportBytes(track, bytes, { common: commonArchive });
    if (exportIssues.length > 0) {
      const errors = exportIssues.filter((issue) => issue.level === 'error').length;
      const warnings = exportIssues.length - errors;
      const summary = exportIssues
        .slice(0, 8)
        .map((issue) => {
          const presented = presentValidationIssue(issue.message);
          return `${issue.level.toUpperCase()}: ${presented.summary}${presented.detail ? ` (${presented.detail})` : ''}`;
        })
        .join('\n');
      const suffix = exportIssues.length > 8 ? `\n...and ${exportIssues.length - 8} more.` : '';
      const proceed = errors === 0 && window.confirm(`Export self-check found ${warnings} warnings.\n\n${summary}${suffix}`);
      if (!proceed) {
        setStatus(errors ? `Export blocked: ${errors} exported archive errors.` : 'Export cancelled after archive self-check.');
        return false;
      }
    }
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    // A track built in Create mode is the finished file, not an edit of somebody else's.
    link.download = track.fileName.replace(/\.szs$/i, '') + (track.sourceId?.startsWith('create:') ? '.szs' : '.edited.szs');
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${link.download} (${bytes.length.toLocaleString()} bytes).`);
    return true;
  }

  return { downloadExport };
}
