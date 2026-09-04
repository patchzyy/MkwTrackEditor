// How the rest of the editor asks for the Model Studio.
//
// Kept in its own module so `src/ui/modes/types.ts` can name the request without pulling the
// whole studio (and the noclip scene behind it) into every mode's import graph.

export interface StudioLaunchRequest {
  /**
   * An archive that belongs to the loaded track (`course_model.brres`, `Object/xyz.brres`).
   * The shell resolves the bytes and wires the studio's edits back into the track document, so
   * a material changed in the studio lands in the same undo history as one changed in-place.
   */
  trackArchivePath?: string;
  /** Or bytes the caller already has — a picked file, a library asset. */
  file?: { fileName: string; bytes: Uint8Array };
}

export type OpenModelStudio = (request?: StudioLaunchRequest) => void;
