
// New UI system

// Trimmed for the MKW Track Editor: only the reusable widget primitives that the
// Mario Kart Wii scene and the rres scene loader need are kept. The noclip app shell
// (scene select, texture viewer, studio, XR settings, bottom bar, the `UI` class) lives
// in the upstream project only.

import { GlobalGrabManager } from './GrabManager.js';
import { DraggingMode } from './InputManager.js';
import { clamp, invlerp, lerp, MathConstants } from './MathHelpers.js';
import { assert, assertExists } from './util.js';
import * as Viewer from './viewer.js';

export const HIGHLIGHT_COLOR = 'rgb(210, 30, 30)';
export const COOL_BLUE_COLOR = 'rgb(20, 105, 215)';
export const PANEL_BG_COLOR = '#411';

export function createDOMFromString(s: string): DocumentFragment {
    return document.createRange().createContextualFragment(s);
}

enum FontelloIcon {
    share = '\ue800',
    resize_full = '\ue801',
    pause = '\ue802',
    resize_small = '\ue803',
    play = '\ue804',
    fast_backward = '\ue805',
};

function setFontelloIcon(elem: HTMLElement, icon: FontelloIcon): void {
    elem.style.fontFamily = 'fontello';
    elem.textContent = icon;
}

const OPEN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 2 92 92" height="20" fill="white"><path d="M84.3765045,45.2316481 L77.2336539,75.2316205 L77.2336539,75.2316205 C77.1263996,75.6820886 76.7239081,76 76.2608477,76 L17.8061496,76 C17.2538649,76 16.8061496,75.5522847 16.8061496,75 C16.8061496,74.9118841 16.817796,74.8241548 16.8407862,74.739091 L24.7487983,45.4794461 C24.9845522,44.607157 25.7758952,44.0012839 26.6794815,44.0012642 L83.4036764,44.0000276 L83.4036764,44.0000276 C83.9559612,44.0000156 84.4036862,44.4477211 84.4036982,45.0000058 C84.4036999,45.0780163 84.3945733,45.155759 84.3765045,45.2316481 L84.3765045,45.2316481 Z M15,24 L26.8277004,24 L26.8277004,24 C27.0616369,24 27.2881698,24.0820162 27.4678848,24.2317787 L31.799078,27.8411064 L31.799078,27.8411064 C32.697653,28.5899189 33.8303175,29 35,29 L75,29 C75.5522847,29 76,29.4477153 76,30 L76,38 L76,38 C76,38.5522847 75.5522847,39 75,39 L25.3280454,39 L25.3280454,39 C23.0690391,39 21.0906235,40.5146929 20.5012284,42.6954549 L14.7844016,63.8477139 L14.7844016,63.8477139 C14.7267632,64.0609761 14.5071549,64.1871341 14.2938927,64.1294957 C14.1194254,64.0823423 13.9982484,63.9240598 13.9982563,63.7433327 L13.9999561,25 L14,25 C14.0000242,24.4477324 14.4477324,24.0000439 15,24.0000439 L15,24 Z"/></svg>`;
export const SEARCH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 26.25" height="20" fill="white"><path d="M8.6953,14.3916 C5.5543,14.3916 3.0003,11.8356 3.0003,8.6956 C3.0003,5.5546 5.5543,2.9996 8.6953,2.9996 C11.8363,2.9996 14.3913,5.5546 14.3913,8.6956 C14.3913,11.8356 11.8363,14.3916 8.6953,14.3916 L8.6953,14.3916 Z M15.8423,13.7216 L15.6073,13.9566 C16.7213,12.4956 17.3913,10.6756 17.3913,8.6956 C17.3913,3.8936 13.4983,-0.0004 8.6953,-0.0004 C3.8933,-0.0004 0.0003,3.8936 0.0003,8.6956 C0.0003,13.4976 3.8933,17.3916 8.6953,17.3916 C10.6753,17.3916 12.4953,16.7216 13.9573,15.6076 L13.7213,15.8426 L18.3343,20.4546 L20.4553,18.3336 L15.8423,13.7216 Z"/></svg>`;
const TEXTURES_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" height="20" fill="white"><path d="M143.5,143.5v300h300v-300H143.5z M274.8,237.2c10.3,0,18.7,8.4,18.7,18.9c0,10.3-8.4,18.7-18.7,18.7   c-10.3,0-18.7-8.4-18.7-18.7C256,245.6,264.4,237.2,274.8,237.2z M406,406H181v-56.2l56.2-56.1l37.5,37.3l75-74.8l56.2,56.1V406z"/><polygon points="387.2,68.6 68.5,68.6 68.5,368.5 106,368.5 106,106 387.2,106"/></svg>`;
const FRUSTUM_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="20" fill="white"><polygon points="48.2573,19.8589 33.8981,15.0724 5,67.8384 48.2573,90.3684" /><polygon points="51.5652,19.8738 51.5652,90.3734 95,67.8392 65.9366,15.2701" /><polygon points="61.3189,13.2756 49.9911,9.6265 38.5411,13.1331 49.9213,16.9268" /></svg>`;
const STATISTICS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 0 55 60" height="16" fill="white"><g><polygon points="6.9,11.5 6.9,56 55.4,56 55.4,53 9.9,53 9.9,11.5"/><path d="M52.7,15.8c-2.7,0-4.9,2.2-4.9,4.9c0,1,0.3,1.8,0.8,2.6l-5,6.8c-0.4-0.1-0.9-0.2-1.3-0.2c-1.5,0-2.9,0.7-3.8,1.8l-5.6-2.8   c0-0.2,0.1-0.5,0.1-0.8c0-2.7-2.2-4.9-4.9-4.9s-4.9,2.2-4.9,4.9c0,1.1,0.3,2,0.9,2.8l-3.9,5.1c-0.5-0.2-1.1-0.3-1.7-0.3   c-2.7,0-4.9,2.2-4.9,4.9s2.2,4.9,4.9,4.9s4.9-2.2,4.9-4.9c0-1-0.3-2-0.8-2.7l4-5.2c0.5,0.2,1.1,0.3,1.6,0.3c1.4,0,2.6-0.6,3.5-1.5   l5.8,2.9c0,0.1,0,0.2,0,0.3c0,2.7,2.2,4.9,4.9,4.9c2.7,0,4.9-2.2,4.9-4.9c0-1.2-0.4-2.2-1.1-3.1l4.8-6.5c0.6,0.2,1.2,0.4,1.9,0.4   c2.7,0,4.9-2.2,4.9-4.9S55.4,15.8,52.7,15.8z"/></g></svg>`;
const ABOUT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="16" fill="white"><path d="M50,1.1C23,1.1,1.1,23,1.1,50S23,98.9,50,98.9C77,98.9,98.9,77,98.9,50S77,1.1,50,1.1z M55.3,77.7c0,1.7-1.4,3.1-3.1,3.1  h-7.9c-1.7,0-3.1-1.4-3.1-3.1v-5.1c0-1.7,1.4-3.1,3.1-3.1h7.9c1.7,0,3.1,1.4,3.1,3.1V77.7z M67.8,47.3c-2.1,2.9-4.7,5.2-7.9,6.9  c-1.8,1.2-3,2.4-3.6,3.8c-0.4,0.9-0.7,2.1-0.9,3.5c-0.1,1.1-1.1,1.9-2.2,1.9h-9.7c-1.3,0-2.3-1.1-2.2-2.3c0.2-2.7,0.9-4.8,2-6.4  c1.4-1.9,3.9-4.2,7.5-6.7c1.9-1.2,3.3-2.6,4.4-4.3c1.1-1.7,1.6-3.7,1.6-6c0-2.3-0.6-4.2-1.9-5.6c-1.3-1.4-3-2.1-5.3-2.1  c-1.9,0-3.4,0.6-4.7,1.7c-0.8,0.7-1.3,1.6-1.6,2.8c-0.4,1.4-1.7,2.3-3.2,2.3l-9-0.2c-1.1,0-2-1-1.9-2.1c0.3-4.8,2.2-8.4,5.5-11  c3.8-2.9,8.7-4.4,14.9-4.4c6.6,0,11.8,1.7,15.6,5c3.8,3.3,5.7,7.8,5.7,13.5C70.9,41.2,69.8,44.4,67.8,47.3z"/></svg>`;
const DICE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="18" height="18" fill="white"><path d="M 12.161286,0.33596185 C 9.1715371,-0.03245869 6.4678746,2.0779729 6.099454,5.0677219 L 0.33596183,51.838714 c -0.36842076,2.989751 1.74201117,5.693411 4.73176007,6.061832 l 46.7709931,5.763492 c 2.98975,0.368421 5.69341,-1.742009 6.061831,-4.73176 L 63.664038,12.161286 C 64.032459,9.171537 61.922029,6.4678748 58.932279,6.0994541 Z M 20.047281,10.438667 a 5.4374807,5.4374806 7.0250241 0 1 4.731761,6.061832 5.4374807,5.4374806 7.0250241 0 1 -6.061833,4.73176 5.4374807,5.4374806 7.0250241 0 1 -4.73176,-6.061832 5.4374807,5.4374806 7.0250241 0 1 6.061832,-4.73176 z m 28.782293,3.546782 a 5.4374807,5.4374806 7.0250241 0 1 4.731295,6.061775 5.4374807,5.4374806 7.0250241 0 1 -6.061367,4.731817 5.4374807,5.4374806 7.0250241 0 1 -4.731761,-6.061832 5.4374807,5.4374806 7.0250241 0 1 6.061833,-4.73176 z M 32.665036,26.603204 a 5.4374807,5.4374806 7.0250241 0 1 4.731295,6.061775 5.4374807,5.4374806 7.0250241 0 1 -6.06131,4.731351 5.4374807,5.4374806 7.0250241 0 1 -4.731817,-6.061366 5.4374807,5.4374806 7.0250241 0 1 6.061832,-4.73176 z M 16.500499,39.220959 a 5.4374807,5.4374806 7.0250241 0 1 4.731761,6.061833 5.4374807,5.4374806 7.0250241 0 1 -6.061776,4.731295 5.4374807,5.4374806 7.0250241 0 1 -4.731817,-6.061367 5.4374807,5.4374806 7.0250241 0 1 6.061832,-4.731761 z m 28.782293,3.546782 a 5.4374807,5.4374806 7.0250241 0 1 4.731295,6.061776 5.4374807,5.4374806 7.0250241 0 1 -6.06131,4.731353 5.4374807,5.4374806 7.0250241 0 1 -4.731818,-6.061368 5.4374807,5.4374806 7.0250241 0 1 6.061833,-4.731761 z"/></svg>`;

