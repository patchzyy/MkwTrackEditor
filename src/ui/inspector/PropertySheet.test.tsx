import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InspectorHeader } from './InspectorHeader';
import { DetailsCategory, DetailsEmpty, PropertyRow } from './PropertySheet';

describe('PropertyRow', () => {
  it('puts the explanation in a tooltip, not in the row', () => {
    const markup = renderToStaticMarkup(
      <PropertyRow label="Duration" help="How long the shot lasts." unit="frames">
        <input aria-label="Duration" />
      </PropertyRow>,
    );
    expect(markup).toContain('class="propRow hasHelp"');
    expect(markup).toContain('>Duration</span>');
    expect(markup).toContain('frames');
    expect(markup).not.toContain('How long the shot lasts.');
  });

  it('stacks the control under the label for three-axis rows', () => {
    expect(renderToStaticMarkup(<PropertyRow label="Position" wide><input /></PropertyRow>)).toContain('propRow isWide');
  });
});

describe('DetailsCategory', () => {
  it('renders an empty body when its sections have nothing to show, so CSS can hide it', () => {
    const markup = renderToStaticMarkup(<DetailsCategory name="Area">{null}</DetailsCategory>);
    expect(markup).toContain('data-category="Area"');
    expect(markup).toContain('<div class="detailsCategoryBody"></div>');
  });

  it('is open by default and closed when asked', () => {
    expect(renderToStaticMarkup(<DetailsCategory name="A">x</DetailsCategory>)).toContain('is-open');
    expect(renderToStaticMarkup(<DetailsCategory name="B" defaultOpen={false}>x</DetailsCategory>)).not.toContain('is-open');
  });
});

describe('InspectorHeader', () => {
  it('shows the name, the kind and icon actions, with the description left for a tooltip', () => {
    const markup = renderToStaticMarkup(
      <InspectorHeader
        title="Camera 2"
        typeName="Opening pan"
        description="Plays before the race."
        chips={['Opening shot 1', null, false]}
        actions={[{ id: 'preview', label: 'Preview this shot', icon: <span>p</span>, onClick: () => {} }]}
        sections={[]}
      />,
    );
    expect(markup).toContain('Camera 2');
    expect(markup).toContain('Opening pan');
    expect(markup).toContain('Opening shot 1');
    expect(markup).toContain('aria-label="Preview this shot"');
    expect(markup).not.toContain('Plays before the race.');
    // No overflow menu when there is nothing in it.
    expect(markup).not.toContain('inspectorActionsButton');
  });
});

describe('DetailsEmpty', () => {
  it('is one short centred hint', () => {
    expect(renderToStaticMarkup(<DetailsEmpty>Click something</DetailsEmpty>)).toContain('<p>Click something</p>');
  });
});
