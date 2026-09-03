// Per-object dropdown option tables used by the object setup inspector.
// Extracted from src/ui/App.tsx.

export const itemBoxSettingOptions = [
  { value: 0x0000, label: 'Default Item Set' },
  { value: 0x0001, label: 'Banana' },
  { value: 0x0002, label: 'Mushroom' },
  { value: 0x0003, label: 'Triple Mushrooms' },
  { value: 0x0004, label: 'Star' },
  { value: 0x0005, label: 'Triple Green Shells' },
  { value: 0x0006, label: 'Banana / Mushroom (50/50)' },
  { value: 0x0007, label: 'Green Shell' },
  { value: 0x0008, label: 'Bob-omb' },
  { value: 0x0009, label: 'Red Shell' },
  { value: 0x000a, label: 'Mega Mushroom' },
  { value: 0x000b, label: 'Thunder Cloud' },
  { value: 0x000c, label: 'Star (95%) / Mushroom (5%)' },
  { value: 0x000d, label: 'Empty -> Mushroom' },
  { value: 0x000e, label: 'Empty -> Mushroom' },
  { value: 0x000f, label: 'Empty -> Mushroom' },
  { value: 0x0010, label: 'Empty -> Mushroom' },
  { value: 0x0255, label: 'Default Item Set (alternate value some tracks use)' },
];
export const itemBoxTimingOptions = [
  { value: 0x0000, label: 'Normal Roulette, Fast Respawn' },
  { value: 0x0002, label: 'Short Roulette, Fast Respawn' },
  { value: 0x0003, label: 'Short Roulette, Fast Respawn' },
  { value: 0x0004, label: 'Short Roulette, Medium Respawn' },
  { value: 0x0005, label: 'Normal Roulette, Medium Respawn' },
  { value: 0x0006, label: 'Normal Roulette, Slow Respawn' },
];
export const driveableRingIdOptions = [
  { value: 1, label: 'Outer Ring' },
  { value: 2, label: 'Middle Ring' },
  { value: 3, label: 'Inner Ring' },
];
export const epropellerDirectionOptions = [
  { value: 0, label: 'Clockwise' },
  { value: 1, label: 'Counterclockwise' },
];
export const crabDirectionOptions = [
  { value: 0, label: 'Face Left' },
  { value: 1, label: 'Face Right' },
];
export const spinDirectionOptions = [
  { value: 0, label: 'Clockwise' },
  { value: 1, label: 'Counterclockwise' },
];
export const thwompBehaviorOptions = [
  { value: 0, label: 'No Route Behavior' },
  { value: 1, label: 'Stomp On Every Route Point' },
  { value: 2, label: 'Paired Side-Swing Thwomps' },
  { value: 3, label: 'Grounded Side-Swing Thwomp' },
];
export const twanwanStartModeOptions = [
  { value: 0, label: 'Wait On First Route Point' },
  { value: 1, label: 'Start At Object Position + Release' },
];
export const kartTruckTextureOptions = [
  { value: 0, label: 'Moo Moo' },
  { value: 1, label: 'Fruit' },
  { value: 2, label: 'Factory' },
];
export const carBodyColorOptions = [
  { value: 0, label: 'Blue' },
  { value: 1, label: 'Red' },
  { value: 2, label: 'Yellow' },
];
export const truckWagonCollisionOptions = [
  { value: 0, label: 'Collision Enabled' },
  { value: 1, label: 'No Collision / LOD Model' },
];
export const shyGuyColorOptions = [
  { value: 0, label: 'Red' },
  { value: 1, label: 'Yellow' },
  { value: 2, label: 'Green' },
];
export const chairliftModelOptions = [
  { value: 0, label: 'K_chairlift00' },
  { value: 1, label: 'K_chairlift01' },
];
export const cataquackColorOptions = [
  { value: 0, label: 'Blue' },
  { value: 1, label: 'Red' },
  { value: 2, label: 'Violet' },
  { value: 3, label: 'Green' },
];
export const pylonColorOptions = [
  { value: 0, label: 'Red' },
  { value: 1, label: 'Blue' },
  { value: 2, label: 'Yellow' },
];
export const miiSpectatorInteractionOptions = [
  { value: 0, label: 'Static Crowd' },
  { value: 1, label: 'Face Player And Clap' },
];
export const topmanBehaviorOptions = [
  { value: 0, label: 'Default / Unknown' },
  { value: 1, label: 'Coward' },
  { value: 2, label: 'Aggressive' },
];
export const coinModeOptions = [
  { value: 0, label: 'Battle' },
  { value: 1, label: 'Tournament / Mission' },
];
export const directItemOptions = [
  { value: 0, label: 'Green Shell' },
  { value: 1, label: 'Red Shell' },
  { value: 2, label: 'Banana' },
  { value: 3, label: 'Mushroom' },
  { value: 4, label: 'Star' },
];
export const beltCurveStartSideOptions = [
  { value: 0, label: 'Fast Side Starts On Right' },
  { value: 1, label: 'Fast Side Starts On Left' },
];
export const audienceFlashWaluigiOptions = [
  { value: 0, label: 'Flash Waluigi A' },
  { value: 1, label: 'Flash Waluigi B' },
  { value: 2, label: 'Flash Waluigi C' },
];
export const audienceFlashSkateOptions = [
  { value: 0, label: 'Flash Skate A' },
  { value: 1, label: 'Flash Skate B' },
];
/**
 * The three player-count modes an object can appear in.
 *
 * `label` is the short chip used in compact controls; `friendlyLabel` is the sentence-friendly
 * wording the inspector shows a track author, who should never have to read a bit mask.
 */
export const gobjPresenceModeOptions = [
  { mask: 0x01, label: '1P / Time Trial', friendlyLabel: 'Single player and time trials' },
  { mask: 0x02, label: '2P Split-Screen', friendlyLabel: 'Two-player split-screen' },
  { mask: 0x04, label: '3P / 4P Split-Screen', friendlyLabel: 'Three and four-player split-screen' },
];