// Custom icons used by game-specific panels.
export const LAYER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" height="20" fill="white"><g transform="translate(0,-1036.3622)"><path d="m 8,1039.2486 -0.21875,0.125 -4.90625,2.4375 5.125,2.5625 5.125,-2.5625 L 8,1039.2486 z m -3,4.5625 -2.125,0.9688 5.125,2.5625 5.125,-2.5625 -2.09375,-0.9688 -3.03125,1.5 -1,-0.5 -0.90625,-0.4375 L 5,1043.8111 z m 0,3 -2.125,0.9688 5.125,2.5625 5.125,-2.5625 -2.09375,-0.9688 -3.03125,1.5 -1,-0.5 -0.90625,-0.4375 L 5,1046.8111 z"/></g></svg>`;
export const TIME_OF_DAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="20" fill="white"><path d="M50,93.4C74,93.4,93.4,74,93.4,50C93.4,26,74,6.6,50,6.6C26,6.6,6.6,26,6.6,50C6.6,74,26,93.4,50,93.4z M37.6,22.8  c-0.6,2.4-0.9,5-0.9,7.6c0,18.2,14.7,32.9,32.9,32.9c2.6,0,5.1-0.3,7.6-0.9c-4.7,10.3-15.1,17.4-27.1,17.4  c-16.5,0-29.9-13.4-29.9-29.9C20.3,37.9,27.4,27.5,37.6,22.8z"/></svg>`;
export const RENDER_HACKS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 105" height="20" fill="white"><path d="M95,5v60H65c0-16.6-13.4-30-30-30V5H95z"/><path d="M65,65c0,16.6-13.4,30-30,30C18.4,95,5,81.6,5,65c0-16.6,13.4-30,30-30v30H65z"/></svg>`;
export const SAND_CLOCK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" height="20" fill="white"><g><path d="M79.3,83.3h-6.2H24.9h-6.2c-1.7,0-3,1.3-3,3s1.3,3,3,3h60.6c1.7,0,3-1.3,3-3S81,83.3,79.3,83.3z"/><path d="M18.7,14.7h6.2h48.2h6.2c1.7,0,3-1.3,3-3s-1.3-3-3-3H18.7c-1.7,0-3,1.3-3,3S17,14.7,18.7,14.7z"/><path d="M73.1,66c0-0.9-0.4-1.8-1.1-2.4L52.8,48.5L72,33.4c0.7-0.6,1.1-1.4,1.1-2.4V20.7H24.9V31c0,0.9,0.4,1.8,1.1,2.4l19.1,15.1   L26,63.6c-0.7,0.6-1.1,1.4-1.1,2.4v11.3h48.2V66z"/></g></svg>';
export const VR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" height="20" fill="white"><g><path d="M29,8H3A1,1,0,0,0,2,9V23a1,1,0,0,0,1,1H13a1,1,0,0,0,1-.83l.66-4A1.36,1.36,0,0,1,16,18a1.38,1.38,0,0,1,1.36,1.26L18,23.17A1,1,0,0,0,19,24H29a1,1,0,0,0,1-1V9A1,1,0,0,0,29,8ZM8.5,19A3.5,3.5,0,1,1,12,15.5,3.5,3.5,0,0,1,8.5,19Zm15,0A3.5,3.5,0,1,1,27,15.5,3.5,3.5,0,0,1,23.5,19Z"/></g></svg>`;
export const CUTSCENE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 142.448 142.448" height="20" fill="white"><g><path d="M142.411,68.9C141.216,31.48,110.968,1.233,73.549,0.038c-20.361-0.646-39.41,7.104-53.488,21.639 C6.527,35.65-0.584,54.071,0.038,73.549c1.194,37.419,31.442,67.667,68.861,68.861c0.779,0.025,1.551,0.037,2.325,0.037 c19.454,0,37.624-7.698,51.163-21.676C135.921,106.799,143.033,88.377,142.411,68.9z M111.613,110.336 c-10.688,11.035-25.032,17.112-40.389,17.112c-0.614,0-1.228-0.01-1.847-0.029c-29.532-0.943-53.404-24.815-54.348-54.348 c-0.491-15.382,5.122-29.928,15.806-40.958c10.688-11.035,25.032-17.112,40.389-17.112c0.614,0,1.228,0.01,1.847,0.029 c29.532,0.943,53.404,24.815,54.348,54.348C127.91,84.76,122.296,99.306,111.613,110.336z"></path> <path d="M94.585,67.086L63.001,44.44c-3.369-2.416-8.059-0.008-8.059,4.138v45.293 c0,4.146,4.69,6.554,8.059,4.138l31.583-22.647C97.418,73.331,97.418,69.118,94.585,67.086z"></path> </g></svg>`
export const EYE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M15.0007 12C15.0007 13.6569 13.6576 15 12.0007 15C10.3439 15 9.00073 13.6569 9.00073 12C9.00073 10.3431 10.3439 9 12.0007 9C13.6576 9 15.0007 10.3431 15.0007 12Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.0012 5C7.52354 5 3.73326 7.94288 2.45898 12C3.73324 16.0571 7.52354 19 12.0012 19C16.4788 19 20.2691 16.0571 21.5434 12C20.2691 7.94291 16.4788 5 12.0012 5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function setChildren(parent: Element, children: Element[]): void {
    // We want to swap children around without removing them, since removing them will cause
    // a relayout and possibly break scroll positions.

    // Go through and add any new children.
    for (let i = 0; i < children.length; i++)
        if (children[i].parentNode !== parent)
            parent.appendChild(children[i]);

    // Remove any children that we don't want.
    for (let i = 0; i < parent.childElementCount;) {
        const child = parent.children.item(i)!;
        if (children.includes(child))
            i++;
        else
            parent.removeChild(child);
    }

    // Now the DOM node should only contain the children.
    assert(parent.childElementCount === children.length);

    // Put them in the right order by making as few moves as possible.
    for (let i = 0; i < children.length - 1; i++)
        if (parent.children.item(i) !== children[i])
            parent.insertBefore(children[i], parent.children.item(i));
}

