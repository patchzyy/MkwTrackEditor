import { useEffect, useMemo, useState } from 'react';
import type { EditorProjectState } from '../../lib/brresEditor';
import type { CourseAssetDatabase } from '../../lib/courseAssets';
import type { CommonResourceArchive } from '../../lib/objflow';
import type { TrackDocument } from '../../lib/track';
import { buildBrowserFolders, filterBrowserFolder, type BrowserFolderId } from '../contentBrowser/browserFolders';

/** Content browser folder model: which folders exist, which one is open, and the search filter. */
export function useBrowserFolders({
  track,
  projectState,
  objFlow,
  commonArchive,
  courseAssetDb,
}: {
  track: TrackDocument | null;
  projectState: EditorProjectState | null;
  objFlow: CommonResourceArchive['objFlow'] | null;
  commonArchive: CommonResourceArchive | null;
  courseAssetDb: CourseAssetDatabase | null;
}) {
  const [browserFolder, setBrowserFolder] = useState<BrowserFolderId>('featured');
  const [browserQuery, setBrowserQuery] = useState('');

  const browserFolders = useMemo(
    () => buildBrowserFolders({ track, projectState, objFlow, commonArchive, courseAssetDb }),
    [commonArchive, courseAssetDb, objFlow, projectState, track],
  );
  const activeBrowserFolder = browserFolders.find((folder) => folder.id === browserFolder) ?? browserFolders[0] ?? null;
  const filteredBrowserFolder = useMemo(() => filterBrowserFolder(activeBrowserFolder, browserQuery), [activeBrowserFolder, browserQuery]);

  useEffect(() => {
    if (!browserFolders.some((folder) => folder.id === browserFolder) && browserFolders[0]) setBrowserFolder(browserFolders[0].id);
  }, [browserFolder, browserFolders]);

  return {
    browserFolder,
    setBrowserFolder,
    browserQuery,
    setBrowserQuery,
    browserFolders,
    activeBrowserFolder,
    filteredBrowserFolder,
  };
}
