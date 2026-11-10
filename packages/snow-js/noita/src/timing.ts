// Fixed 60 Hz simulation tick shared by every runtime, the physics stepper,
// and the frame-budget stats. One source of truth for the step interval.
export const FRAME_MS = 1000 / 60;