function setElementVisible(elem: HTMLElement, v: boolean, normalDisplay = 'block') {
    elem.style.display = v ? normalDisplay : 'none';
}

export function setElementHighlighted(elem: HTMLElement, highlighted: boolean, normalTextColor: string = '') {
    if (highlighted) {
        elem.style.backgroundColor = HIGHLIGHT_COLOR;
        elem.style.color = 'black';
    } else {
        elem.style.backgroundColor = PANEL_BG_COLOR;
        elem.style.color = normalTextColor;
    }
}

export interface Flair {
    index: number;
    background?: string;
    color?: string;
    bulletColor?: string;
    extraHTML?: string;
    fontWeight?: string;
}

export interface Widget {
    elem: HTMLElement;
}

function svgStringToCSSBackgroundImage(svgString: string) {
    return `url(data:image/svg+xml,${encodeURI(svgString)})`;
}

export class TextField implements Widget {
    public textarea: HTMLInputElement;
    public elem: HTMLElement;

    constructor() {
        this.textarea = document.createElement('input');
        this.textarea.style.color = 'white';
        this.textarea.style.backgroundColor = 'transparent';
        this.textarea.style.font = '16px monospace';
        this.textarea.style.border = 'none';
        this.textarea.style.width = '100%';
        this.textarea.style.caretColor = 'white';

        this.elem = this.textarea;
    }

    public selectAll() {
        this.textarea.setSelectionRange(0, this.textarea.value.length);
        this.textarea.scrollLeft = 0;
    }

    public getValue() {
        return this.textarea.value;
    }

    public setValue(v: string) {
        this.textarea.value = v;
    }

    public setPlaceholder(placeholder: string): void {
        this.textarea.placeholder = placeholder;
    }
}

export class TextEntry implements Widget {
    public elem: HTMLElement;
    public ontext: ((string: string) => void) | null = null;
    public onfocus: (() => void) | null = null;

    protected toplevel: HTMLElement;
    public textfield: TextField;
    protected clearButton: HTMLElement;
    protected svgIcon: SVGSVGElement;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.position = 'relative';

        this.textfield = new TextField();
        const textarea = this.textfield.textarea;
        textarea.title = 'Search Bar';
        textarea.style.boxSizing = 'border-box';
        textarea.style.padding = '12px';
        textarea.style.paddingLeft = '32px';
        textarea.style.backgroundRepeat = 'no-repeat';
        textarea.style.backgroundPosition = '10px 14px';
        textarea.style.lineHeight = '20px';
        textarea.onkeydown = (e) => {
            if (e.code === 'Escape' && this.textfield.getValue().length > 0) {
                e.stopPropagation();
                this.clear();
            }
        };
        textarea.oninput = () => {
            this.textChanged();
        };
        textarea.onfocus = () => {
            if (this.onfocus !== null)
                this.onfocus();
        };
        this.toplevel.appendChild(this.textfield.elem);

        this.clearButton = document.createElement('div');
        this.clearButton.textContent = '🗙';
        this.clearButton.title = 'Clear';
        this.clearButton.style.color = 'white';
        this.clearButton.style.position = 'absolute';
        this.clearButton.style.width = '24px';
        this.clearButton.style.height = '24px';
        this.clearButton.style.right = '4px';
        this.clearButton.style.top = '12px';
        this.clearButton.style.bottom = '12px';
        this.clearButton.style.lineHeight = '20px';
        this.clearButton.style.cursor = 'pointer';
        this.clearButton.onclick = () => {
            this.clear();
        };
        this.syncClearButtonVisible();
        this.toplevel.appendChild(this.clearButton);

        this.elem = this.toplevel;
    }

    private syncClearButtonVisible(): void {
        this.clearButton.style.display = this.textfield.getValue().length > 0 ? '' : 'none';
    }

    public textChanged(): void {
        if (this.ontext !== null)
            this.ontext(this.textfield.getValue());
        this.syncClearButtonVisible();
    }

    public clear(): void {
        this.textfield.setValue('');
        this.textChanged();
    }

    public setIcon(icon: string): void {
        this.textfield.textarea.style.backgroundImage = svgStringToCSSBackgroundImage(icon);
    }

    public setPlaceholder(placeholder: string): void {
        this.textfield.setPlaceholder(placeholder);
    }
}

export enum ScrollSelectItemType {
    Selectable, Header,
}

interface ScrollSelectItemHeader {
    type: ScrollSelectItemType.Header;
    visible?: boolean;
    name?: string;
    html?: HTMLElement;
}

interface ScrollSelectItemSelectable {
    type: ScrollSelectItemType.Selectable;
    visible?: boolean;
    name?: string;
    html?: HTMLElement;
}

export type ScrollSelectItem = ScrollSelectItemHeader | ScrollSelectItemSelectable;

export abstract class ScrollSelect implements Widget {
    public elem: HTMLElement;

