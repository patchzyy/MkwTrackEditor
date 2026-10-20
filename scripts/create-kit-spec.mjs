/**
 * The curation of the Create-mode asset kit: which retail material / texture becomes which surface,
 * which surfaces fill which slot of which theme, and which scenery objects belong to which theme.
 *
 * Everything here was chosen by looking at the decoded retail textures (see docs/CREATE-KIT.md);
 * `scripts/build-create-kit.mjs` turns it into `public/data/MarioKartWii/Create/create-kit.szs`.
 *
 * Surface fields
 *   id        stable id, `<family>.<name>`
 *   category  one of KitSurface.category
 *   track     retail course the *material* is taken from (state: blend / alpha test / cull)
 *   material  its name in that course's `course_model.brres`
 *   tex       texture recipe, see `makeTextureFor` in build-create-kit.mjs:
 *               from   { track, name }  take the pixels from another retail texture
 *               crop   [x, y, w, h]     in source texels
 *               seamless  cross-fade the borders so the crop tiles
 *               rot    quarter turns clockwise;  flipX / flipY
 *               size   [w, h]           output size in texels (powers of two)
 *               tint   [r, g, b]        multiply
 *   mode      'single' (default): one layer x vertex colour;  'keep': retail material as it is
 *   world     [along, across]  world units covered by one texture repeat (u runs along the road)
 *   cull      'none' | 'back'  override of the retail culling
 *   flag      override of the measured KCL flag (u16)
 */

