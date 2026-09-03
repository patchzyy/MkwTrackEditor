import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { MenuSection } from '../components/Menu';

/**
 * Lets the property sheet contribute items to the inspector header's "⋯" menu.
 *
 * The header lives in the mode panel (KMP mode's `KmpInspector`) while the per-record actions
 * — move earlier, clear the movement path, reset to defaults — are known only inside the
 * property sheet, which the mode panel receives as an opaque node. Rather than growing another
 * dozen props, the sheet registers its menu sections here and the header renders them below
 * its own. When there is no host the sheet renders its own small header instead.
 */

type SectionsGetter = () => MenuSection[];

interface Registry {
  register: (id: string, get: SectionsGetter) => void;
  unregister: (id: string) => void;
  /** Re-renders the host when a registered section's labels or availability changed. */
  refresh: () => void;
}

const RegistryContext = createContext<Registry | null>(null);

/** Cheap "did the visible menu change?" key. Handlers are read fresh at click time. */
function signatureOf(sections: MenuSection[]): string {
  return sections
    .map((section) => `${section.id}:${section.title ?? ''}:${section.items.map((item) => `${item.id}|${typeof item.label === 'string' ? item.label : ''}|${item.disabled ? 1 : 0}|${item.danger ? 1 : 0}`).join(',')}`)
    .join(';');
}

/**
 * Hosts the registry. `render` gets the sections every descendant registered, in registration
 * order, and is responsible for showing them (normally in the header's actions menu).
 */
export function InspectorActionsHost({ render }: { render: (sections: MenuSection[]) => ReactNode }) {
  const entries = useRef(new Map<string, SectionsGetter>());
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  const registry = useMemo<Registry>(
    () => ({
      register(id, get) {
        entries.current.set(id, get);
        forceRender();
      },
      unregister(id) {
        entries.current.delete(id);
        forceRender();
      },
      refresh: forceRender,
    }),
    [],
  );
  const sections: MenuSection[] = [];
  for (const get of entries.current.values()) sections.push(...get());
  return <RegistryContext.Provider value={registry}>{render(sections)}</RegistryContext.Provider>;
}

/**
 * Publishes menu sections to the surrounding {@link InspectorActionsHost}.
 *
 * Returns false when nothing is hosting, so the caller can fall back to rendering its own
 * header and menu (the standalone inspector tab does exactly that).
 */
export function useRegisterInspectorActions(id: string, sections: MenuSection[]): boolean {
  const registry = useContext(RegistryContext);
  const latest = useRef(sections);
  latest.current = sections;
  const signature = signatureOf(sections);

  useEffect(() => {
    if (!registry) return;
    registry.register(id, () => latest.current);
    return () => registry.unregister(id);
  }, [registry, id]);

  useEffect(() => {
    registry?.refresh();
  }, [registry, signature]);

  return registry !== null;
}
