/**
 * Create mode, design -> track (workstream C). Pure TypeScript, no React.
 *
 * The asset kit lives in `./kit` and the binary writers in `./writers`; import those directly.
 * Everything here is deterministic given a `CreateProject` and a `CreateKit`.
 */
export * from './spline';
export * from './roadStyles';
export * from './sections';
export * from './road';
export * from './terrain';
export * from './pieces';
export * from './props';
export * from './kmpGen';
export * from './compile';
export * from './raycast';
export * from './ops';
export * from './templates';
export * from './analyze';
export { createId, setIdGenerator, useDeterministicIds, useRandomIds } from './ids';
export {
  KCL_TYPE,
  KCL_TRICKABLE_BIT,
  FLAG_BOOST_PANEL,
  FLAG_BOOST_RAMP,
  FLAG_FALL_BOUNDARY,
  FLAG_INVISIBLE_WALL,
  FLAG_TRICK_RAMP,
  FLAG_WALL,
  isDrivableFlag,
  isFallFlag,
  isRoadLikeFlag,
  isWallFlag,
  makeKclFlag,
} from './kclTypes';
