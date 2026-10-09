// The four materials of the Predictle world. Fixed for ALL days so players can
// learn the rules: changing any number here changes the physics of every
// future puzzle, so it needs the owner's sign-off (see docs/engine-decision.md).
//
// Mixing rules (set in the simulator, not left to engine defaults):
//   friction    = min of the two surfaces  -> ice is slippery whatever touches it
//   restitution = max of the two surfaces  -> rubber is bouncy whatever touches it
//   rolling     = Box2D's rolling resistance (max of the two), so balls come to rest
// so a player can reason about one surface at a time.
//
// colour + pattern are both distinct, so the materials can be told apart
// without colour vision (pattern) and in greyscale (lightness differs).

export const MATERIALS = {
  wood:   { id: 0, density: 1.0, friction: 0.5,  restitution: 0.15, rolling: 0.04, colour: "#c08a4e", ink: "#7a4f22", pattern: "grain",   label: "Wood",   note: "normal" },
  rubber: { id: 1, density: 1.2, friction: 0.9,  restitution: 0.85, rolling: 0.06, colour: "#e0457b", ink: "#8c1d45", pattern: "dots",    label: "Rubber", note: "bouncy" },
  ice:    { id: 2, density: 0.9, friction: 0.02, restitution: 0.05, rolling: 0.01, colour: "#9fd8f2", ink: "#3b8db5", pattern: "hatch",   label: "Ice",    note: "slippery" },
  steel:  { id: 3, density: 6.0, friction: 0.4,  restitution: 0.05, rolling: 0.02, colour: "#7d8794", ink: "#3a4049", pattern: "rivets",  label: "Steel",  note: "heavy" },
};

export const MATERIAL_BY_ID = Object.values(MATERIALS).sort((a, b) => a.id - b.id);
export const materialName = (id) => Object.keys(MATERIALS).find((k) => MATERIALS[k].id === id);

// World size in metres. Portrait 3:4; everything must stay inside it.
export const WORLD = { width: 9, height: 12 };