export const SURFACES = [
  // ---------------------------------------------------------------------------------- roads
  { id: 'asphalt.sunny', label: 'Sunny asphalt', category: 'road', track: 'beginner_course', material: 'a_MainRoad_m',
    tex: { crop: [268, 6, 204, 116], flatten: 0.2, seamless: true, size: [256, 128] }, world: [1850, 1100] },
  { id: 'asphalt.dark', label: 'Dark asphalt', category: 'road', track: 'castle_course', material: 'k_road_01',
    tex: { crop: [80, 16, 350, 224], flatten: 0.2, seamless: true, size: [256, 256] }, world: [1800, 1800] },
  { id: 'asphalt.grey', label: 'Grey asphalt', category: 'road', track: 'old_peach_gc', material: 'road',
    tex: { size: [64, 64] }, world: [1500, 1500] },
  { id: 'road.sandstone', label: 'Sandstone paving', category: 'road', track: 'shopping_course', material: 'road_m',
    tex: { from: { track: 'shopping_course', name: 'sh_road' }, size: [256, 256] }, world: [1600, 1600] },
  { id: 'road.cobble', label: 'Cobblestones', category: 'road', track: 'shopping_course', material: 'ishidatami_m',
    tex: { from: { track: 'shopping_course', name: 'sh_ishidatami' }, size: [256, 256] }, world: [1800, 1800] },
  { id: 'road.dirt', label: 'Dirt track', category: 'road', track: 'kinoko_course', material: 'road',
    tex: { from: { track: 'kinoko_course', name: 'road_a' }, crop: [16, 90, 224, 320], flatten: 0.2, seamless: true, size: [256, 256] }, world: [1800, 1800] },
  { id: 'road.cave', label: 'Cave floor', category: 'road', track: 'kinoko_course', material: 'road_doukutu',
    tex: { crop: [16, 90, 224, 320], flatten: 0.2, seamless: true, size: [256, 256] }, world: [1800, 1800] },
  { id: 'road.desert', label: 'Desert stone', category: 'road', track: 'desert_course', material: 'dc_Road_m',
    tex: { crop: [8, 24, 240, 464], seamless: true, size: [256, 256] }, world: [1800, 1800] },
  { id: 'road.snow', label: 'Packed snow', category: 'road', track: 'boardcross_course', material: 'K_snow03',
    tex: { from: { track: 'boardcross_course', name: 'K_srood00' }, size: [256, 256] }, world: [2000, 2000] },
  { id: 'road.wood', label: 'Wooden planks', category: 'road', track: 'boardcross_course', material: 'K_road',
    tex: { crop: [40, 40, 400, 430], seamless: false, size: [256, 256] }, world: [1800, 1800] },
  { id: 'road.steel', label: 'Steel plate', category: 'road', track: 'factory_course', material: 'aa_yellow_steel',
    tex: { from: { track: 'factory_course', name: 'body01' }, size: [128, 64] }, world: [1600, 800] },
  { id: 'road.rainbow', label: 'Rainbow', category: 'road', track: 'rainbow_course', material: 'z1_road',
    tex: { from: { track: 'rainbow_course', name: 'r_road01' }, crop: [26, 0, 460, 256], size: [512, 256], rot: 1 }, world: [1800, 2400] },
  { id: 'road.leaves', label: 'Fallen leaves', category: 'road', track: 'treehouse_course', material: 'ha_m',
    tex: { from: { track: 'treehouse_course', name: 'th_ha' }, crop: [0, 0, 256, 205], seamless: true, size: [256, 256] }, world: [2000, 2000] },
  { id: 'road.castle', label: 'Castle tiles', category: 'road', track: 'koopa_course', material: 'aa_YukaRock',
    tex: { size: [256, 256] }, world: [1800, 1800] },
  { id: 'road.carpet', label: 'Red carpet', category: 'road', track: 'koopa_course', material: 'zz_jyutan',
    tex: { from: { track: 'koopa_course', name: 'k_carpet002' }, crop: [8, 0, 176, 256], size: [128, 256], rot: 1 }, world: [1800, 1200] },
  { id: 'asphalt.night', label: 'Night asphalt', category: 'road', track: 'ridgehighway_course', material: 'road',
    tex: { from: { track: 'ridgehighway_course', name: 'M_road_00' }, crop: [530, 8, 290, 112], flatten: 0.2, seamless: true, size: [256, 128] }, world: [1850, 900] },

  // ---------------------------------------------------------------------------------- curbs
  { id: 'curb.redwhite', label: 'Red and white curb', category: 'curb', track: 'old_mario_sfc', tex: { from: { name: 'm_enseki' } }, world: [360, 360] },
  { id: 'curb.hazard', label: 'Hazard stripes', category: 'curb', track: 'old_koopa_gba', tex: { from: { name: 'kpa_danger' } }, world: [420, 420] },
  { id: 'curb.redstone', label: 'Red cobbles', category: 'curb', track: 'castle_course', tex: { from: { name: 't_aka_r_D18' } }, world: [900, 900] },

  // ---------------------------------------------------------------------------------- ground
  { id: 'grass.bright', label: 'Bright grass', category: 'ground', track: 'shopping_course', tex: { from: { name: 'sh_grass' } }, world: [1000, 1000] },
  { id: 'grass.sunny', label: 'Meadow grass', category: 'ground', track: 'beginner_course', tex: { from: { name: 't_kusa_070712c' } }, world: [2400, 2400] },
  { id: 'grass.sparkle', label: 'Sparkling lawn', category: 'ground', track: 'old_peach_gc', tex: { from: { name: 'pc_grass0_2' } }, world: [2000, 2000] },
  { id: 'grass.flowers', label: 'Flower meadow', category: 'ground', track: 'old_garden_ds', tex: { from: { name: 'ga_grass3' } }, world: [1400, 1400] },
  { id: 'grass.dark', label: 'Mossy ground', category: 'ground', track: 'senior_course', tex: { from: { name: 'senior_course26' } }, world: [2400, 2400] },
  { id: 'grass.night', label: 'Night grass', category: 'ground', track: 'ridgehighway_course', tex: { from: { name: 'M_kusa' } }, world: [1800, 1800] },
  { id: 'grass.forest', label: 'Forest canopy', category: 'ground', track: 'ridgehighway_course', material: 'siba00', tex: { from: { name: 'M_jyukai' } }, world: [3200, 3200] },
  { id: 'grass.deep', label: 'Deep green grass', category: 'ground', track: 'kinoko_course', material: 'iwakusa', tex: { from: { name: 'road_kiwa' } }, world: [2000, 2000] },
  { id: 'grass.autumn', label: 'Autumn grass', category: 'ground', track: 'treehouse_course', tex: { from: { name: 'th_grass' } }, world: [2000, 2000] },
  { id: 'snow.fresh', label: 'Fresh snow', category: 'ground', track: 'old_sherbet_64', tex: { from: { name: 's64_jimen' } }, world: [2200, 2200] },
  { id: 'sand.golden', label: 'Golden sand', category: 'ground', track: 'beginner_course', tex: { from: { name: 'Sand_070717b' } }, world: [1400, 1400] },
  { id: 'sand.pale', label: 'Pale sand', category: 'ground', track: 'old_peach_gc', tex: { from: { name: 'pc_suna03' } }, world: [1600, 1600] },
  { id: 'sand.tan', label: 'Tan sand', category: 'ground', track: 'old_mario_64', tex: { from: { name: 'm64_suna' } }, world: [1600, 1600] },
  { id: 'sand.desert', label: 'Desert dunes', category: 'ground', track: 'desert_course', tex: { from: { name: 'Sand_070827d' } }, world: [2400, 2400] },
  { id: 'mud.dark', label: 'Sticky mud', category: 'offroad', track: 'koopa_course', tex: { from: { name: 'doro_4' } }, world: [1200, 1200] },
  { id: 'mud.pebble', label: 'Pebbly mud', category: 'offroad', track: 'old_donkey_gc', tex: { from: { name: 'dk_dirt' }, crop: [0, 14, 256, 242], seamless: true, size: [256, 256] }, world: [1400, 1400] },
  { id: 'mud.swamp', label: 'Swamp mud', category: 'offroad', track: 'volcano_course', tex: { from: { name: 'vo_tuchi_kura064' } }, world: [2400, 2400] },
  { id: 'dirt.brown', label: 'Brown dirt', category: 'offroad', track: 'farm_course', tex: { from: { name: 'tuti' } }, world: [1600, 1600] },
  { id: 'ice.cracked', label: 'Cracked ice', category: 'ice', track: 'boardcross_course', tex: { from: { name: 'K_srood01' } }, world: [1600, 1600] },
  { id: 'ice.glacier', label: 'Glacier ice', category: 'ice', track: 'old_sherbet_64', tex: { from: { name: 's64_kabe01' } }, world: [2400, 2400] },

  // ---------------------------------------------------------------------------------- walls
  { id: 'wall.brick.grey', label: 'Stone bricks', category: 'wall', track: 'castle_course', tex: { from: { name: 't_renga_C06k' } }, world: [900, 900] },
  { id: 'wall.brick.red', label: 'Red bricks', category: 'wall', track: 'farm_course', tex: { from: { name: 'renga2' } }, world: [900, 900] },
  { id: 'wall.brick.green', label: 'Green stone', category: 'wall', track: 'koopa_course', tex: { from: { name: 'kabe04' } }, world: [1600, 1600] },
  { id: 'wall.stone.dark', label: 'Dark stone', category: 'wall', track: 'volcano_course', tex: { from: { name: 'v_isi_tate022' } }, world: [1200, 1200] },
  { id: 'wall.stone.carved', label: 'Carved blocks', category: 'wall', track: 'old_obake_sfc', tex: { from: { name: 'o_block' } }, world: [1000, 1000] },
  { id: 'wall.rock.green', label: 'Mossy rock', category: 'wall', track: 'kinoko_course', tex: { from: { name: 'iwa' } }, world: [3000, 3000] },
  { id: 'wall.rock.sand', label: 'Sandstone rock', category: 'wall', track: 'desert_course', tex: { from: { name: 'dc_iwa' } }, world: [2000, 2000] },
  { id: 'wall.rock.dark', label: 'Dark rock', category: 'wall', track: 'volcano_course', tex: { from: { name: 'V_iwa_b023' } }, world: [2400, 2400] },
  { id: 'wall.rock.grey', label: 'Grey rock', category: 'wall', track: 'water_course', material: 'WT_iwa1', tex: { from: { name: 'TR_iwa01' }, crop: [0, 110, 256, 400], size: [256, 256] }, world: [2200, 2200] },
  { id: 'wall.cliff.snow', label: 'Frozen cliff', category: 'wall', track: 'boardcross_course', material: 'K_cliff00', tex: { from: { name: 'K_sgake00' }, crop: [0, 60, 256, 196], size: [256, 256] }, world: [2400, 2400] },
  { id: 'wall.ice', label: 'Ice wall', category: 'wall', track: 'old_sherbet_64', tex: { from: { name: 's64_kabe2' } }, world: [2400, 2400] },
  { id: 'wall.gold', label: 'Golden blocks', category: 'wall', track: 'desert_course', material: 'dc_walltest_m', tex: { crop: [0, 0, 256, 300], size: [256, 256] }, world: [2000, 2000] },
  { id: 'wall.steel', label: 'Shipping container', category: 'wall', track: 'factory_course', material: 'Container', tex: { crop: [4, 16, 150, 200], size: [128, 128] }, world: [1400, 1400] },
  { id: 'wall.cliff.grey', label: 'Grey cliff', category: 'wall', track: 'senior_course', material: 'cliff', tex: { crop: [0, 80, 256, 432], size: [256, 256] }, world: [2200, 2200] },
  { id: 'wall.earth', label: 'Earth bank', category: 'wall', track: 'castle_course', material: 'k_iwa1', tex: { from: { name: 't_kabe_sita_051b' }, crop: [0, 150, 256, 362], size: [256, 256] }, world: [2000, 2000] },

  // ---------------------------------------------------------------------------------- barriers, fences, undersides
  { id: 'barrier.chevron', label: 'Chevron barrier', category: 'wall', track: 'beginner_course', material: 'block3_m', tex: { crop: [0, 246, 256, 140], size: [256, 128] }, world: [1000, 500], cull: 'none' },
  { id: 'barrier.marble', label: 'Marble barrier', category: 'wall', track: 'shopping_course', tex: { from: { name: 'sh_kabe2' } }, world: [1000, 1000], cull: 'none' },
  { id: 'fence.chainlink', label: 'Chain-link fence', category: 'wall', track: 'beginner_course', material: 'fence', tex: {}, world: [800, 800], cull: 'none' },
  { id: 'fence.railing', label: 'Railing', category: 'wall', track: 'factory_course', material: 'fence', tex: {}, world: [800, 400], cull: 'none' },
  { id: 'fence.mesh', label: 'Steel mesh', category: 'wall', track: 'old_mario_64', tex: { from: { name: 'm64_kanaami' } }, world: [800, 800], cull: 'none' },
  { id: 'fence.gold', label: 'Golden rail', category: 'wall', track: 'rainbow_course', material: 'b_saku', tex: {}, world: [1000, 500], cull: 'none' },
  { id: 'underside.steel', label: 'Steel girders', category: 'underside', track: 'factory_course', material: 'tekkin', tex: {}, world: [1200, 1200], cull: 'none' },

  // ---------------------------------------------------------------------------------- special
  { id: 'boost.arrow', label: 'Boost panel', category: 'boost', track: 'beginner_course', material: 'ef_dushBoard', mode: 'keep', world: [700, 1200], animated: true, uvMode: 'decal', thumb: { from: { track: 'beginner_course', name: 'ef_arrowGradS' }, tint: [1.5, 0.75, 0.1] } },
  { id: 'start.check', label: 'Start line (grey)', category: 'decal', track: 'old_mario_64', tex: { from: { name: 'm64_check' } }, world: [600, 600] },
  { id: 'start.blackwhite', label: 'Start line (black and white)', category: 'decal', track: 'old_heyho_gba', tex: { from: { name: 'm_check' } }, world: [600, 600] },
  { id: 'start.blue', label: 'Start line (blue)', category: 'decal', track: 'old_koopa_64', tex: { from: { name: 'm64_check01' } }, world: [600, 600] },
  { id: 'water.lake', label: 'Lake water', category: 'water', track: 'beginner_course', material: 'lake_m', tex: {}, world: [1400, 1400] },
  { id: 'water.sea', label: 'Open sea', category: 'water', track: 'water_course', material: 'ef_sea', mode: 'keep', world: [60000, 60000], animated: true, thumb: { from: { name: 'ef_wave1P_Mip' }, tint: [0.2, 0.55, 1.0], adjust: { brightness: 35, contrast: 0.85 } } },
  { id: 'water.shyguy', label: 'Cartoon sea', category: 'water', track: 'old_heyho_gba', material: 'sea2', mode: 'keep', world: [2400, 2400], animated: true },
  { id: 'lava.castle', label: 'Lava', category: 'lava', track: 'koopa_course', material: 'ef_volSurface', mode: 'keep', world: [40000, 40000], animated: true, thumb: { from: { name: 'ef_volcSurfaceMip3' }, tint: [1.7, 0.65, 0.05], adjust: { brightness: 30 } } },
  { id: 'lava.volcano', label: 'Molten rock', category: 'lava', track: 'volcano_course', material: 'ef_volSurface', mode: 'keep', world: [40000, 40000], animated: true, thumb: { from: { name: 'ef_volcSurfaceMip3' }, tint: [1.7, 0.65, 0.05], adjust: { brightness: 30 } } },
];