    protected toplevel: HTMLElement;
    protected scrollContainer: HTMLElement;
    protected flairs: Flair[] = [];
    protected internalFlairs: Flair[] = [];
    private isDragging: boolean = false;

    constructor() {
        this.toplevel = document.createElement('div');

        this.scrollContainer = document.createElement('div');
        this.setHeight(`200px`);
        this.setTextSelectable(false);
        this.scrollContainer.style.overflow = 'auto';
        this.toplevel.appendChild(this.scrollContainer);

        this.elem = this.toplevel;
    }

    public setTextSelectable(v: boolean): void {
        this.scrollContainer.style.userSelect = v ? '' : 'none'
    }

    public setHeight(height: string): void {
        this.scrollContainer.style.height = height;
    }

    protected getOuterForIndex(i: number): HTMLElement {
        return this.scrollContainer.children.item(i) as HTMLElement;
    }

    public focusItem(i: number): boolean {
        const outer = this.getOuterForIndex(i);
        if (!this.itemIsVisible(outer))
            return false;
        const selector = outer.querySelector('.selector') as HTMLElement;
        if (selector) {
            outer.focus();
            return true;
        } else {
            return false;
        }
    }

    public scrollItemIntoView(i: number): boolean {
        const outer = this.getOuterForIndex(i);
        if (!this.itemIsVisible(outer))
            return false;
        const selector = outer.querySelector('.selector') as HTMLElement;
        if (selector) {
            outer.scrollIntoView();
            return true;
        } else {
            return false;
        }
    }

    public setItems(items: ScrollSelectItem[]): void {
        this.scrollContainer.style.display = (items.length > 0) ? '' : 'none';
        while (this.scrollContainer.firstChild)
            this.scrollContainer.removeChild(this.scrollContainer.firstChild);
        let hasHeader = false;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            const outer = document.createElement('div');
            outer.tabIndex = -1;
            outer.style.display = 'grid';
            outer.style.gridAutoFlow = 'column';
            outer.style.outline = 'none';

            if (item.type === ScrollSelectItemType.Selectable) {
                outer.style.cursor = 'pointer';
                outer.style.paddingLeft = hasHeader ? '24px' : '';

                const selector = document.createElement('div');
                selector.classList.add('selector');
                selector.style.display = 'list-item';
                selector.style.lineHeight = '24px';
                selector.style.textShadow = `0 0 8px black`;
                outer.appendChild(selector);
                const textSpan = document.createElement('span');
                textSpan.classList.add('text');
                if (item.html !== undefined)
                    textSpan.appendChild(item.html);
                else if (item.name !== undefined)
                    textSpan.textContent = item.name;
                else
                    throw "whoops";
                selector.appendChild(textSpan);

                const index = i;
                outer.onfocus = () => {
                    this.itemFocused(index, !this.isDragging);
                };
                outer.onmousedown = () => {
                    if (document.activeElement === outer)
                        outer.onfocus!(null as unknown as FocusEvent);
                    else
                        outer.focus();
                    this.isDragging = true;
                };
                outer.onmouseup = () => {
                    this.isDragging = false;
                };
                outer.onmouseenter = (e) => {
                    if (e.buttons === 0)
                        this.isDragging = false;
                    if (this.isDragging)
                        outer.focus();
                };
            } else if (item.type === ScrollSelectItemType.Header) {
                outer.dataset.header = '1';
                const textSpan = document.createElement('span');
                textSpan.classList.add('header');
                textSpan.style.fontWeight = 'bold';
                textSpan.style.lineHeight = `36px`;
                textSpan.style.textShadow = `0 0 8px black`;
                textSpan.style.verticalAlign = `baseline`;
                const expandButton = document.createElement('span');
                expandButton.textContent = `-`;
                expandButton.style.display = `inline-block`;
                expandButton.style.paddingRight = `8px`;
                expandButton.style.width = `8px`;
                expandButton.style.cursor = `pointer`;
                let expanded = true;
                const setExpanded = (v: boolean) => {
                    expanded = v;
                    expandButton.textContent = expanded ? `-` : `+`;
                    for (let sib = outer.nextElementSibling; ; sib = sib?.nextElementSibling ?? null) {
                        if (sib === null)
                            break;
                        const sibH = sib as HTMLElement;
                        if (sibH.dataset.header)
                            break;
                        sibH.style.display = expanded ? `block` : `none`;
                    }
                };
                expandButton.onclick = () => {
                    setExpanded(!expanded);
                };
                textSpan.appendChild(expandButton);

                if (item.html !== undefined)
                    textSpan.appendChild(item.html);
                else if (item.name !== undefined)
                    textSpan.appendChild(document.createTextNode(item.name));
                else
                    throw "whoops";
                outer.appendChild(textSpan);
                hasHeader = true;
            }

            const extraSlot = document.createElement('span');
            extraSlot.classList.add('extra');
            extraSlot.style.justifySelf = 'end';
            outer.appendChild(extraSlot);

            if (item.visible !== undefined)
                this._setItemVisible(outer, item.visible);

            this.scrollContainer.appendChild(outer);
        }

        this.computeHeaderVisibility();
    }

    public setStrings(strings: string[]): void {
        this.setItems(strings.map((string): ScrollSelectItem => {
            return { type: ScrollSelectItemType.Selectable, name: string };
        }));
    }

    protected itemIsHeader(outer: HTMLElement): boolean {
        const header = outer.querySelector('span.header');
        return !!header;
    }

    protected itemIsVisible(outer: HTMLElement): boolean {
        return outer.style.display !== 'none';
    }

    public computeHeaderVisibility(): void {
        const n = this.getNumItems();
        for (let i = 0; i < n;) {
            const outer = this.getOuterForIndex(i);

            if (this.itemIsHeader(outer)) {
                // Find next header.
                let j = i + 1;
                let shouldBeVisible = false;
                for (; j < n; j++) {
                    const outer = this.getOuterForIndex(j);
                    if (this.itemIsHeader(outer))
                        break;
                    if (this.itemIsVisible(outer)) {
                        shouldBeVisible = true;
                        break;
                    }
                }
                this._setItemVisible(outer, shouldBeVisible);
                i = j;
            } else
                i++;
        }
    }

    private _setItemVisible(outer: HTMLElement, v: boolean) {
        outer.style.display = v ? 'grid' : 'none';
    }

    public setItemVisible(i: number, v: boolean): void {
        const outer = this.scrollContainer.children.item(i) as HTMLElement;
        this._setItemVisible(outer, v);
    }

    public getNumItems() {
        return this.scrollContainer.childElementCount;
    }

    public setFlairs(flairs: Flair[]) {
        this.flairs = flairs;
        this.syncInternalFlairs();
    }

    protected abstract syncInternalFlairs(): void;

    protected setInternalFlairs(flairs: Flair[]) {
        this.internalFlairs = flairs;
        this.syncFlairDisplay();
    }

    private syncFlairDisplay(): void {
        const flairs = this.internalFlairs;
        for (let i = 0; i < this.getNumItems(); i++) {
            const outer = this.getOuterForIndex(i);

            const selector = outer.firstElementChild as HTMLElement;
            if (!selector.classList.contains('selector'))
                continue;

            const flair = flairs.find((flair) => flair.index === i);

            const background = (flair !== undefined && flair.background !== undefined) ? flair.background : '';
            outer.style.background = background;
            const textSpan = assertExists(outer.querySelector('span.text') as HTMLElement);
            const color = (flair !== undefined && flair.color !== undefined) ? flair.color : '';
            textSpan.style.color = color;
            const fontWeight = (flair !== undefined && flair.fontWeight !== undefined) ? flair.fontWeight : '';
            textSpan.style.fontWeight = fontWeight;

            if (flair !== undefined && flair.bulletColor !== undefined) {
                selector.style.listStyleType = 'disc';
                selector.style.listStylePosition = 'inside';
                selector.style.paddingLeft = `4px`;
                selector.style.color = flair.bulletColor;
            } else {
                selector.style.listStyleType = 'none';
                selector.style.color = '';
            }

            const extraHTML = (flair !== undefined && flair.extraHTML) ? flair.extraHTML : '';
            const extraSpan = assertExists(outer.querySelector('span.extra') as HTMLElement);
            extraSpan.innerHTML = extraHTML;
        }
    }

    protected abstract itemFocused(index: number, first: boolean): void;
}

