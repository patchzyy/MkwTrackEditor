
import { assert, nullify } from "./util.js";
import { GfxVendorInfo, GfxProgram, GfxDevice } from "./gfx/platform/GfxPlatform.js";
import { preprocessShader_GLSL } from "./gfx/shaderc/GfxShaderCompiler.js";

export class DeviceProgram {
    public name: string = '(unnamed DeviceProgram)';

    // Compiled program.
    public preprocessedVert: string = '';
    public preprocessedFrag: string = '';

    // Inputs.
    public both: string = '';
    public vert: string = '';
    public frag: string = '';
    public defines = new Map<string, string>();
    public maxSamplerBinding = -1;

    public definesChanged(): void {
        this.preprocessedVert = '';
        this.preprocessedFrag = '';
    }

    public setDefineString(name: string, v: string | null): boolean {
        if (v !== null) {
            if (this.defines.get(name) === v)
                return false;
            this.defines.set(name, v);
        } else {
            if (!this.defines.has(name))
                return false;
            this.defines.delete(name);
        }
        this.definesChanged();
        return true;
    }

    public setDefineBool(name: string, v: boolean): boolean {
        return this.setDefineString(name, v ? '1' : null);
    }

    public getDefineString(name: string): string | null {
        return nullify(this.defines.get(name));
    }

    public getDefineBool(name: string): boolean {
        const str = this.getDefineString(name);
        if (str !== null)
            assert(str === '1');
        return str !== null;
    }

    public ensurePreprocessed(vendorInfo: GfxVendorInfo): void {
        if (this.preprocessedVert === '') {
            this.preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', this.both + this.vert, this.defines, this.maxSamplerBinding);
            this.preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', this.both + this.frag, this.defines, this.maxSamplerBinding);
        }
    }

    private _gfxDevice: GfxDevice | null = null;
    private _gfxProgram: GfxProgram | null = null;
    public associate(device: GfxDevice, program: GfxProgram): void {
        this._gfxDevice = device;
        this._gfxProgram = program;

        if (this.name === '(unnamed DeviceProgram)')
            this.name = this.constructor.name;
        this._gfxDevice.setResourceName(program, this.name);
    }
}
