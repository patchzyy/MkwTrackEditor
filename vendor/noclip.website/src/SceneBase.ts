
import { GfxDevice } from "./gfx/platform/GfxPlatform.js";
import { SceneGfx, ViewerRenderInput } from "./viewer.js";
import { DataFetcher } from "./DataFetcher.js";
import { DataShare } from "./DataShare.js";
import { GfxRenderInstManager } from "./gfx/render/GfxRenderInstManager.js";
import InputManager from "./InputManager.js";

export interface ProgressMeter {
    setProgress(progress: number): void;
    loadProgress: number;
}

export interface Destroyable {
    destroy(device: GfxDevice): void;
}

export interface GraphObjBase extends Destroyable {
    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void;
}

/**
 * One step of a cooperative scene build. Local addition for the track editor: building a Mario
 * Kart Wii scene parses a dozen BRRES archives and uploads their textures, which is seconds of
 * main-thread work, so the scene reports what it is doing and yields between steps.
 */
export interface SceneLoadProgress {
    /** Stable identifier for the step. */
    stage: string;
    /** Title line for the loading overlay. */
    label: string;
    /** Second line, when there is something countable to say. */
    detail?: string;
    /** 0..1 through the whole "open a track" job, not just the scene build. */
    fraction: number;
}

export interface SceneContext {
    device: GfxDevice;
    dataFetcher: DataFetcher;
    dataShare: DataShare;
    uiContainer: HTMLElement;
    destroyablePool: Destroyable[];
    inputManager: InputManager;
    viewerInput: ViewerRenderInput;
    initialSceneTime: number;
    /** Optional: receives the scene build's progress. See {@link SceneLoadProgress}. */
    onProgress?: (progress: SceneLoadProgress) => void;
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene(device: GfxDevice, sceneContext: SceneContext): PromiseLike<SceneGfx>;
    hidden?: boolean;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: (string | SceneDesc)[];
    sceneIdMap?: Map<string, string>;
    hidden?: boolean;
    altName?: string;
}