export function ensureFlairIndex(flairs: Flair[], index: number): Flair {
    const flairIndex = flairs.findIndex((f) => f.index === index);
    if (flairIndex >= 0) {
        flairs[flairIndex] = Object.assign({}, flairs[flairIndex]);
        return flairs[flairIndex];
    } else {
        const flair = { index };
        flairs.push(flair);
        return flair;
    }
}

export class SingleSelect extends ScrollSelect {
    public highlightedIndex: number = -1;
    public onselectionchange: (index: number) => void;
    public setHighlightFlair = true;

    constructor() {
        super();

        this.toplevel.onkeydown = (e: KeyboardEvent) => {
            let handled = false;
            if (e.code === 'ArrowUp')
                handled = this.navigate(-1);
            else if (e.code === 'ArrowDown')
                handled = this.navigate(1);
            if (handled) {
                e.stopPropagation();
                e.preventDefault();
            }
        };
    }

    private navigate(direction: number): boolean {
        const n = this.getNumItems();
        let newIndex = this.highlightedIndex;
        // If it's not visible, reset us to the beginning/end.
        if (newIndex < 0 || newIndex >= n || !this.itemIsVisible(this.getOuterForIndex(newIndex))) {
            if (direction > 0)
                newIndex = 0;
            else if (direction < 0)
                newIndex = n - 1;
        } else {
            newIndex += direction;
        }
        while (true) {
            if (newIndex < 0 || newIndex >= n)
                break;
            if (this.focusItem(newIndex))
                break;
            newIndex += direction;
        }
        return true;
    }

    public scrollFocus(): void {
        if (this.highlightedIndex !== -1)
            this.scrollItemIntoView(this.highlightedIndex);
    }

    public override setItems(items: ScrollSelectItem[]): void {
        this.highlightedIndex = -1;
        super.setItems(items);
    }

    public itemFocused(index: number, first: boolean) {
        this.selectItem(index);
    }

    public selectItem(index: number) {
        this.setHighlighted(index);
        this.onselectionchange(index);
    }

    public setHighlighted(highlightedIndex: number) {
        if (this.highlightedIndex === highlightedIndex)
            return;
        this.highlightedIndex = highlightedIndex;
        this.syncInternalFlairs();
    }

    protected syncInternalFlairs(): void {
        const flairs = [...this.flairs];
        if (this.setHighlightFlair && this.highlightedIndex >= 0) {
            const flair = ensureFlairIndex(flairs, this.highlightedIndex);
            flair.background = HIGHLIGHT_COLOR;
            flair.fontWeight = 'bold';
        }
        this.setInternalFlairs(flairs);
    }
}

export class MultiSelect extends ScrollSelect {
    public itemIsOn: boolean[] = [];
    public onitemchanged: (index: number, v: boolean) => void;
    private itemShouldBeOn: boolean;

    constructor() {
        super();

        const allNone = createDOMFromString(`
<div style="display: grid; grid-template-columns: 1fr 1fr; grid-gap: 4px;">
<style>
.AllButton, .NoneButton {
    text-align: center;
    line-height: 32px;
    cursor: pointer;
    background: #666;
    font-weight: bold;
    user-select: none;
}
</style>
<div class="AllButton">All</div><div class="NoneButton">None</div>
</div>
`);
        this.toplevel.insertBefore(allNone, this.toplevel.firstChild);

        const allButton = this.toplevel.querySelector('.AllButton') as HTMLElement;
        allButton.onclick = () => {
            for (let i = 0; i < this.getNumItems(); i++)
                this.setItemIsOn(i, true);
            this.syncInternalFlairs();
        };
        const noneButton = this.toplevel.querySelector('.NoneButton') as HTMLElement;
        noneButton.onclick = () => {
            for (let i = 0; i < this.getNumItems(); i++)
                this.setItemIsOn(i, false);
            this.syncInternalFlairs();
        };
    }

    private setItemIsOn(index: number, v: boolean) {
        this.itemIsOn[index] = v;
        this.onitemchanged(index, this.itemIsOn[index]);
    }

    public itemFocused(index: number, first: boolean) {
        if (first)
            this.itemShouldBeOn = !this.itemIsOn[index];
        this.setItemIsOn(index, this.itemShouldBeOn);
        this.syncInternalFlairs();
    }

    protected syncInternalFlairs() {
        const flairs: Flair[] = [...this.flairs];
        for (let i = 0; i < this.getNumItems(); i++) {
            const flair = ensureFlairIndex(flairs, i);
            flair.bulletColor = !!this.itemIsOn[i] ? HIGHLIGHT_COLOR : '#aaa';
            flair.color = !!this.itemIsOn[i] ? 'white' : '#aaa';
        }
        this.setInternalFlairs(flairs);
    }

    public setItemsSelected(isOn: boolean[]) {
        this.itemIsOn = isOn;
        this.syncInternalFlairs();
    }

    public setItemSelected(index: number, v: boolean) {
        this.itemIsOn[index] = v;
        this.syncInternalFlairs();
    }
}

export class Checkbox implements Widget {
    public elem: HTMLElement;
    public checked: boolean = false;
    public onchanged: (() => void) | null = null;

    private toplevel: HTMLElement;
    private label: HTMLElement;
    private emblem: HTMLElement;

    constructor(label: string = '', initiallyChecked: boolean = false) {
        this.toplevel = document.createElement('div');
        this.toplevel.style.display = 'grid';
        this.toplevel.style.gridTemplateColumns = '1fr 24px';
        this.toplevel.style.alignItems = 'center';
        this.toplevel.style.cursor = 'pointer';
        this.toplevel.onclick = this._toggle.bind(this);

        this.label = document.createElement('div');
        this.label.style.userSelect = 'none';
        this.toplevel.appendChild(this.label);

        this.emblem = document.createElement('div');
        this.emblem.style.width = '10px';
        this.emblem.style.height = '10px';
        this.emblem.style.justifySelf = 'center';
        this.emblem.style.margin = '4px';
        this.emblem.style.borderRadius = '4px';
        this.emblem.style.border = '2px solid white';
        this.toplevel.appendChild(this.emblem);

        this.setLabel(label);
        this.setChecked(initiallyChecked);

        this.elem = this.toplevel;
    }

