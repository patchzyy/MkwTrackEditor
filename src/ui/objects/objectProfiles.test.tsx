import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { KmpEntity } from '../../lib/kmp';
import type { ObjFlowTable } from '../../lib/objflow';
import objectNamesById from '../../generated/mkwObjectNames.json';
import { ObjectSettingsFields } from '../inspector/objectSettings/ObjectSettingsFields';
import { ObjectSetupSection } from '../inspector/sections/ObjectSetupSection';
import { featuredObjectIds, type ObjectOption } from './objectCatalog';
import {
  getObjectInspectorProfile,
  getObjectVariantOptions,
  guidanceOnlyObjectProfileNotes,
  type ObjectInspectorProfile,
} from './objectProfiles';

const knownObjectIds = Object.keys(objectNamesById as Record<string, string>)
  .map((key) => Number(key))
  .filter((id) => Number.isFinite(id));

function rawObjectName(objectId: number): string {
  return (objectNamesById as Record<string, string>)[String(objectId)] ?? '';
}

/**
 * Stands in for the ObjFlow table that Common.szs provides at runtime. The generated object name
 * file uses the same internal names, which is what the profile matcher looks at.
 */
const objFlow: ObjFlowTable = {
  entries: knownObjectIds.map((objectId) => ({ objectId, name: rawObjectName(objectId), resources: rawObjectName(objectId) })),
  byId: new Map(knownObjectIds.map((objectId) => [objectId, { objectId, name: rawObjectName(objectId), resources: rawObjectName(objectId) }])),
};

/** The summary `getObjectInspectorProfile` falls back to when an object has no hand-written profile. */
const GENERIC_PROFILE_SUMMARY = 'Base-game object. Use placement, rotation, scale, path binding, and collision snap from the main inspector tools first.';

/**
 * Titles whose dedicated inspector content is a one-click action in `ObjectSetupSection` rather
 * than a settings field in `ObjectSettingsFields`.
 */
const actionOnlyProfileTitles = new Set(['Falling Rock', 'Cannon Object', 'Roulette Platform']);

function gobjEntity(objectId: number): KmpEntity {
  return {
    id: 'GOBJ-0',
    section: 'GOBJ',
    index: 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    objectId,
    routeIndex: 0xffff,
    objectSettings: [0, 0, 0, 0, 0, 0, 0, 0],
    presenceFlags: 0x003f,
    rawOffset: 0,
    recordSize: 0x3c,
  } as unknown as KmpEntity;
}

function profileFor(objectId: number): ObjectInspectorProfile {
  const profile = getObjectInspectorProfile(gobjEntity(objectId), objFlow);
  if (!profile) throw new Error(`no profile for object ${objectId}`);
  return profile;
}

function renderObjectSettings(objectId: number): string {
  return renderToStaticMarkup(
    <ObjectSettingsFields entity={gobjEntity(objectId)} objectProfile={profileFor(objectId)} onChangeObjectSetting={() => {}} />,
  );
}

function renderObjectSetup(objectId: number): string {
  // The settings and the game-mode list are two parts the inspector puts in separate categories.
  return (['settings', 'presence'] as const)
    .map((part) =>
      renderToStaticMarkup(
        <ObjectSetupSection
          part={part}
          entity={gobjEntity(objectId)}
          objectProfile={profileFor(objectId)}
          objectVariantOptions={[]}
          onChangeObjectId={() => {}}
          onChangePresenceFlags={() => {}}
          onChangeObjectSetting={() => {}}
        />,
      ),
    )
    .join('');
}

/** True when the object gets more than the generic "placement only" inspector. */
function hasDedicatedInspector(objectId: number): boolean {
  const profile = profileFor(objectId);
  return (
    renderObjectSettings(objectId).length > 0 ||
    actionOnlyProfileTitles.has(profile.title) ||
    Boolean(profile.routeLabel) ||
    Boolean(profile.variantLabel) ||
    Boolean(guidanceOnlyObjectProfileNotes[profile.title])
  );
}

