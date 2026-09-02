// Friendly per-object inspector profiles, variant families, and presence-flag helpers.
// Extracted from src/ui/App.tsx.
import type { KmpEntity } from '../../lib/kmp';
import type { CommonResourceArchive } from '../../lib/objflow';
import { fallbackObjectName } from '../labels';
import type { ObjectOption } from './objectCatalog';
import { gobjPresenceModeOptions } from './objectOptionTables';

export const guidanceOnlyObjectProfileNotes: Record<string, string> = {
  'Ambient Sound': 'This object does not use extra object settings here. Its setup comes from placement plus the Sound Range path below.',
  'Arena Finish Line': 'This object does not use extra object settings here. Its setup comes from exact placement across the arena section where laps or mission completions should count.',
  'Audience Flash': 'This object does not use complex route or collision setup here. Its main job is to support crowd presentation around the trick or ambience zone it belongs to.',
  Boo: 'This object does not use extra object settings here. Its main setup comes from placement, scale, and any linked area behavior.',
  'Burning Entry Effect': 'This object does not use extra object settings here. Its setup comes from the matching burning fall-boundary collision and the surrounding visuals, not from per-object numbers.',
  'Crowd Sound': 'This object does not use extra object settings here. Its main setup comes from placement plus the Sound Range path below.',
  'Frozen Water Effect': 'This object does not use extra object settings here. Its setup comes from icy water fall boundaries and the target slot, not from the object position itself.',
  'Half-Pipe Trigger': 'This object does not use extra object settings here. Its setup comes from exact placement against the course wall and the surrounding geometry.',
  'Invisible Barrier': 'This object does not use extra object settings here. Its setup comes from scale and placement so the invisible volume blocks only the space you intend.',
  'Jump Pad': 'This object does not use extra object settings here. Its setup comes from placement, rotation, and the takeoff and landing space you build around it.',
  'Leaf Effect': 'This object does not use extra object settings here. Its setup comes from placing the effect where players actually intersect the intended foliage zone.',
  'Lens Flare': 'This object does not use extra object settings here. Its setup comes from placement relative to the sun or bright focal point it should visually reinforce.',
  'Launch Star': 'This object does not use extra object settings here. Its setup comes from placement, facing, and the surrounding launch geometry that sells the jump in play.',
  'Moving Terrain Helper': 'This object usually works with moving-terrain collision or slot-specific setup instead of a POTI route. Check the KCL, slot behavior, and surrounding geometry before binding a path.',
  'Moving Aurora': 'This object does not use extra object settings here. Its setup comes from placement within the Rainbow Road setpiece and respecting its fixed transform limits.',
  'Pipe Hazard': 'This object does not use extra object settings here. Its setup comes from placement, scale, and the space you leave around it for readable avoidance.',
  'Snow Effect': 'This object does not use extra object settings here. Its setup comes from slot behavior and the surrounding snow presentation rather than local object values.',
  'Sea Surface': 'This object does not use extra object settings here. Its setup comes from scale, placement, and the matching slot or surrounding water logic.',
  'Pylon Obstacle': 'This object does not use extra object settings here. Its setup comes from placement, spacing, and the line choice it creates.',
  'Rolling Ball': 'This object does not use extra object settings here. Its behavior is driven by mission logic and the related CPU setup, not per-object fields in this inspector.',
  'Toad Factory Alarm': 'This object does not use extra object settings here. Its setup comes from placement near the related machinery or hazard timing you want to emphasize.',
  'Waterfall Effect': 'This object does not use extra object settings here. Its setup comes from placing the effect along the intended waterfall or flow volume so the particles support the scene.',
};
export interface ObjectInspectorProfile {
  title: string;
  summary: string;
  tips: string[];
  cautions?: string[];
  routeLabel?: string;
  variantLabel?: string;
}
export function getObjectInspectorProfile(entity: KmpEntity, objFlow: CommonResourceArchive['objFlow'] | null): ObjectInspectorProfile | null {
  if (entity.section !== 'GOBJ' || entity.objectId === undefined) return null;
  const flow = objFlow?.byId.get(entity.objectId);
  const sourceText = [flow?.name ?? '', flow?.resources ?? '', fallbackObjectName(entity.objectId)].join(' ').toLowerCase();

  if (/(^|\s)(airblock)(\s|$)/.test(sourceText)) {
    return {
      title: 'Invisible Barrier',
      summary: 'Invisible blocking volume. Use it when you need to stop glides, jumps, or out-of-bounds movement without adding visible geometry to the course.',
      tips: ['Scale it to the minimum volume that solves the problem so the invisible wall stays predictable.', 'Check the barrier from gameplay camera angles and from top view so it does not accidentally block a fair recovery line.'],
    };
  }
  if (/(^|\s)(psea)(\s|$)/.test(sourceText)) {
    return {
      title: 'Sea Surface',
      summary: 'Large water surface object. Use it to support the surrounding beach or shoreline presentation without relying on the course model alone.',
      tips: ['Scale and place it so the visible water line matches the nearby coast and horizon.', 'Check the section from the racing line and from free camera so the water plane does not clip obvious terrain edges.'],
    };
  }
  if (/(^|\s)(venice_nami)(\s|$)/.test(sourceText)) {
    return {
      title: 'Rising Water',
      summary: 'Multi-stage rising and falling water controller. Set the stage heights and timings first, then verify the full cycle against the collision and respawn flow.',
      tips: ['Treat the placed Y position as the baseline; all target heights are relative to that origin.', 'If players can touch this water, pair it with the proper splash object so respawns and effects stay stable.'],
      cautions: ['This is a staged tide controller, not a generic decorative plane. Check the full cycle in motion before treating the setup as finished.'],
    };
  }
  if (/(^|\s)(pocha|pochayogan|pochamori)(\s|$)/.test(sourceText)) {
    return {
      title: 'Splash Trigger',
      summary: 'Collision-driven splash effect. Use it to connect water, lava, or leaf-splash collision to the correct effect region without placing visual clutter on the racing line.',
      tips: ['Match the Group Y KCL Index below to the collision group that should trigger the splash.', 'The object position itself matters far less than the matching KCL and group index, so verify the collision first.'],
    };
  }
  if (/(^|\s)(lensfx)(\s|$)/.test(sourceText)) {
    return {
      title: 'Lens Flare',
      summary: 'Sun-facing flare helper. Use it to reinforce a bright light source like the sun without baking the whole effect into the course model.',
      tips: ['Place it near the matching sun or bright focal point instead of scattering it loosely through the skybox.', 'Check the effect from the main racing line so the flare supports the scene instead of distracting from the route.'],
    };
  }
  if (/(^|\s)(entry)(\s|$)/.test(sourceText)) {
    return {
      title: 'Burning Entry Effect',
      summary: 'Fall-boundary fire effect helper. Use it when a burning out-of-bounds zone should wrap the player in the proper visual effect.',
      tips: ['Pair it with the correct burning fall-boundary collision instead of treating it like a standalone hazard.', 'Check the target slot and surrounding presentation so the fire effect fits the course theme.'],
    };
  }
  if (/(^|\s)(coin)(\s|$)/.test(sourceText)) {
    return {
      title: 'Coin Pickup',
      summary: 'Battle or mission coin pickup. Use it to define where coins appear, when they respawn, and how they behave in Coin Runners or tournament-style setups.',
      tips: ['Use the mode and spawn fields below consistently across a set of coins so their appearance timing feels deliberate.', 'Check coin placement from gameplay view; battle pickups need to be obvious without cluttering the arena.'],
      cautions: ['Some coins intentionally spawn later, so verify your start/respawn logic in context instead of assuming every placed coin appears immediately.'],
    };
  }
  if (/(^|\s)(itemdirect)(\s|$)/.test(sourceText)) {
    return {
      title: 'Direct Item Spawn',
      summary: 'Tournament-style placed item spawner. Use it when a specific item should exist directly on the track instead of coming from an item box.',
      tips: ['Keep the item type count small and readable so players can understand why an item is placed there.', 'Do not spam these across a track; the vanilla game is known to break online if too many are used.'],
      cautions: ['These do not appear in Time Trials, so avoid making them critical to a route that should still make sense there.', 'Vanilla online play is unsafe beyond 10 placed ItemDirect objects.'],
    };
  }
  if (/(^|\s)(wlwallgc|cara1)(\s|$)/.test(sourceText)) {
    return {
      title: 'Moving Wall',
      summary: 'Constant-speed back-and-forth mover. Use it for horizontal blockers, moving walls, or similar scripted motion that pauses cleanly at each end.',
      tips: ['The motion direction comes from object rotation, so set the facing first before tuning timing values.', 'Verify the full back-and-forth cycle in scene view; these objects pause at each end instead of moving as a sine wave.'],
    };
  }
  if (/(^|\s)(obakeblocksfcc|obakeblock2sfcc|obakeblock3sfcc)(\s|$)/.test(sourceText)) {
    return {
      title: 'Falling Block',
      summary: 'Ghost Valley falling block. Use it when you need touch-triggered or timed block drops that still read clearly from the racing line.',
      tips: ['On slot 5.3 the Y rotation affects fall direction instead of the visual block rotation, so verify both gameplay and visuals together.', 'If you use timed falling behavior, tune the countdown timing as a group so nearby blocks feel coordinated rather than random.'],
      cautions: ['These blocks are slot-sensitive; outside the intended slot they can lose solidity or special behavior.', 'Large block counts are possible, but only if the target slot and fall logic are set up carefully.'],
    };
  }
  if (/(^|\s)(eline_control)(\s|$)/.test(sourceText)) {
    return {
      title: 'Enemy Route Controller',
      summary: 'CPU route controller object. Use it to chain enemy-line behavior changes instead of forcing every CPU path edit directly into ENPT and ENPH alone.',
      tips: ['Treat Controller ID 0 as the chain terminator and make sure each next-controller link points where you expect.', 'Verify the linked ENPH section and controller timing together, because the controller chain and enemy path graph interact.'],
      cautions: ['This is easy to misconfigure silently. Check the full controller chain in sequence instead of editing one controller in isolation.'],
    };
  }
  if (/(^|\s)(begoman_manager)(\s|$)/.test(sourceText)) {
    return {
      title: 'Topman Manager',
      summary: 'Galaxy Colosseum Topman wave controller. Use it to define which Topmen belong to each manager and how later waves unlock after the earlier ones are defeated.',
      tips: ['Keep manager IDs and first-controlled Topman IDs organized before tuning the behavior fields.', 'Check the target slot early; this object is slot-restricted and does not behave like a generic obstacle spawner.'],
      cautions: ['Wave order comes from the manager chain, so mismatched IDs or counts can make later groups fail to appear as intended.'],
    };
  }
  if (/(^|\s)(ice)(\s|$)/.test(sourceText)) {
    return {
      title: 'Frozen Water Effect',
      summary: 'Respawn ice-effect helper. Use it to enable the frozen-water presentation for icy fall boundaries on the proper slot.',
      tips: ['This effect is global once enabled, so focus on the target slot and boundary setup rather than the object position.', 'Use it only when the track really has icy water behavior; otherwise it adds confusion without gameplay value.'],
    };
  }
  if (/(^|\s)(startline2d)(\s|$)/.test(sourceText)) {
    return {
      title: 'Arena Finish Line',
      summary: '2D finish-line helper for arena-style laps or mission-style goals. Place it exactly where the completion line should register.',
      tips: ['Line it up from top view so the counted crossing spans the intended width of the arena path.', 'Check the player approach and lap flow so the line reads clearly instead of feeling arbitrary.'],
    };
  }
  if (/(^|\s)(dummypole)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pole Collision Controller',
      summary: 'Solidity helper for pole-style obstacles. Use it when the visible pole needs the correct wall collision variant to match the intended hit behavior.',
      tips: ['Treat the Wall KCL Variant below as the key field; this object mainly exists to define collision behavior for the pole it supports.', 'Check the supported visual pole and nearby wall space together so the resulting collision is readable in motion.'],
    };
  }
  if (/(^|\s)(monte_a)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pianta Spectator',
      summary: 'Single Pianta crowd actor. Use it to add trackside life, then tune when it turns to face the player and when it starts clapping.',
      tips: ['Keep the rotation and clap distances close to the actual player route so the reaction reads intentionally.', 'These work best off the main racing surface, supporting a nearby setpiece instead of cluttering the line.'],
    };
  }
  if (/(^|\s)(hanabi)(\s|$)/.test(sourceText)) {
    return {
      title: 'Fireworks',
      summary: 'Cutscene firework helper. Use it to support intro or celebration presentation on tracks that rely on a GP-only firework cue.',
      tips: ['Set the pop timing against the intro camera sequence instead of tuning it blind from free camera.', 'Treat this as presentation timing, not gameplay collision or route logic.'],
    };
  }
  if (/(^|\s)(leaf_effect)(\s|$)/.test(sourceText)) {
    return {
      title: 'Leaf Effect',
      summary: 'Leaf-drive effect helper. Use it when players should kick up leaves while driving or flying through a foliage-heavy section.',
      tips: ['Place it where the player can actually intersect the foliage zone instead of treating it as a distant decoration.', 'Check the slot and surrounding scene effects so the leaf burst reads cleanly and does not get lost in other particles.'],
    };
  }
  if (/(^|\s)(starring)(\s|$)/.test(sourceText)) {
    return {
      title: 'Launch Star',
      summary: 'Rainbow Road launch-star helper. Use it when the course geometry and presentation are designed around a dramatic launch transition.',
      tips: ['Align it with the intended player approach and landing arc before treating the setup as finished.', 'Check the surrounding visuals so the launch star reads as a deliberate focal point rather than a loose prop.'],
    };
  }
  if (/(^|\s)(steam)(\s|$)/.test(sourceText)) {
    return {
      title: 'Steam Effect',
      summary: 'Toad’s Factory steam burst effect. Use it to add readable hazard atmosphere around machinery with a clear delay and pulse rhythm.',
      tips: ['Tune delay, burst length, and repeat spacing together instead of editing them one at a time.', 'Keep the effect near the machine or lane it is supposed to sell so the particle timing makes visual sense.'],
    };
  }
  if (/(^|\s)(alarm)(\s|$)/.test(sourceText)) {
    return {
      title: 'Toad Factory Alarm',
      summary: 'Factory alarm effect helper. Use it as presentation support for moving machinery, hazard timing, or industrial setpieces.',
      tips: ['Place it where the visual source of the alarm is obvious instead of treating it as generic ambience.', 'Pair it with the relevant machine or hazard cycle so the alarm feels motivated.'],
    };
  }
  if (/(^|\s)(koopafigure64)(\s|$)/.test(sourceText)) {
    return {
      title: 'Bowser Statue',
      summary: 'Bowser’s Castle statue hazard. Use it when you want proximity-based flame breathing with visible warning space before the player commits.',
      tips: ['Set the activation distance and start delay together so the statue reads early instead of firing unfairly into the player path.', 'Check the target lane from the racing line; this hazard is about readable timing, not just visual scale.'],
    };
  }
  if (/(^|\s)(aurora)(\s|$)/.test(sourceText)) {
    return {
      title: 'Moving Aurora',
      summary: 'Rainbow Road moving setpiece strip. Use it as part of the stage presentation while respecting its fixed transform behavior.',
      tips: ['Because it cannot be rotated or scaled, treat placement and surrounding scene composition as the real setup work.', 'Check it in motion against the rest of the Rainbow Road backdrop so the movement reads intentional.'],
    };
  }
  if (/(^|\s)(boble)(\s|$)/.test(sourceText)) {
    return {
      title: 'Lava Bubble',
      summary: 'Route-driven lava bubble hazard. Use it when you want a simple bouncing fire threat with readable timing and spacing.',
      tips: ['Keep the route and start speed simple so the jump rhythm reads clearly from the player line.', 'If you flip the model behavior, verify the result from multiple camera angles so the motion still reads naturally.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(seagull|bird)(\s|$)/.test(sourceText)) {
    return {
      title: 'Flying Flock',
      summary: 'Route-following flying wildlife. Use it to add motion to the sky space without turning it into a distracting gameplay threat.',
      tips: ['Keep the path clean and readable against the skybox so the flock motion supports the scene instead of looking erratic.', 'Use modest counts; repeated flying silhouettes become visual noise quickly.'],
      routeLabel: 'Flight Path',
    };
  }
  if (/(^|\s)(cruiserr)(\s|$)/.test(sourceText)) {
    return {
      title: 'Route Boat',
      summary: 'Route-following boat setpiece. Use it to add readable trackside motion or moving water traffic without crowding the race line.',
      tips: ['Check the boat from the main approach angle so its speed feels intentional rather than random background drift.', 'Use top or ortho view to keep the full route away from obvious shoreline clipping or collision confusion.'],
      routeLabel: 'Boat Path',
    };
  }
  if (/(^|\s)(fallbsa|fallbsb|fall_mh|fall_y)(\s|$)/.test(sourceText)) {
    return {
      title: 'Waterfall Effect',
      summary: 'Waterfall particle helper. Use it to reinforce large moving water setpieces where the visual flow needs extra depth beyond the model alone.',
      tips: ['Place the effect along the visible flow volume, not just at the source, so the full waterfall reads convincingly.', 'Match any effect variant to the surrounding waterfall asset set before finalizing the scene.'],
    };
  }
  if (/(^|\s)(envsnow)(\s|$)/.test(sourceText)) {
    return {
      title: 'Snow Effect',
      summary: 'Global snow presentation helper. Use it when the track slot and surrounding scene are meant to carry an active snow effect.',
      tips: ['Treat this as a slot-and-scene effect, not as a local prop you can tune with placement alone.', 'Check the snow density against other particles so the course stays readable in motion.'],
    };
  }
  if (/(^|\s)(flash_l|flash_b|flash_w|flash_m|flash_s)(\s|$)/.test(sourceText)) {
    return {
      title: 'Audience Flash',
      summary: 'Crowd camera-flash effect helper. Use it to reinforce tricks, ambience cues, or crowd reactions around a spectacle-heavy section.',
      tips: ['Keep the effect near the intended audience zone or stadium setpiece so the flashes feel connected to the crowd.', 'If you use a variant-selecting flash object, match the chosen variant to the surrounding venue assets.'],
    };
  }
  if (/(^|\s)(itembox|f_itembox|s_itembox|w_itembox|sin_itembox|w_itemboxline)(\s|$)/.test(sourceText)) {
    return {
      title: 'Item Box',
      summary: 'Standard pickup object. Place it where racers can clearly drive through it, then use surface snap to settle it onto the course surface.',
      tips: ['Item boxes do not need a movement path.', 'Use duplicate and multi-select tools to lay out repeated box patterns quickly.'],
      variantLabel: 'Box Type',
    };
  }
  if (/(^|\s)(sound_mii)(\s|$)/.test(sourceText)) {
    return {
      title: 'Crowd Sound',
      summary: 'Ambient audience sound source. Place it near spectator spaces so the audio presence matches what the player sees in that part of the course.',
      tips: ['Keep it off the racing surface and near the crowd or set-piece it is meant to support.', 'Its sound range comes from the assigned route, so set the Sound Range path first and shape that route around the spectator zone instead of the racing line.'],
      cautions: ['Treat this as support for nearby crowd or Mii-themed scenery, not as a general-purpose hazard or obstacle.', 'Vanilla Mario Kart Wii only uses this object on slots 1.1 and 3.1.'],
      routeLabel: 'Sound Range',
    };
  }
  if (/(^|\s)(sound_river|sound_water_fall|sound_lake|sound_big_fall|sound_sea|sound_fountain|sound_volcano|sound_audience|sound_big_river|sound_sand_fall|sound_lift)(\s|$)/.test(sourceText)) {
    return {
      title: 'Ambient Sound',
      summary: 'Route-driven sound emitter. Place it near the visual source and shape the bound route around the space where the audio should feel present.',
      tips: ['Use the Sound Range path below to describe where the effect should be heard instead of dropping the object directly on the racing line.', 'Check the sound source against the surrounding scenery so the route length and placement match what the player sees.'],
      cautions: ['Most vanilla sound objects are slot-dependent, so verify the target slot before relying on them for critical ambience.', 'These are support objects, not hazards or collision props. Keep them out of the player path unless you deliberately want them visible.'],
      routeLabel: 'Sound Range',
    };
  }
  if (/(^|\s)(koopaball)(\s|$)/.test(sourceText)) {
    return {
      title: 'Bowser Fireball',
      summary: 'Rolling hazard projectile. Place it where the player can recognize the threat path early and still react with a clear line choice.',
      tips: ['Check the hazard from the racing line so it reads before the player is committed.', 'Use top or ortho view to keep enough room around the projectile path for fair avoidance.'],
      cautions: ['Avoid combining rolling projectile hazards with blind corners, forced landings, or crowded obstacle stacks where their motion becomes hard to read.', 'This object depends on the Bowser Castle airship asset set and is only known to work on slot 6.2 in vanilla Mario Kart Wii.'],
      routeLabel: 'Projectile Path',
    };
  }
  if (/(^|\s)(sunds)(\s|$)/.test(sourceText)) {
    return {
      title: 'Angry Sun',
      summary: 'Route-driven overhead hazard. Place it where the player can read the drop path and the waiting time between attacks before the section becomes too busy.',
      tips: ['Use the movement path below to shape where the sun pauses and where it drops hazards.', 'Top or ortho view is the fastest way to verify that the sun stays over the intended section of track.'],
      cautions: ['This object is only known to work on a small set of vanilla slots, and its route setting 2 values change whether it waits or drops a FireSnake hazard.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(penguin_s|penguin_m|penguin_l)(\s|$)/.test(sourceText)) {
    return {
      title: 'Penguin',
      summary: 'Sliding wildlife obstacle. Place it where the player can read the occupied space and still react cleanly without mistaking it for background decoration.',
      tips: ['Use top or ortho view to keep enough room around the penguin for a fair line choice.', 'Use the variant switcher below to swap between small, medium, and large penguins without rebuilding the placement.'],
      cautions: ['Avoid hiding penguins in heavy snow clutter, blind crests, or tight wall sections where their collision becomes hard to read.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Penguin Type',
    };
  }
  if (/(^|\s)(basabasa)(\s|$)/.test(sourceText)) {
    return {
      title: 'Swooper',
      summary: 'Flying bat hazard. Place it where the player can identify the flight space early instead of being surprised at the last instant.',
      tips: ['Check the bat from the racing line and from top view so its occupied airspace is obvious.', 'Keep repeated bat groups spaced out enough that each threat remains readable on its own.'],
      cautions: ['Avoid combining flying bat hazards with dark ceilings, tunnel clutter, or stacked moving hazards where the silhouette disappears.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(kuribo|goomba)(\s|$)/.test(sourceText)) {
    return {
      title: 'Goomba',
      summary: 'Basic walking enemy. Keep it on solid ground and away from walls or tiny seams so the obstacle reads cleanly in play.',
      tips: ['Snap it to the collision surface after placement.', 'Duplicate one tuned setup to build repeated enemy groups.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(choropu|choropu2|choropu_ground)(\s|$)/.test(sourceText)) {
    return {
      title: 'Monty Mole',
      summary: 'Pop-up enemy object. Place it on a clear patch of terrain where the attack is easy for the player to read.',
      tips: ['Place it directly on the collision surface.', 'Avoid burying it inside steep banks or decorative geometry.'],
      cautions: ['Vanilla Mario Kart Wii should not mix choropu and choropu2 in the same track because they share the same model resource.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Variant',
    };
  }
  if (/(^|\s)(firesnake|firesnake_v)(\s|$)/.test(sourceText)) {
    return {
      title: 'Podoboo',
      summary: 'Jumping lava hazard. Place it where the player can read the launch and landing space clearly before committing to the line.',
      tips: ['Check the hazard from the racing line and from top view so the landing space stays obvious.', 'Keep enough room around the landing zone that the obstacle pressures the line instead of making the section feel arbitrary.'],
      cautions: ['Avoid stacking jumping lava hazards into blind turns, wall squeezes, or forced landings where the motion becomes unreadable.'],
    };
  }
  if (/(^|\s)(koopafirebar|wlfirebargc|wlfireringgc)(\s|$)/.test(sourceText)) {
    return {
      title: 'Fire Bar',
      summary: 'Rotating hazard. Place it where racers can read the sweep arc early enough to react, especially on narrow lines.',
      tips: ['Check the arc from the racing line, not just from the object center.', 'Use duplicate sparingly; too many sweep hazards in a row become visual noise quickly.'],
      cautions: ['Avoid placing fire bars where their sweep overlaps blind turns, boost landings, or forced-motion sections.'],
      variantLabel: 'Fire Bar Type',
    };
  }
  if (/(^|\s)(heyhoshipgba|heyhoballgba|heyhotreegbac)(\s|$)/.test(sourceText)) {
    return {
      title: 'Shy Guy Obstacle',
      summary: 'Trackside hazard object. Place it where the player can identify the obstacle behavior early and still make a clean steering choice.',
      tips: ['Check the obstacle from the racing line and from top or ortho view to verify spacing.', 'Use the variant switcher below to swap between the common Shy Guy obstacle styles without replacing the placement.'],
      cautions: ['Do not stack multiple busy hazards into the same short reaction window; these obstacles work best when their threat is visually distinct.'],
      routeLabel: entity.objectId === 0x0ce ? 'Flight Path' : undefined,
      variantLabel: 'Obstacle Type',
    };
  }
  if (/(^|\s)(heyho2)(\s|$)/.test(sourceText)) {
    return {
      title: 'Ski Lift',
      summary: 'Chairlift manager from DK Summit. Assign a path first, then tune the chairlift model while checking the moving line from the player route.',
      tips: ['Use the movement path field below to bind the lift to a full loop before adjusting anything else.', 'Check the line from top or ortho view so the lift spacing stays readable over the course section below.'],
      cautions: ['This is not a roaming ground enemy. It manages a moving chairlift setpiece, so ground-level Shy Guy assumptions do not apply here.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(heyho)(\s|$)/.test(sourceText)) {
    return {
      title: 'Shy Guy',
      summary: 'Small roaming obstacle. Place it where the player can identify the occupied space clearly without losing the route to clutter.',
      tips: ['Check the placement from the racing line so the obstacle reads early enough to steer around.', 'Use the variant switcher below to swap between the common Shy Guy styles without replacing the setup.'],
      cautions: ['Avoid dropping small roaming hazards into already busy line checks where players cannot distinguish them from scenery quickly enough.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Shy Guy Type',
    };
  }
  if (/(^|\s)(woodbox|w_woodbox|bblock)(\s|$)/.test(sourceText)) {
    return {
      title: 'Breakable Box',
      summary: 'Simple breakable obstacle. Place it where it adds line pressure or decoration without turning the route into clutter.',
      tips: ['Use duplicate and multi-select to lay out repeated box groups quickly.', 'Check spacing from the racing line so the box reads as a choice, not random collision noise.'],
      cautions: ['Avoid stacking boxes so tightly that players cannot read which ones are solid threats and which lines remain open.'],
      variantLabel: 'Box Type',
    };
  }
  if (/(^|\s)(mashballoongc|castleballoon1|mii_balloon)(\s|$)/.test(sourceText)) {
    return {
      title: 'Balloon Hazard',
      summary: 'Large floating obstacle prop. Place it where it shapes the player line clearly without turning the route into visual clutter.',
      tips: ['Check the balloon from both the racing line and top view so its footprint is obvious.', 'Use scale and duplicate carefully; large floating props can dominate the scene quickly.'],
      cautions: ['Keep oversized floating hazards away from blind landings, cannons, and spawn zones so they do not create unreadable collisions.'],
      routeLabel: 'Flight Path',
    };
  }
  if (/(^|\s)(dossun|dossunc|dossunc_soko|kdossunc)(\s|$)/.test(sourceText)) {
    return {
      title: 'Thwomp',
      summary: 'Large crushing hazard. Place it where the player can read the drop zone early and still make a deliberate steering decision.',
      tips: ['Check the hazard from the racing line and from top view so its occupied space is obvious.', 'Leave enough lateral room that the player has a readable safe option instead of a blind guess.'],
      cautions: ['Avoid stacking multiple drop hazards into the same short reaction window or placing them immediately after forced landings.'],
      variantLabel: 'Thwomp Type',
    };
  }
  if (/(^|\s)(sanbo|sanbo_big)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pokey',
      summary: 'Tall desert hazard. Place it where the player can identify its occupied space clearly without blocking the whole route.',
      tips: ['Use the larger variants sparingly; they dominate narrow sections quickly.', 'Check from top or ortho view to keep enough room around the hazard for clean line choices.'],
      cautions: ['Do not bury Pokey variants in cluttered scenery where their hit space becomes hard to read.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Pokey Type',
    };
  }
  if (/(^|\s)(cow)(\s|$)/.test(sourceText)) {
    return {
      title: 'Cow',
      summary: 'Large wandering obstacle. Place it where the player can read the occupied space early and still make a deliberate steering choice around it.',
      tips: ['Check the obstacle from the racing line and from top view so the footprint is obvious.', 'Use duplicate sparingly; repeated large animals can clutter the route quickly.'],
      cautions: ['Avoid placing cows on blind crests, in narrow wall channels, or inside other busy hazards where their body space becomes hard to judge.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(pylon01)(\s|$)/.test(sourceText)) {
    return {
      title: 'Traffic Cone',
      summary: 'Reactive road cone from Daisy Circuit. Use it to shape line pressure without turning the route into clutter.',
      tips: ['Check cone spacing from the racing line so the obstacle reads as a clear steering choice instead of visual noise.', 'Use the start and sleep timing below carefully so the cone behavior matches the traffic pattern you want instead of spamming the start grid.'],
      cautions: ['This object is slot-restricted in vanilla Mario Kart Wii and too many effect-heavy cones near the start can cause major slowdown.'],
    };
  }
  if (/(^|\s)(karehayama)(\s|$)/.test(sourceText)) {
    return {
      title: 'Tumbleweed',
      summary: 'Rolling desert obstacle. Place it where the player can read the crossing space early instead of discovering it at the last instant.',
      tips: ['Check the hazard from the racing line and from top or ortho view so the crossing space stays obvious.', 'Leave enough room on both sides that the player can make a clean avoidance choice instead of a blind guess.', 'Use the item controls below only when you deliberately want the tumbleweed pile to hand out an item when hit.'],
      cautions: ['Avoid dropping tumbleweeds into blind crests, narrow wall channels, or stacked hazard sections where the moving footprint becomes hard to read.'],
    };
  }
  if (/(^|\s)(quicksand)(\s|$)/.test(sourceText)) {
    return {
      title: 'Quicksand',
      summary: 'Area-style terrain hazard. Place it where the player can read the trap space clearly and still understand the intended safe line around it.',
      tips: ['Check the footprint from top or ortho view so the dangerous area is obvious before turn-in.', 'Keep enough clear ground nearby that the hazard pressures a line choice instead of feeling unavoidable.'],
      cautions: ['Avoid hiding quicksand inside heavy terrain clutter, under jumps, or immediately after blind landings where players cannot read the trap in time.'],
    };
  }
  if (/(^|\s)(volcanoball1)(\s|$)/.test(sourceText)) {
    return {
      title: 'Volcano Rock',
      summary: 'Route-driven falling fireball hazard. Bind it to a route and keep its route points close together so the motion stays stable in-game.',
      tips: ['Check the full path from the racing line and from top view so the fireball reads early and the landing space stays fair.', 'Keep route points relatively close together; long gaps can break this object badly in vanilla Mario Kart Wii.'],
      cautions: ['Avoid spawning volcano rocks into blind landings or cramped walls where the player cannot read the incoming threat before contact.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(m_obj_jump|m_obj_s_jump|m_obj_s_jump2|m_obj_jump2|m_obj_start)(\s|$)/.test(sourceText)) {
    return {
      title: 'Jump Pad',
      summary: 'Launch ramp object. Place it where the player can read the takeoff and landing line cleanly before committing to the jump.',
      tips: ['Check the object from the racing line and from top or ortho view so the takeoff angle stays readable.', 'Use surface snap and rotation together so the pad sits cleanly on the intended approach surface.'],
      cautions: ['Avoid pointing jump pads into blind landings, walls, or stacked hazards where the forced motion becomes unreadable.'],
      variantLabel: 'Jump Type',
    };
  }
  if (/(^|\s)(stargate)(\s|$)/.test(sourceText)) {
    return {
      title: 'Star Gate',
      summary: 'Drive-through gate prop. Place it where the player can identify the gate opening cleanly from the racing line instead of clipping it at the last second.',
      tips: ['Check the gate from the racing line and from top or ortho view so the opening stays centered on the intended route.', 'Use rotation controls to line the gate up with the approach instead of forcing a late steering correction.'],
      cautions: ['Avoid stacking gates into blind jumps, wall squeezes, or busy scenery where the opening becomes hard to read.'],
    };
  }
  if (/(^|\s)(casino_roulette)(\s|$)/.test(sourceText)) {
    return {
      title: 'Roulette Platform',
      summary: 'World-center rotating terrain gimmick. Use it only when the entire course setup is designed around a roulette-style moving floor.',
      tips: ['Keep the object at the world center and verify the route from top or ortho view before committing to the gimmick.', 'Check player, item, and respawn behavior carefully; rotating terrain changes how the whole section plays, not just the visible model.'],
      cautions: ['Do not treat this like a normal decorative prop. If the track layout is not built around rotating terrain, the result will be confusing or broken in play.'],
    };
  }
  if (/(^|\s)(rm_ring1)(\s|$)/.test(sourceText)) {
    return {
      title: 'Driveable Ring',
      summary: 'Galaxy Colosseum ring object. Set which ring it controls, then tune the shake and fall timing so the gimmick is readable in play.',
      tips: ['Use top or ortho view to verify which ring zone this object is meant to control.', 'Keep enough warning time before the ring falls that players can understand what is happening and react deliberately.'],
      cautions: ['Avoid using ring fall timing that triggers immediately without readable shake time, especially near jumps or forced-motion sections.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(hp_pipe)(\s|$)/.test(sourceText)) {
    return {
      title: 'Half-Pipe Trigger',
      summary: 'Half-pipe style trigger object. Place it only where the surrounding course geometry and player approach are built for trick-wall movement.',
      tips: ['Check the approach and exit from the racing line so the player can read the half-pipe entry early.', 'Use dev or top view to make sure the trigger sits exactly where the intended wall-riding section begins.'],
      cautions: ['Avoid dropping half-pipe triggers into ordinary ground sections or cluttered scenery where players cannot tell why their movement changed.'],
    };
  }
  if (/(^|\s)(utsubodokan)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pipe Hazard',
      summary: 'Large pop-out hazard. Place it where the player can read the occupied space early and still understand the safe line around it.',
      tips: ['Check the hazard from the racing line and from top or ortho view so the footprint is obvious.', 'Leave enough lateral room that the player has a deliberate avoidance path instead of a blind guess.'],
      cautions: ['Avoid hiding large pop-out hazards in tunnel clutter, behind walls, or immediately after blind landings where the threat appears too late.'],
    };
  }
  if (/(^|\s)(honeball)(\s|$)/.test(sourceText)) {
    return {
      title: 'Rolling Ball',
      summary: 'Moving hazard ball. Place it where the player can read the crossing path and react with a clean line choice before contact.',
      tips: ['Check the hazard from the racing line and from top view so the crossing path is easy to understand.', 'This object is mission-style logic; its placement point does not matter and it behaves around a CPU target instead of following normal track-space authoring assumptions.'],
      cautions: ['Avoid mixing rolling-ball hazards into blind corners, wall squeezes, or stacked moving hazards where the motion path becomes unreadable.', 'For mission use, define exactly one CPU or the behavior becomes unreliable.'],
    };
  }
  if (/(^|\s)(epropeller)(\s|$)/.test(sourceText)) {
    return {
      title: 'Electric Propeller',
      summary: 'Rotating hazard from Koopa Cape. Set the spin speed and direction so the obstacle reads clearly from the player approach.',
      tips: ['Check the propeller from the racing line so the blade timing is readable before the player commits.', 'Use top or ortho view to verify the propeller sits centered on the intended corridor instead of clipping nearby walls.'],
      cautions: ['Very fast propeller timing can become unreadable in narrow channels. Use the slowdown factor only when you deliberately target LE-CODE behavior.'],
    };
  }
  if (/(^|\s)(pile)(\s|$)/.test(sourceText)) {
    return {
      title: 'Pylon Obstacle',
      summary: 'Simple course obstacle. Place it where it shapes the line clearly without turning the route into clutter.',
      tips: ['Use duplicate and multi-select to build repeated obstacle rows quickly.', 'Check spacing from the racing line so the obstacle reads as a clear steering choice.'],
      cautions: ['Avoid stacking too many small blockers into one short reaction window where the route becomes noisy instead of readable.'],
    };
  }
  if (/(^|\s)(poihana)(\s|$)/.test(sourceText)) {
    return {
      title: 'Cataquack',
      summary: 'Line-disrupting enemy. Place it where the player can read the approach early and still understand where the safe space is around the attack zone.',
      tips: ['Check the enemy from the racing line so its occupied zone is readable before turn-in.', 'Leave enough lateral room that the player has a deliberate avoidance option instead of a blind guess.'],
      cautions: ['Avoid stacking Cataquacks into already crowded hazard sections where their push threat becomes visually ambiguous.'],
    };
  }
  if (/(^|\s)(envfire|flamepole|flamepole_v|flamepole_v_big)(\s|$)/.test(sourceText)) {
    return {
      title: 'Flame Jet',
      summary: 'Stationary fire hazard. Place it where the player can recognize the threat early and still make a deliberate line choice.',
      tips: ['Use dev, top, or ortho view to check that the flame sits cleanly on the intended side of the route.', 'Leave enough lateral room that the hazard pressures the line instead of making the section feel arbitrary.'],
      cautions: ['Avoid hiding flame hazards behind walls, props, or terrain crests where the player cannot read the danger before committing.'],
      variantLabel: 'Flame Type',
    };
  }
  if (/(^|\s)(pakkun_f|puchi_pakkun|pakkun_dokan)(\s|$)/.test(sourceText)) {
    return {
      title: 'Piranha Plant',
      summary: 'Stationary hazard. Use it to pressure a line choice or defend a narrow space without hard-blocking the whole track.',
      tips: ['Leave enough steering room around the hazard.', 'Open Advanced object data only when you need non-default behavior.'],
      variantLabel: 'Variant',
    };
  }
  if (/(^|\s)(crab)(\s|$)/.test(sourceText)) {
    return {
      title: 'Crab',
      summary: 'Small moving obstacle. Keep it on visible ground where it reads as a hazard instead of visual clutter.',
      tips: ['Avoid placing crab objects flush against walls.', 'Duplicate a placed crab to make consistent obstacle groups.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(insekia|insekib|dkrockgc|volcanorock1)(\s|$)/.test(sourceText)) {
    return {
      title: 'Falling Rock',
      summary: 'Hazard prop that needs its object data configured before it is safe to use on a vanilla track.',
      tips: ['Place it where the player can read the threat early.', 'Open Advanced object data if you need to tune its raw behavior values.'],
      cautions: ['Vanilla Mario Kart Wii is known to crash if InsekiA or InsekiB keeps Setting 3 at 0.'],
    };
  }
  if (/(^|\s)(press|press_soko)(\s|$)/.test(sourceText)) {
    return {
      title: 'Crusher',
      summary: 'Heavy timing hazard. Place it where the player can see the cycle early enough to react instead of being surprised at the last second.',
      tips: ['Check the hazard from the racing line, not just from free camera angles.', 'Use dev view or top view to make sure the crusher clears nearby walls and props cleanly.'],
      cautions: ['Avoid placing crushers flush against blind corners or decorative ceilings where the timing becomes hard to read.'],
    };
  }
  if (/(^|\s)(hwanwan|wanwan|twanwan|twanwan_ue)(\s|$)/.test(sourceText)) {
    return {
      title: 'Chain Chomp',
      summary: 'Large moving hazard. Give it visible approach space and enough room around the racing line so the threat reads clearly before contact.',
      tips: ['Place it where the player can identify the danger from a distance.', 'Use duplication sparingly; repeated large hazards can clutter the line quickly.'],
      cautions: ['Keep large hazards away from spawn zones, cannons, and other forced-motion sections so they do not create unreadable failures.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Chomp Type',
    };
  }
  if (/(^|\s)(b_teresa|bgteresasfc)(\s|$)/.test(sourceText)) {
    return {
      title: 'Boo',
      summary: 'Floating ghost obstacle. Place it where the player can clearly read the occupied airspace without mistaking it for background ambience.',
      tips: ['Check the hazard from the racing line and from dev or top view so the height and footprint stay readable.', 'The SNES Ghost Valley Boo variant is controlled by AREA type 07 and the object position itself does not drive the visible path; set the AREA up first.', 'Use the variant switcher below to swap between the common Boo variants without rebuilding the placement.'],
      cautions: ['Avoid hiding ghost obstacles in dark scenery, tunnel clutter, or overlapping particle-heavy set pieces where their silhouette disappears.', 'The SNES Ghost Valley Boo cannot go below Y=3000, and the background Boo variant looks best with scale values around 3 to 4.'],
      variantLabel: 'Boo Type',
    };
  }
  if (/(^|\s)(hanachan|bosshanachan|bosshanachanhead)(\s|$)/.test(sourceText)) {
    return {
      title: 'Wiggler',
      summary: 'Large caterpillar hazard. Place it where the player can recognize the body space and react before the section becomes crowded.',
      tips: ['Use top or ortho view to keep enough room around the hazard for clear racing lines.', 'Use the variant switcher below to swap between regular and boss variants without replacing the placement.'],
      cautions: ['Avoid dropping large body-style hazards into narrow sections, blind crests, or cluttered scenery where their footprint becomes unreadable.'],
      routeLabel: 'Movement Path',
      variantLabel: 'Wiggler Type',
    };
  }
  if (/(^|\s)(begoman_manager|begoman_spike)(\s|$)/.test(sourceText)) {
    return {
      title: 'Spinner Hazard',
      summary: 'Rotating hazard object. Place it where the player can read the spin zone early and still make a clean line choice around it.',
      tips: ['Check the occupied space from the racing line and from top view so the hazard footprint is obvious.', 'Use the variant switcher below to move between the common spinner variants without rebuilding the setup.'],
      cautions: ['Avoid stacking rotating hazards into boost landings, blind corners, or cramped walls where the spin zone becomes unreadable.', 'The spawned Topman variant only works on specific slots, and it must be the first placed game object to appear at all.'],
      variantLabel: 'Spinner Type',
    };
  }
  if (/(^|\s)(escalator|escalator_group|belteasy|beltcrossing|beltcurvea|beltcurveb|belt|bulldozer_left|bulldozer_right|townbridgedsc|venice_hasi)(\s|$)/.test(sourceText)) {
    return {
      title: 'Moving Terrain Helper',
      summary: 'Moving-terrain support object. Use it to define how surrounding KCL or slot-specific motion behaves, then verify the setup from both player view and top view.',
      tips: ['Check the related moving-road or moving-terrain collision first; several of these objects do not use a POTI route at all.', 'Use the object position, rotation, and nearby KCL as the main setup controls before you touch advanced fields.'],
    };
  }
  if (/(^|\s)(k_sticklift00|kinoko_lift1|kinoko_ud|kinoko_bend|kinoko_nm|kinoko_kuki|pendulum|dkship64|dkturibashigcc|dkmarutagcc|crane|venice_gondola|twistedway|dkfalls)(\s|$)/.test(sourceText)) {
    return {
      title: 'Moving Platform',
      summary: 'Route-driven moving object. Assign a path first, then verify the motion from the player line and from top or ortho view.',
      tips: ['Use the path field below to bind the object to a route.', 'Leave route visibility on while setting movement up, then hide it again from the viewport eye menu.'],
      routeLabel: 'Movement Path',
    };
  }
  if (/(^|\s)(cara1|cara2|cara3|carb|car_body|truckwagon|k_bomb_car|k_bomb_car1|kart_truck)(\s|$)/.test(sourceText)) {
    return {
      title: 'Traffic Vehicle',
      summary: 'Route-driven vehicle hazard. Bind it to a path, then check its motion from the racing line so it reads early and stays fair.',
      tips: ['Use the traffic path field below to create, bind, or jump to its route.', 'Top or ortho view is the fastest way to clean up long traffic paths.'],
      cautions: ['Keep traffic well clear of walls, decorative props, and blind corners so collisions stay readable in play.'],
      routeLabel: 'Traffic Path',
      variantLabel: 'Vehicle Type',
    };
  }
  if (/(^|\s)(tree_cannon|donkycannongc|donkycannon_wii|donkycannon|cannon)(\s|$)/.test(sourceText)) {
    return {
      title: 'Cannon Object',
      summary: 'Launch object. Place it with the intended player approach in mind and verify its facing from the main 3D view.',
      tips: ['Use rotation controls to verify launch direction.', 'Keep the entry area visually clear so the cannon reads immediately.'],
      cautions: ['This object is only the visible cannon prop. The actual launch behavior still depends on cannon points and matching cannon-trigger collision.'],
    };
  }
  if (/(^|\s)(npc_mii|shmiiobj|dk_miiobj|miiobjd|mare_a|mare_b|miiposter)(\s|$)/.test(sourceText)) {
    const daisyCrowd = entity.objectId === 0x2e8 || entity.objectId === 0x2e9 || entity.objectId === 0x2ea;
    return {
      title: 'Mii Spectator',
      summary: 'Decorative crowd object. Use it to add life to spectator spaces without interfering with track collision or racing lines.',
      tips: ['These are best placed off the main racing surface.', 'Duplicate one placement to build crowd clusters quickly.', 'The Noki spectator variants below can face the player and clap when you tune their distance settings.'],
      cautions: daisyCrowd ? ['These Daisy Circuit crowd variants are limited to one instance each in vanilla Mario Kart Wii; more than one can crash the game.'] : undefined,
      variantLabel: 'Crowd Variant',
    };
  }

  return {
    title: flow?.name || flow?.resources || fallbackObjectName(entity.objectId),
    summary: 'Base-game object. Use placement, rotation, scale, path binding, and collision snap from the main inspector tools first.',
    tips: ['Only open Advanced object data when you need non-default behavior.', 'Use duplication and multi-select for repeated placements.'],
    routeLabel: entity.routeIndex !== undefined ? 'Path' : undefined,
  };
}
export function getObjectVariantOptions(profile: ObjectInspectorProfile, objectOptions: ObjectOption[]): ObjectOption[] {
  let variantIds: number[] = [];
  switch (profile.title) {
    case 'Item Box':
      variantIds = [0x65, 0x76, 0xc9, 0xd4, 0xee, 0xd5];
      break;
    case 'Monty Mole':
      variantIds = [0x192, 0x19a, 0x1a0];
      break;
    case 'Fire Bar':
      variantIds = [0x195, 0x1a1, 0x1a5];
      break;
    case 'Chain Chomp':
      variantIds = [0xe9, 0xeb, 0xef, 0x196];
      break;
    case 'Shy Guy Obstacle':
      variantIds = [0xce, 0xea, 0x14a];
      break;
    case 'Shy Guy':
      variantIds = [0x19c];
      break;
    case 'Breakable Box':
      variantIds = [0x70, 0xd3];
      break;
    case 'Thwomp':
      variantIds = [0xdb, 0xdc, 0xf1, 0x162];
      break;
    case 'Pokey':
      variantIds = [0x199, 0x1ab, 0x1ac];
      break;
    case 'Penguin':
      variantIds = [0xd7, 0xd8, 0xd9];
      break;
    case 'Boo':
      variantIds = [0x18c, 0x18f];
      break;
    case 'Piranha Plant':
      variantIds = [0x194, 0x1a2, 0x1aa];
      break;
    case 'Flame Jet':
      variantIds = [0x2ee, 0x1fd, 0x212, 0x216];
      break;
    case 'Jump Pad':
      variantIds = [0x20f, 0x213, 0x21a, 0x21b, 0x2f0];
      break;
    case 'Wiggler':
      variantIds = [0xe2, 0xf0, 0xf2];
      break;
    case 'Mii Spectator':
      variantIds = [0x139, 0x13a, 0x13b, 0x167, 0x168, 0x169, 0x16b, 0x16c, 0x2e8, 0x2e9, 0x2ea, 0x2eb, 0x2ec];
      break;
    case 'Spinner Hazard':
      variantIds = [0x16, 0x1a3];
      break;
    case 'Traffic Vehicle':
      variantIds = [0xcc, 0xd0, 0xd1, 0xde, 0xe7, 0xe8, 0xf3, 0x181, 0x19b];
      break;
    default:
      return [];
  }
  const byId = new Map(objectOptions.map((option) => [option.id, option]));
  return variantIds
    .map((id) => byId.get(id))
    .filter((option): option is ObjectOption => option !== undefined);
}
export function describePresenceFlags(value: number): string {
  const activeLabels = gobjPresenceModeOptions.filter((option) => (value & option.mask) !== 0).map((option) => option.label);
  const lowBits = value & 0x0007;
  const summary = activeLabels.length > 0 ? activeLabels.join(', ') : 'Hidden in all player-count modes';
  return `${summary} (${formatPresenceFlagsHex(value)}${value !== lowBits ? ` behaves like ${formatPresenceFlagsHex(lowBits)} in vanilla MKWii` : ''})`;
}

export function formatPresenceFlagsHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}