    public setChecked(v: boolean): void {
        this.checked = v;

        if (this.checked) {
            this.emblem.style.backgroundColor = HIGHLIGHT_COLOR;
            this.emblem.style.borderColor = 'white';
            this.label.style.fontWeight = 'bold';
            this.label.style.color = 'white';
        } else {
            this.emblem.style.backgroundColor = 'transparent';
            this.emblem.style.borderColor = '#aaa';
            this.label.style.fontWeight = '';
            this.label.style.color = '#aaa';
        }
    }

    private _toggle(): void {
        this.setChecked(!this.checked);
        if (this.onchanged !== null)
            this.onchanged();
    }

    public setLabel(text: string): void {
        this.label.textContent = text;
    }
}

export class Panel implements Widget {
    public elem: HTMLElement;

    public expanded: boolean | null = null;
    public manuallyExpanded: boolean = false;
    public autoClosed: boolean = false;
    public customHeaderBackgroundColor: string = '';
    protected header: HTMLElement;
    protected headerContainer: HTMLElement;
    protected svgIcon: SVGSVGElement;

    private toplevel: HTMLElement;
    private ignoreAutoCloseTimeout: number = 0;
    public extraRack: HTMLElement;
    public mainPanel: HTMLElement;
    public contents: HTMLElement;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.color = 'white';
        this.toplevel.style.font = '16px monospace';
        this.toplevel.style.overflow = 'hidden';
        this.toplevel.style.display = 'grid';
        this.toplevel.style.gridAutoFlow = 'column';
        this.toplevel.style.gap = '20px';
        this.toplevel.style.transition = '.25s ease-out';
        this.toplevel.style.alignItems = 'start';
        this.toplevel.style.outline = 'none';
        this.toplevel.onkeydown = this.onKeyDown.bind(this);
        this.toplevel.onmouseenter = this.syncSize.bind(this);
        this.toplevel.onmouseleave = this.syncSize.bind(this);
        this.toplevel.tabIndex = -1;

        this.mainPanel = document.createElement('div');
        this.mainPanel.style.overflow = 'hidden';
        this.mainPanel.style.transition = '.25s ease-out';
        this.mainPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.toplevel.appendChild(this.mainPanel);

        this.extraRack = document.createElement('div');
        this.extraRack.style.gridAutoFlow = 'column';
        this.extraRack.style.gap = '20px';
        this.extraRack.style.transition = '.15s ease-out .10s';
        this.toplevel.appendChild(this.extraRack);

        this.headerContainer = document.createElement('div');
        this.mainPanel.appendChild(this.headerContainer);

        this.header = document.createElement('h1');
        this.header.style.lineHeight = '28px';
        this.header.style.width = '440px';
        this.header.style.margin = '0';
        this.header.style.fontSize = '100%';
        this.header.style.cursor = 'pointer';
        this.header.style.userSelect = 'none';
        this.header.style.display = 'grid';
        this.header.style.gridTemplateColumns = '28px 1fr';
        this.header.style.alignItems = 'center';
        this.header.style.justifyItems = 'center';
        this.header.style.gridAutoFlow = 'column';
        this.header.onclick = () => {
            if (this.ignoreAutoCloseTimeout > 0) {
                this.ignoreAutoCloseTimeout = 0;
                return;
            }

            this.toggleExpanded();
        };
        this.headerContainer.appendChild(this.header);

        this.contents = document.createElement('div');
        this.contents.style.width = '440px';
        this.mainPanel.appendChild(this.contents);

        this.elem = this.toplevel;
    }

    protected onKeyDown(e: KeyboardEvent): void {
        if (e.code === 'Escape' && this.expanded) {
            e.preventDefault();
            e.stopPropagation();
            this.setExpanded(false);
        }
    }

    private syncSize() {
        const widthExpanded = this.expanded || this.mainPanel.matches(':hover');
        this.mainPanel.style.width = widthExpanded ? '440px' : '28px';

        const heightExpanded = this.expanded;
        if (heightExpanded) {
            const height = Math.max(this.header.offsetHeight + this.contents.offsetHeight, this.extraRack.offsetHeight);
            this.toplevel.style.height = `${height}px`;
            this.extraRack.style.opacity = '1';
            this.extraRack.style.width = 'auto';
        } else {
            this.toplevel.style.transition = '.25s ease-out';
            this.toplevel.style.height = '28px';
            this.extraRack.style.opacity = '0';
            this.extraRack.style.width = '0';
        }
    }

    public setVisible(v: boolean) {
        this.toplevel.style.display = v ? 'grid' : 'none';
    }

    public setTitle(icon: string, title: string) {
        this.svgIcon = createDOMFromString(icon).querySelector('svg')!;
        this.svgIcon.style.gridColumn = '1';
        this.header.textContent = title;
        this.header.appendChild(this.svgIcon);
        this.toplevel.dataset.title = title;

        this.setExpanded(false);
    }

    protected syncHeaderStyle() {
        if (this.customHeaderBackgroundColor) {
            this.svgIcon.style.fill = '';
            this.header.style.backgroundColor = this.customHeaderBackgroundColor;
            this.header.style.color = 'white';
        } else {
            this.svgIcon.style.fill = this.expanded ? 'black' : '';
            setElementHighlighted(this.header, !!this.expanded, HIGHLIGHT_COLOR);
        }
    }

    public syncExpanded(): boolean {
        const newExpanded = this.manuallyExpanded && !this.autoClosed;
        if (this.expanded === newExpanded)
            return false;
        this.expanded = newExpanded;
        this.syncHeaderStyle();
        this.syncSize();
        if (!this.expanded)
            document.body.focus();
        return true;
    }

    public setExpanded(v: boolean, focus: boolean = true) {
        this.manuallyExpanded = v;
        this.syncExpanded();
        if (this.expanded && focus)
            this.elem.focus();
    }

    private toggleExpanded() {
        this.setExpanded(!this.expanded);
    }

    public setAutoClosed(v: boolean) {
        if (this.autoClosed === v)
            return;
        this.autoClosed = v;
        const changed = this.syncExpanded();
        if (changed && this.expanded) {
            // If we're coming back from auto-closing, then start a timeout to ignore clicks during this time.
            this.ignoreAutoCloseTimeout = window.setTimeout(() => {
                this.ignoreAutoCloseTimeout = 0;
            }, 250);
        }
    }
}

export interface TextureListHolder {
    textureNames: string[];
    getViewerTexture(i: number): Promise<Viewer.Texture>;

    onnewtextures: (() => void) | null;
}

export class Slider implements Widget {
    private toplevel: HTMLElement;
    private sliderInput: HTMLInputElement;

    public elem: HTMLElement;
    public onvalue: ((value: number) => void) | null = null;