describe('object inspector profiles', () => {
  it('gives every known object a titled, summarised profile', () => {
    expect(knownObjectIds.length).toBeGreaterThan(300);
    for (const objectId of knownObjectIds) {
      const profile = getObjectInspectorProfile(gobjEntity(objectId), objFlow);
      expect(profile, `object 0x${objectId.toString(16)} should have an inspector profile`).not.toBeNull();
      expect(profile!.title.length).toBeGreaterThan(0);
      expect(profile!.summary.length).toBeGreaterThan(0);
      expect(profile!.tips.length).toBeGreaterThan(0);
    }
  });

  it('returns nothing for records that are not placed objects', () => {
    const respawn = { id: 'JGPT-0', section: 'JGPT', index: 0, position: { x: 0, y: 0, z: 0 } } as unknown as KmpEntity;
    expect(getObjectInspectorProfile(respawn, objFlow)).toBeNull();
  });

  it('gives every hand-written profile either dedicated controls, a path binding or a guidance note', () => {
    const firstIdByTitle = new Map<string, number>();
    for (const objectId of knownObjectIds) {
      const profile = profileFor(objectId);
      if (profile.summary === GENERIC_PROFILE_SUMMARY) continue;
      if (!firstIdByTitle.has(profile.title)) firstIdByTitle.set(profile.title, objectId);
    }
    expect(firstIdByTitle.size).toBeGreaterThan(40);

    const uncovered = [...firstIdByTitle].filter(([, objectId]) => !hasDedicatedInspector(objectId)).map(([title]) => title);
    expect(uncovered.sort()).toEqual([]);
  });

  it('gives every highlighted common object a specific profile and a dedicated inspector', () => {
    expect([...featuredObjectIds]).toEqual([0x65, 0x191, 0x192, 0x194, 0x148, 0xe5, 0xce, 0x197, 0x1a5, 0x162, 0x261]);
    for (const objectId of featuredObjectIds) {
      const profile = profileFor(objectId);
      expect(profile.summary, `featured object 0x${objectId.toString(16)} still uses the generic profile`).not.toBe(GENERIC_PROFILE_SUMMARY);
      expect(hasDedicatedInspector(objectId), `featured object 0x${objectId.toString(16)} (${profile.title}) needs a dedicated inspector`).toBe(true);
    }
  });

  it('renders the friendly object setup block in plain language, including guidance-only notes', () => {
    const itemBox = renderObjectSetup(0x65);
    expect(itemBox).toContain('Single player and time trials');
    // The raw bit mask belongs in the inspector's Advanced disclosure, never here.
    expect(itemBox).not.toContain('Presence Flags');
    expect(itemBox).not.toMatch(/0x[0-9A-F]{4}/);

    const guidanceOnlyId = knownObjectIds.find((id) => guidanceOnlyObjectProfileNotes[profileFor(id).title]);
    expect(guidanceOnlyId, 'at least one object should use a guidance-only note').toBeDefined();
    expect(renderObjectSetup(guidanceOnlyId!)).toContain(guidanceOnlyObjectProfileNotes[profileFor(guidanceOnlyId!).title].slice(0, 40));
  });

  it('offers only known object ids as variant options', () => {
    const allOptions: ObjectOption[] = knownObjectIds.map((id) => ({ id, label: `Object ${id}`, detail: '' }));
    const knownIdSet = new Set(knownObjectIds);
    const familiesByTitle = new Map<string, number>();

    for (const objectId of knownObjectIds) {
      const profile = profileFor(objectId);
      const variants = getObjectVariantOptions(profile, allOptions);
      if (variants.length === 0) continue;
      familiesByTitle.set(profile.title, variants.length);
      for (const variant of variants) {
        expect(knownIdSet.has(variant.id), `variant 0x${variant.id.toString(16)} of ${profile.title} is not a known object`).toBe(true);
      }
    }

    expect(familiesByTitle.size).toBeGreaterThan(10);
    for (const [title, count] of familiesByTitle) {
      expect(count, `${title} should expose at least one concrete variant id`).toBeGreaterThan(0);
      expect(hasNamedProfile(title)).toBe(true);
    }
  });

  it('drops variant ids that the loaded object table does not know about', () => {
    expect(getObjectVariantOptions(profileFor(0x65), [])).toEqual([]);
  });
});

/** A variant family title must be reachable from a real, hand-written profile. */
function hasNamedProfile(title: string): boolean {
  return knownObjectIds.some((objectId) => {
    const profile = profileFor(objectId);
    return profile.title === title && profile.summary !== GENERIC_PROFILE_SUMMARY;
  });
}