export const EXTRA_SURFACES = [
  { id: 'grass.factory', label: 'Green carpet', category: 'ground', track: 'factory_course', material: 'midori', tex: { from: { name: 'midori02' } }, world: [2400, 2400] },
  { id: 'space.nebula', label: 'Nebula', category: 'ground', track: 'rainbow_course', material: 'b_saku', tex: { from: { name: 'cloud03' }, tint: [0.55, 0.5, 1.1], size: [128, 128] }, world: [3000, 3000] },
  { id: 'space.glow', label: 'Pink haze', category: 'ground', track: 'rainbow_course', material: 'b_saku', tex: { from: { name: 'cloud03' }, tint: [1.1, 0.55, 0.9], size: [128, 128] }, world: [2600, 2600] },
];

// ------------------------------------------------------------------------------------------ themes
const T = (id, label, description, donorTrack, accent, defaultRoadStyle, terrain, slots) => ({ id, label, description, donorTrack, accent, defaultRoadStyle, terrain, slots });

export const THEMES = [
  T('sunny', 'Sunny Circuit', 'A bright grand-prix circuit: asphalt, red and white curbs, green lawns and a clear blue sky.', 'beginner_course', ['#5ec8ff', '#7bd65a'], 'circuit', true, {
    road: 'asphalt.sunny', roadAlt: 'road.cobble', curb: 'curb.redwhite', shoulder: 'sand.golden', ground: 'grass.bright', groundAlt: 'grass.sunny',
    wall: 'wall.brick.grey', barrier: 'barrier.chevron', fence: 'fence.chainlink', cliff: 'wall.rock.grey', underside: 'wall.brick.grey',
    sand: 'sand.golden', mud: 'mud.pebble', ice: 'ice.cracked', water: 'water.lake', lava: 'lava.castle', boost: 'boost.arrow', startLine: 'start.check' }),
  T('gorge', 'Mushroom Gorge', 'A mossy canyon under a green sky: dirt trails, cave floors and giant mushrooms.', 'kinoko_course', ['#3a8f5c', '#c9a14a'], 'trail', true, {
    road: 'road.dirt', roadAlt: 'road.cave', curb: 'curb.redwhite', shoulder: 'grass.deep', ground: 'grass.dark', groundAlt: 'grass.forest',
    wall: 'wall.rock.green', barrier: 'wall.stone.carved', fence: 'fence.mesh', cliff: 'wall.rock.green', underside: 'wall.rock.dark',
    sand: 'sand.tan', mud: 'mud.swamp', ice: 'ice.glacier', water: 'water.lake', lava: 'lava.volcano', boost: 'boost.arrow', startLine: 'start.blackwhite' }),
  T('desert', 'Dry Dry Desert', 'Sun-baked sandstone roads, golden ruins and endless dunes.', 'desert_course', ['#f2c15c', '#d98b3a'], 'circuit', true, {
    road: 'road.desert', roadAlt: 'road.sandstone', curb: 'curb.redstone', shoulder: 'sand.desert', ground: 'sand.desert', groundAlt: 'sand.tan',
    wall: 'wall.gold', barrier: 'wall.stone.carved', fence: 'fence.mesh', cliff: 'wall.rock.sand', underside: 'wall.rock.sand',
    sand: 'sand.desert', mud: 'mud.pebble', ice: 'ice.cracked', water: 'water.lake', lava: 'lava.volcano', boost: 'boost.arrow', startLine: 'start.check' }),
  T('snow', 'Snowy Summit', 'Packed snow, frozen cliffs and wooden bridges high in the mountains.', 'boardcross_course', ['#d8f1ff', '#7fb3d9'], 'barrier', true, {
    road: 'road.snow', roadAlt: 'road.wood', curb: 'curb.redwhite', shoulder: 'snow.fresh', ground: 'snow.fresh', groundAlt: 'grass.deep',
    wall: 'wall.cliff.snow', barrier: 'barrier.marble', fence: 'fence.railing', cliff: 'wall.ice', underside: 'wall.ice',
    sand: 'sand.pale', mud: 'mud.dark', ice: 'ice.cracked', water: 'water.lake', lava: 'lava.volcano', boost: 'boost.arrow', startLine: 'start.blue' }),
  T('beach', 'Palm Beach', 'Sandy paving by the sea under a deep blue sky, with palm trees, rocky cliffs and sparkling water.', 'old_peach_gc', ['#ffd27a', '#3aa9e0'], 'circuit', true, {
    road: 'road.sandstone', roadAlt: 'road.wood', curb: 'curb.redwhite', shoulder: 'sand.pale', ground: 'sand.tan', groundAlt: 'grass.sparkle',
    wall: 'wall.rock.grey', barrier: 'barrier.marble', fence: 'fence.mesh', cliff: 'wall.rock.grey', underside: 'wall.rock.grey',
    sand: 'sand.pale', mud: 'mud.pebble', ice: 'ice.glacier', water: 'water.sea', lava: 'lava.castle', boost: 'boost.arrow', startLine: 'start.blackwhite' }),
  T('castle', 'Fire Castle', 'Dark stone halls and rivers of lava under a stormy sky.', 'koopa_course', ['#8a2b1f', '#ff8a2a'], 'castle', true, {
    road: 'road.castle', roadAlt: 'road.carpet', curb: 'curb.hazard', shoulder: 'mud.swamp', ground: 'mud.dark', groundAlt: 'mud.swamp',
    wall: 'wall.brick.green', barrier: 'wall.stone.dark', fence: 'fence.mesh', cliff: 'wall.rock.dark', underside: 'wall.stone.dark',
    sand: 'sand.tan', mud: 'mud.dark', ice: 'ice.glacier', water: 'water.lake', lava: 'lava.castle', boost: 'boost.arrow', startLine: 'start.check' }),
  T('night', 'Night Highway', 'A moonlit highway above the treetops, with guard rails and city lights.', 'ridgehighway_course', ['#1b2a5e', '#6c8cff'], 'barrier', true, {
    road: 'asphalt.night', roadAlt: 'asphalt.dark', curb: 'curb.hazard', shoulder: 'grass.night', ground: 'grass.night', groundAlt: 'grass.forest',
    wall: 'wall.cliff.grey', barrier: 'barrier.chevron', fence: 'fence.railing', cliff: 'wall.cliff.grey', underside: 'underside.steel',
    sand: 'sand.tan', mud: 'mud.swamp', ice: 'ice.glacier', water: 'water.sea', lava: 'lava.volcano', boost: 'boost.arrow', startLine: 'start.check' }),
  T('factory', 'Toy Factory', 'Steel plates, hazard stripes and shipping containers.', 'factory_course', ['#e8a23a', '#4a6a8a'], 'walled', true, {
    road: 'road.steel', roadAlt: 'asphalt.grey', curb: 'curb.hazard', shoulder: 'dirt.brown', ground: 'grass.factory', groundAlt: 'dirt.brown',
    wall: 'wall.steel', barrier: 'barrier.chevron', fence: 'fence.railing', cliff: 'wall.earth', underside: 'underside.steel',
    sand: 'sand.tan', mud: 'mud.dark', ice: 'ice.cracked', water: 'water.sea', lava: 'lava.castle', boost: 'boost.arrow', startLine: 'start.blackwhite' }),
  T('space', 'Rainbow Sky', 'A road of light floating among the stars. No ground, only sky.', 'rainbow_course', ['#6a3df0', '#ff5ec8'], 'sky', false, {
    road: 'road.rainbow', roadAlt: 'road.steel', curb: 'curb.hazard', shoulder: 'space.nebula', ground: 'space.nebula', groundAlt: 'space.glow',
    wall: 'wall.steel', barrier: 'wall.steel', fence: 'fence.gold', cliff: 'wall.steel', underside: 'underside.steel',
    sand: 'sand.pale', mud: 'mud.dark', ice: 'ice.cracked', water: 'water.shyguy', lava: 'lava.castle', boost: 'boost.arrow', startLine: 'start.blue' }),
  T('garden', 'Flower Garden', 'Cobbled paths, red brick walls and flower meadows in the afternoon sun.', 'senior_course', ['#ff9ad0', '#7ad36a'], 'circuit', true, {
    road: 'asphalt.grey', roadAlt: 'road.cobble', curb: 'curb.redwhite', shoulder: 'grass.flowers', ground: 'grass.bright', groundAlt: 'grass.flowers',
    wall: 'wall.brick.red', barrier: 'barrier.marble', fence: 'fence.chainlink', cliff: 'wall.cliff.grey', underside: 'wall.brick.red',
    sand: 'sand.pale', mud: 'mud.pebble', ice: 'ice.cracked', water: 'water.lake', lava: 'lava.volcano', boost: 'boost.arrow', startLine: 'start.check' }),
  T('autumn', 'Maple Woods', 'Golden leaves, wooden paths and a warm autumn glow.', 'treehouse_course', ['#f0a030', '#a24a1e'], 'trail', true, {
    road: 'road.leaves', roadAlt: 'road.wood', curb: 'curb.redstone', shoulder: 'grass.autumn', ground: 'grass.autumn', groundAlt: 'grass.deep',
    wall: 'wall.earth', barrier: 'wall.brick.red', fence: 'fence.mesh', cliff: 'wall.earth', underside: 'wall.rock.dark',
    sand: 'sand.tan', mud: 'mud.pebble', ice: 'ice.glacier', water: 'water.shyguy', lava: 'lava.castle', boost: 'boost.arrow', startLine: 'start.blackwhite' }),
];