    constructor(label?: string, value?: number, min?: number, max?: number) {
        this.toplevel = document.createElement('div');

        // DOM lacks a coherent way of adjusting pseudostyles, so this is what we end up with...
        this.toplevel.innerHTML = `
<style>
.Slider {
    -webkit-appearance: none;
    width: 100%;
    margin: 0;
}
.Slider::-moz-range-thumb {
    width: 16px;
    height: 24px;
    cursor: pointer;
    background: ${HIGHLIGHT_COLOR};
    border-radius: 0;
    border: none;
}
.Slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 24px;
    cursor: pointer;
    background: ${HIGHLIGHT_COLOR};
    border-radius: 0;
    border: none;
}
.Slider::-moz-range-track {
    cursor: pointer;
    height: 24px;
    background: #444;
}
.Slider::-webkit-slider-runnable-track {
    cursor: pointer;
    height: 24px;
    background: #444;
}
</style>
<div style="display: grid; grid-template-columns: 1fr 1fr; align-items: center">
<div style="font-weight: bold; user-select: none" class="Label"></div>
<input class="Slider" type="range">
</div>
`;

        this.sliderInput = this.toplevel.querySelector('.Slider') as HTMLInputElement;
        this.sliderInput.oninput = this.onInput.bind(this);

        this.elem = this.toplevel;

        if (label !== undefined)
            this.setLabel(label);
        if (min !== undefined && max !== undefined)
            this.setRange(min, max);
        if (value !== undefined)
            this.setValue(value, false);
    }

    private onInput(): void {
        if (this.onvalue !== null)
            this.onvalue(this.getValue());
    }

    public setRange(min: number, max: number, step: number = (max - min) / 100) {
        this.sliderInput.min = '' + min;
        this.sliderInput.max = '' + max;
        this.sliderInput.step = '' + step;
    }

    public setLabel(label: string): void {
        this.toplevel.querySelector('.Label')!.textContent = label;
    }

    public getValue(): number {
        return +this.sliderInput.value;
    }

    public setValue(v: number, triggerCallback: boolean = false): void {
        this.sliderInput.value = '' + v;
        if (triggerCallback)
            this.onInput();
    }

    public getT(): number {
        return invlerp(+this.sliderInput.min, +this.sliderInput.max, +this.sliderInput.value);
    }

    public setT(t: number): void {
        const v = lerp(+this.sliderInput.min, +this.sliderInput.max, t);
        this.setValue(v);
    }
}

const SUN_ICON_PATH = `M12 2L13.09 8.26L18 5L14.74 9.91L21 11L14.74 12.09L18 17L13.09 13.74L12 20L10.91 13.74L6 17L9.26 12.09L3 11L9.26 9.91L6 5L10.91 8.26L12 2Z`;
const MOON_ICON_PATH = `M12 3c.132 0 .263.004.393.012a7 7 0 1 0 8.595 8.595A8 8 0 1 1 12 3z`;

export class CircularTimeSlider implements Widget {
    public elem: HTMLElement;
    public onvalue: ((value: number) => void) | null = null;
    public onmanualchange: (() => void) | null = null;

    private svg: SVGSVGElement;
    private thumb: SVGCircleElement;
    private timeLabel: HTMLElement;
    private value: number = 0;
    private isDragging: boolean = false;

    // Dial dimensions
    private readonly size = 120;
    private readonly cx = 60;
    private readonly cy = 60;
    private readonly radius = 45;
    private readonly thumbRadius = 8;

    constructor() {
        const toplevel = document.createElement('div');
        toplevel.style.display = 'flex';
        toplevel.style.flexDirection = 'column';
        toplevel.style.alignItems = 'center';
        toplevel.style.padding = '8px';
        toplevel.style.userSelect = 'none';

        // Create SVG dial
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('width', `${this.size}`);
        this.svg.setAttribute('height', `${this.size}`);
        this.svg.setAttribute('viewBox', `0 0 ${this.size} ${this.size}`);
        this.svg.style.cursor = 'pointer';

        // Background circle (track)
        const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        track.setAttribute('cx', `${this.cx}`);
        track.setAttribute('cy', `${this.cy}`);
        track.setAttribute('r', `${this.radius}`);
        track.setAttribute('fill', 'none');
        track.setAttribute('stroke', '#333');
        track.setAttribute('stroke-width', '12');
        this.svg.appendChild(track);

        // Day arc (top half)
        const dayArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dayPath = this.describeArc(this.cx, this.cy, this.radius, Math.PI, MathConstants.TAU);
        dayArc.setAttribute('d', dayPath);
        dayArc.setAttribute('fill', 'none');
        dayArc.setAttribute('stroke', '#e8a430');
        dayArc.setAttribute('stroke-width', '10');
        dayArc.setAttribute('stroke-linecap', 'round');
        this.svg.appendChild(dayArc);

        // Night arc (bottom half)
        const nightArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const nightPath = this.describeArc(this.cx, this.cy, this.radius, 0, Math.PI);
        nightArc.setAttribute('d', nightPath);
        nightArc.setAttribute('fill', 'none');
        nightArc.setAttribute('stroke', '#2a3a5a');
        nightArc.setAttribute('stroke-width', '10');
        nightArc.setAttribute('stroke-linecap', 'round');
        this.svg.appendChild(nightArc);

        // Sun icon at top (noon position)
        const sunGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        sunGroup.setAttribute('transform', `translate(${this.cx - 8}, ${this.cy - this.radius - 8}) scale(0.7)`);
        const sunPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        sunPath.setAttribute('d', SUN_ICON_PATH);
        sunPath.setAttribute('fill', '#ffd700');
        sunGroup.appendChild(sunPath);
        this.svg.appendChild(sunGroup);

        // Moon icon at bottom (midnight position)
        const moonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        moonGroup.setAttribute('transform', `translate(${this.cx - 6}, ${this.cy + this.radius - 6}) scale(0.5)`);
        const moonPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        moonPath.setAttribute('d', MOON_ICON_PATH);
        moonPath.setAttribute('fill', '#aaccff');
        moonGroup.appendChild(moonPath);
        this.svg.appendChild(moonGroup);

        // Thumb (draggable indicator)
        this.thumb = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.thumb.setAttribute('r', `${this.thumbRadius}`);
        this.thumb.setAttribute('fill', HIGHLIGHT_COLOR);
        this.thumb.setAttribute('stroke', 'white');
        this.thumb.setAttribute('stroke-width', '2');
        this.thumb.style.cursor = 'grab';
        this.svg.appendChild(this.thumb);

        toplevel.appendChild(this.svg);

        // Time label below dial
        this.timeLabel = document.createElement('div');
        this.timeLabel.style.marginTop = '8px';
        this.timeLabel.style.fontSize = '14px';
        this.timeLabel.style.fontWeight = 'bold';
        this.timeLabel.style.color = 'white';
        toplevel.appendChild(this.timeLabel);

        this.elem = toplevel;

        // Set up event handlers
        this.svg.addEventListener('mousedown', this.onMouseDown.bind(this));
        document.addEventListener('mousemove', this.onMouseMove.bind(this));
        document.addEventListener('mouseup', this.onMouseUp.bind(this));

        // Initial position
        this.updateThumbPosition();
        this.updateTimeLabel();
    }

