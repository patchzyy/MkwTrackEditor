import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import ArrayBufferSlice from '../../vendor/noclip.website/src/ArrayBufferSlice.js';
import { LoopMode, parse as parseBrres } from '../../vendor/noclip.website/src/rres/brres.js';
import { parseU8 } from './u8';

const previewDummyArchive = '/mnt/g/ai/MkwTrackEditor/public/data/MarioKartWii/Race/PreviewDummies.u8';

describe('preview dummy asset bundle', () => {
  it.runIf(existsSync(previewDummyArchive))('contains Funky Kong and Flame Runner assets with an idle loop', () => {
    const archiveEntries = parseU8(new Uint8Array(readFileSync(previewDummyArchive)));
    const driver = archiveEntries.find((entry) => entry.type === 'file' && entry.path === 'Preview/fk_lb_driver_model.brres');
    const kart = archiveEntries.find((entry) => entry.type === 'file' && entry.path === 'Preview/fk_lb_kart_model.brres');
    expect(driver?.data).toBeTruthy();
    expect(kart?.data).toBeTruthy();

    const driverBrres = parseBrres(new ArrayBufferSlice(driver!.data!.buffer, driver!.data!.byteOffset, driver!.data!.byteLength));
    const kartBrres = parseBrres(new ArrayBufferSlice(kart!.data!.buffer, kart!.data!.byteOffset, kart!.data!.byteLength));
    const waitAnim = driverBrres.chr0.find((chr0) => chr0.name === 'wait');

    expect(waitAnim?.loopMode).toBe(LoopMode.REPEAT);
    expect(kartBrres.mdl0.length).toBeGreaterThan(1);
    expect(kartBrres.chr0.length).toBeGreaterThan(0);
  });
});