// ------------------------------------------------------------------------------------------ scenery
// ObjFlow ids of route-free decorative / obstacle objects whose models ship with the editor
// (`Common.szs` or `ExtractedAssets.u8`). `themes` is a list of theme ids or 'all'.
// scale = default GOBJ scale, spacing = scatter-brush spacing in world units.
const ALL = 'all';
const SCENERY_TABLE = [
  // generic props that suit every world
  [0x70, 'Wooden crate', ALL, 1, 700],
  [0x144, 'Traffic cone', ALL, 1, 500],
  [0x152, 'Flag (yellow W)', ALL, 1, 1400],
  [0x153, 'Flag (blue)', ALL, 1, 1400],
  [0x154, 'Pennant (red)', ALL, 1, 1400],
  [0x155, 'Pennant (green)', ALL, 1, 1400],
  [0x14d, 'Mii billboard', ALL, 1, 2600],
  [0x14e, 'Mii billboard (wide)', ALL, 1, 2600],
  [0x14f, 'Mii billboard (tall)', ALL, 1, 2600],
  [0x16b, 'Mii poster', ALL, 1, 2200],
  [0x166, 'Statue (gold)', ALL, 1, 2600],
  [0x17c, 'Statue (light)', ALL, 1, 2600],
  [0x17d, 'Statue (dark)', ALL, 1, 2600],
  [0x12e, 'Green pipe', ALL, 1, 1600],
  [0xca, 'Balloon', ALL, 1, 3500],
  [0x160, 'Mii balloon', ALL, 1, 3500],
  // trees and plants
  [0x12f, 'Round tree', ['sunny', 'garden', 'autumn', 'beach'], 1, 1800],
  [0x130, 'Round tree (solid)', ['sunny', 'garden', 'autumn', 'beach'], 1, 1800],
  [0x131, 'Flat-top tree', ['sunny', 'garden', 'autumn', 'gorge'], 1, 2000],
  [0x132, 'Flower', ['sunny', 'garden', 'autumn', 'beach'], 1, 500],
  [0x133, 'Leafy tree', ['sunny', 'garden'], 1, 1800],
  [0x134, 'Leafy tree (solid)', ['sunny', 'garden'], 1, 1800],
  [0x137, 'Peach-orchard tree', ['sunny', 'garden', 'beach'], 1, 1800],
  [0x138, 'Peach-orchard tree (solid)', ['sunny', 'garden', 'beach'], 1, 1800],
  [0x150, 'Cypress', ['sunny', 'garden', 'night', 'snow'], 1, 1200],
  [0x151, 'Cypress (solid)', ['sunny', 'garden', 'night', 'snow'], 1, 1200],
  [0x163, 'Town tree', ['sunny', 'garden', 'night'], 1, 1600],
  [0x15b, 'Town tree (solid)', ['sunny', 'garden', 'night'], 1, 1600],
  [0x135, 'Jungle tree', ['gorge', 'beach'], 1, 1800],
  [0x136, 'Jungle tree (tall)', ['gorge', 'beach'], 1, 1800],
  [0x157, 'Palm tree', ['gorge', 'beach', 'desert'], 1, 1500],
  [0x158, 'Palm tree (solid)', ['gorge', 'beach', 'desert'], 1, 1500],
  [0x159, 'Slim palm', ['gorge', 'beach', 'desert'], 1, 1400],
  [0x15a, 'Slim palm (solid)', ['gorge', 'beach', 'desert'], 1, 1400],
  [0x145, 'Beach palm', ['beach', 'desert', 'sunny'], 1, 1500],
  [0x146, 'Beach parasol', ['beach', 'sunny'], 1, 1800],
  [0x16e, 'Striped parasol', ['beach'], 1, 1800],
  [0x176, 'Dry bush', ['desert', 'autumn', 'castle'], 1, 1600],
  [0x1fa, 'Giant mushroom', ['gorge'], 1, 3000],
  // landmarks and obstacles
  [0x161, 'Windmill', ['sunny', 'garden'], 1, 6000],
  [0x16d, 'Lighthouse', ['beach'], 1, 8000],
  [0xda, 'Hot-air balloon', ['sunny', 'garden', 'beach'], 1, 5000],
  [0x194, 'Piranha plant', ['sunny', 'garden', 'gorge', 'beach'], 1, 2500],
  [0x162, 'Thwomp', ['castle', 'factory', 'gorge', 'desert'], 1, 3500],
  [0x208, 'Stone pillar', ['desert', 'castle'], 1, 2200],
  [0x209, 'Sand cone', ['desert'], 1, 2600],
  [0x1fd, 'Flame pillar', ['castle', 'factory'], 1, 3000],
  [0x1a5, 'Rotating fire bar', ['castle'], 1, 4000],
  [0x195, 'Fire bar (gold mine)', ['castle', 'factory'], 1, 4000],
  [0x171, 'Bowser statue', ['castle'], 1, 6000],
  [0x18b, 'Bowser statue (retro)', ['castle'], 1, 6000],
  [0x15c, 'Piston', ['factory'], 1, 3500],
  [0x17, 'Ice block', ['snow'], 1, 1600],
  [0x2cf, 'Highway Mii sign', ['night'], 1, 2600],
  [0x2e0, 'Highway billboard', ['night', 'factory'], 1, 2600],
  [0x2e6, 'Crescent moon', ['night', 'space'], 1, 6000],
  [0x214, 'Space rock', ['space'], 1, 3000],
  [0x215, 'Space rock (big)', ['space'], 1, 4000],
  [0x177, 'Planet ring', ['space'], 1, 6000],
  [0x17a, 'Star ring', ['space'], 1, 5000],
  [0x178, 'Space sun', ['space'], 1, 8000],
];

const THEME_IDS = THEMES.map((t) => t.id);
export const SCENERY = SCENERY_TABLE.map(([objectId, label, themes, scale, spacing]) => ({
  objectId, label, themeIds: themes === ALL ? [...THEME_IDS] : themes, scale, spacing,
}));