    private describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number): string {
        const start = this.polarToCartesian(x, y, radius, endAngle);
        const end = this.polarToCartesian(x, y, radius, startAngle);
        const largeArcFlag = (endAngle - startAngle) <= Math.PI ? '0' : '1';
        return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
    }

    private polarToCartesian(cx: number, cy: number, radius: number, angle: number): { x: number, y: number } {
        return {
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
        };
    }

    // Convert normalized time (0-1) to angle in radians.
    private timeToAngle(t: number): number {
        return MathConstants.TAU * (t + 0.25);
    }

    // Convert angle in radians to normalized time (0-1).
    private angleToTime(angle: number): number {
        return (angle / MathConstants.TAU + 0.75) % 1;
    }

    private updateThumbPosition(): void {
        const angle = this.timeToAngle(this.value);
        const pos = this.polarToCartesian(this.cx, this.cy, this.radius, angle);
        this.thumb.setAttribute('cx', `${pos.x}`);
        this.thumb.setAttribute('cy', `${pos.y}`);
    }

    private updateTimeLabel(): void {
        const totalHours = this.value * 24;
        const hours24 = Math.floor(totalHours) % 24;
        const minutes = Math.floor((totalHours - Math.floor(totalHours)) * 60);

        const hours12 = hours24 % 12 || 12;
        const ampm = hours24 < 12 ? 'AM' : 'PM';
        const minuteStr = minutes.toString().padStart(2, '0');

        this.timeLabel.textContent = `${hours12}:${minuteStr} ${ampm}`;
    }

    private onMouseDown(e: MouseEvent): void {
        this.isDragging = true;
        this.thumb.style.cursor = 'grabbing';
        this.updateValueFromMouse(e);
        e.preventDefault();
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.isDragging) return;
        this.updateValueFromMouse(e);
    }

    private onMouseUp(): void {
        if (this.isDragging) {
            this.isDragging = false;
            this.thumb.style.cursor = 'grab';
        }
    }

    private updateValueFromMouse(e: MouseEvent): void {
        const rect = this.svg.getBoundingClientRect();
        const x = e.clientX - rect.left - this.cx;
        const y = e.clientY - rect.top - this.cy;

        // Calculate angle from center to mouse position
        const angle = Math.atan2(y, x);
        const newValue = this.angleToTime(angle);

        if (newValue !== this.value) {
            this.value = newValue;
            this.updateThumbPosition();
            this.updateTimeLabel();

            if (this.onmanualchange !== null)
                this.onmanualchange();

            if (this.onvalue !== null)
                this.onvalue(this.value);
        }
    }

    public getValue(): number {
        return this.value;
    }

    public setValue(v: number, triggerCallback: boolean = false): void {
        this.value = clamp(v, 0, 1);
        this.updateThumbPosition();
        this.updateTimeLabel();

        if (triggerCallback && this.onvalue !== null)
            this.onvalue(this.value);
    }
}

export class TimeOfDayPanel extends Panel {
    public onvaluechange: ((time: number, useDynamicTime: boolean) => void) | null = null;

    private slider: CircularTimeSlider;
    private dynamicTimeCheckbox: Checkbox;
    private useDynamicTime: boolean = true;

    constructor() {
        super();

        this.setTitle(TIME_OF_DAY_ICON, 'Time of Day');
        this.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        this.syncHeaderStyle();

        // "Dynamic Time" checkbox
        this.dynamicTimeCheckbox = new Checkbox('Dynamic Time', true);
        this.dynamicTimeCheckbox.onchanged = () => {
            this.useDynamicTime = this.dynamicTimeCheckbox.checked;
            if (this.onvaluechange !== null)
                this.onvaluechange(this.slider.getValue(), this.useDynamicTime);
        };
        this.contents.appendChild(this.dynamicTimeCheckbox.elem);

        // Circular time slider
        this.slider = new CircularTimeSlider();

        // When user manually changes the slider, disable dynamic time
        this.slider.onmanualchange = () => {
            if (this.useDynamicTime) {
                this.useDynamicTime = false;
                this.dynamicTimeCheckbox.setChecked(false);
            }
        };

        this.slider.onvalue = (value: number) => {
            if (this.onvaluechange !== null)
                this.onvaluechange(value, this.useDynamicTime);
        };

        this.contents.appendChild(this.slider.elem);
    }

    // Set normalized time (0-1)
    public setTime(time: number): void {
        this.slider.setValue(time);
    }
}

export class RadioButtons implements Widget {
    public elem: HTMLElement;
    public selectedIndex: number = -1;
    public onselectedchange: ((() => void) | null) = null;
    public options: HTMLElement[] = [];

    constructor(private title: string, optionNames: string[]) {
        this.elem = document.createElement('div');

        this.elem.style.display = 'grid';
        this.elem.style.alignItems = 'center';

        if (title.length) {
            const header = document.createElement('div');
            header.style.fontWeight = 'bold';
            header.textContent = title;
            this.elem.appendChild(header);
        }

        this.setOptions(optionNames);
    }

    public setOptions(optionNames: string[]): void {
        const fr = (this.title.length ? `${optionNames.length}fr ` : ``) + `${optionNames.map(() => '1fr').join(' ')}`;
        this.elem.style.gridTemplateColumns = fr;

        optionNames.forEach((optionName, i) => {
            const option = document.createElement('div');
            option.style.fontWeight = `bold`;
            option.style.textAlign = `center`;
            option.style.lineHeight = `24px`;
            option.style.cursor = `pointer`;
            option.textContent = optionName;
            option.onclick = () => {
                this.setSelectedIndex(i);
            };

            this.elem.appendChild(option);
            this.options.push(option);
        });

        this.selectedIndex = -1;
    }

    public setVisible(v: boolean) {
        this.elem.style.display = v ? 'grid' : 'none';
    }

    private sync(): void {
        this.options.forEach((option, i) => {
            setElementHighlighted(option, i === this.selectedIndex);
        });
    }

    public setSelectedIndex(i: number): void {
        if (this.selectedIndex === i)
            return;

        this.selectedIndex = i;
        this.sync();

        if (this.onselectedchange !== null)
            this.onselectedchange();
    }
}

export interface Layer {
    name: string;
    visible: boolean;
    setVisible(v: boolean): void;
}

export class LayerPanel extends Panel {
    public multiSelect: MultiSelect;
    private layers: Layer[] = [];
    public onlayertoggled: (() => void) | null = null;

    constructor(layers: Layer[] | null = null) {
        super();
        this.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        this.setTitle(LAYER_ICON, 'Layers');
        this.multiSelect = new MultiSelect();
        this.multiSelect.onitemchanged = this._onItemChanged.bind(this);
        this.contents.appendChild(this.multiSelect.elem);
        if (layers !== null)
            this.setLayers(layers);
    }

    private _onItemChanged(index: number, visible: boolean): void {
        this.layers[index].setVisible(visible);
        if (this.onlayertoggled !== null)
            this.onlayertoggled();
    }

    public syncLayerVisibility(): void {
        const isOn = this.layers.map((layer) => layer.visible);
        this.multiSelect.setItemsSelected(isOn);
    }

    public setLayers(layers: Layer[]): void {
        this.layers = layers;
        const strings = layers.map((layer) => layer.name);
        this.multiSelect.setStrings(strings);
        this.syncLayerVisibility();
        this.setVisible(layers.length > 1);
    }
}

