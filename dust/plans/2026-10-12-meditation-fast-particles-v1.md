# Meditation fast particle path (plan C)

## Objective

Cut the meditation page's per-frame CPU cost (post-A baseline at 1080p device
resolution: ~78 ms simulation step + ~27 ms particle draw with an ~800 k
particle pool) by ≥2.5× using fround-free, profile-specialized particle
integration and a leaner 1 px body-render loop. The user has explicitly chosen
speed over bit-exactness for this page: the fast path may drift from the
fround reference within tight visual bounds, but it must not change the RNG
stream, emission counts, or particle lifetimes — the trail structure, timing
and overall look stay identical. All other consumers (GIF export, demo, grid,
single-effect preview) remain byte-exact: the fast path is opt-in via a
simulation flag and defaults off.

## Background

- The meditation page's cost is dominated by per-particle work, not the
  raster pipeline (fixed overhead was removed separately by the glow=false
  identity path in `src/software-renderer.ts`).
- `stepParticle` (`src/portal-physics.ts:279`) spends ~100 ns/particle:
  ~25 `Math.fround` calls plus a `simplex3` airflow evaluation. It is a pure
  function of particle state — no RNG — so its internals may be specialized
  without touching simulation structure.
- The draw loop (`src/software-renderer.ts:802-812`) calls `drawParticle` →
  `bodyRect` (`src/software-renderer.ts:288`) for 1×1 / 2×1 px rects at
  ~33 ns/particle; call overhead, clamp dance and per-call color decode
  dominate.
- Pool size (~800 k at 1080p) is out of scope here (that is lever B); this
  plan only makes per-particle work cheaper.

## Implementation Plan

- [ ] 1. Bench + render-diff harness, record baseline
  - Details: add `scripts/bench-meditation.ts` (stage timings: step vs render,
    particle count, at 1920×1080 with the meditation options: density =
    scale×2, glow off, 400 warmup + 60 measured frames) and
    `scripts/render-diff.ts` (renders 600 frames of the meditation config at
    480×320 twice — exact path as reference — and reports mean / p99.9 |ΔRGB|
    plus nonzero-pixel-count delta; supports comparing two builds via
    `--against <file>` where a baseline snapshot of per-frame output hashes is
    stored in `scripts/fixtures/meditation-baseline.json`). Adapt the working
    prototype at `/tmp/bench-meditation.ts`. Run both before any code change
    and commit the baseline.
  - Rationale: there is no test suite (`AGENTS.md` "Verifying" section);
    without a harness neither the speed gain nor the drift bound is verifiable.
  - Dependencies: none.

- [ ] 2. Fround-free specialized particle integration (opt-in flag)
  - Details: add `fastParticles?: boolean` to `SimulationOptions`
    (`src/types.ts:307`), stored by `PortalSimulation` and used in
    `advanceParticles` (`src/portal-physics.ts:758`) to select a new
    `stepParticleFast` alongside the untouched `stepParticle`
    (`src/portal-physics.ts:279`). `stepParticleFast` keeps the identical
    branch structure and field updates (including `prevX/prevY` stroke
    bookkeeping and the `retainInvisible` contract) but: drops every
    `Math.fround` (float64 math), hoists `dt` and per-particle constant flags
    (`friction`, `attractor`, `airflowForce`) out of the per-frame expression
    tree, and evaluates the common profile (friction 0, no attractor,
    airflow on — all meditation trail particles) in one specialized branch.
    No RNG calls, no emission changes, no new particle fields beyond the
    flag read. `p.life >= 0` return contract unchanged.
  - Rationale: step is 78 ms of the 105 ms frame; fround quantization and
    polymorphic field access are the bulk of it. Float64 is strictly more
    precise; divergence vs the reference grows smoothly from the discarded
    quantization and stays bounded (verified by task 4 gates).
  - Dependencies: task 1 (harness must exist to measure and bound drift).

- [ ] 3. Lean 1 px body rendering (exact, unconditional)
  - Details: in `SoftwareRenderer.render`'s particle loop
    (`src/software-renderer.ts:802-812`), inline the rect-blend for the
    dominant `width ≤ 2, height == 1` case: hoist `rgb(color)`/alpha decode to
    per-particle locals, keep the exact `ceil(left - 0.5)` / clamp pixel
    selection semantics of `bodyRect` (`src/software-renderer.ts:288-322`), and
    avoid the function call + repeated `this.width`/`this.scene` loads. When
    the particle is provably interior (`x0 ≥ 0 && x1 ≤ width`, same for y),
    skip the clamps entirely. No behavioral change: output must stay
    byte-identical (this task does not rely on the speed-over-exactness
    allowance).
  - Rationale: draw stage is ~27 ms; call overhead and clamping are most of
    the cost for 1 px rects.
  - Dependencies: task 1 (byte-identity gate).

- [ ] 4. Drift + regression gates into the harness
  - Details: extend `scripts/render-diff.ts` with two modes: (a)
    `--exact-regression` — fast flag OFF, output must hash-match the
    pre-change baseline snapshot frame-for-frame; (b) `--drift` — fast flag ON
    vs OFF: require mean |ΔRGB| ≤ 2, p99.9 ≤ 16, nonzero-pixel count within
    1%, and identical per-frame emission counts for the first 1000 frames
    (asserts the RNG stream is untouched — this is the "same look" gate, not
    just a pixel gate). Also render one `export-loops.json` meditation frame
    with the exact path before/after and require byte equality (GIF
    consumers).
  - Rationale: "tiny visual drift" needs a number; the emission-count
    assertion is what guarantees the trails don't change shape, only shading.
  - Dependencies: tasks 1-3.

- [ ] 5. Enable the fast path for meditation and document the boundary
  - Details: set `fastParticles: true` in the meditation replay options
    (`src/meditation.ts:21`). Document the deliberate deviation in a comment
    on `stepParticleFast` (`src/portal-physics.ts`): fast path is
    presentation-only, opt-in, never used by GIF/demo/grid/preview; reference
    remains `stepParticle`. No changes to `AGENTS.md` invariants.
  - Rationale: the flag must be off everywhere except the page that accepted
    the trade.
  - Dependencies: task 4 (gates must pass before enabling).

## Verification Criteria

- `bun run typecheck` and `bun run build` exit 0.
- `bun scripts/bench-meditation.ts`: 1080p steady-state step ≤ 32 ms (≥2.4×
  vs 78 ms baseline) and render stage ≤ 20 ms (≥1.3× vs 27 ms); prints both.
- `bun scripts/render-diff.ts --exact-regression`: 0 differing frames vs the
  task-1 baseline snapshot (fast flag off, all pages).
- Output alpha plane: after every render, output[i+3] === 255 for all pixels
  (meditation config and one math_ config with native quads). putImageData
  surfaces the alpha plane even on alpha:false canvases — a 0 alpha byte
  composites as transparent and unpremultiplying it reads as white.
- `bun scripts/render-diff.ts --drift`: mean |ΔRGB| ≤ 2, p99.9 ≤ 16,
  nonzero-pixel count within ±1%, per-frame emission counts equal for 1000
  frames (fast on vs off).
- GIF-path spot check: one meditation export-loop frame byte-identical to
  baseline.

## Potential Risks and Mitigations

1. **Fast path perturbs the RNG stream** (would change trail layout entirely,
   not "drift").
   - Mitigation: `stepParticle`/`advanceParticles` contain no RNG (verified by
     read; `simplex3` is deterministic noise); the harness asserts identical
     per-frame emission counts for 1000 frames.
2. **Position drift exceeds visual tolerance over 5.5 s lifetimes** (airflow
   noise input `nx·scale` is position-fed; divergence could compound).
   - Mitigation: drift gates (mean ≤ 2, p99.9 ≤ 16) catch it mechanically;
     airflow `scale` is 0.03 so even multi-cell deltas barely move the noise
     sample. If a gate fails, fall back to keeping `fround` only on the
     position/velocity update (still ~1.5×) and re-gate.
3. **Inline draw specialization changes pixel selection at rect edges**.
   - Mitigation: keep the exact `ceil(left - 0.5)` + clamp arithmetic in the
     inlined path; byte-identity gate on the exact path runs in every
     verification round.
4. **Polymorphic step dispatch costs more than it saves** (mixed particle
   profiles in the pool).
   - Mitigation: meditation pools are ~100 % one profile (trail); the
     specialized branch is chosen on flags read once per particle, not a
     megamorphic call site; bench measures the actual mixed pool.
5. **Display-path alpha semantics** (learned the hard way by the glow=false
   identity change): the output alpha plane is display-relevant even on
   alpha:false canvases — putImageData keeps the alpha byte, and
   unpremultiplying a=0 turns pixels white on some engines.
   - Mitigation: the scene clear fills 0xff000000 u32s (black + opaque
     alpha) and no raster path writes the alpha byte; the harness asserts
     output alpha === 255 for every frame (see Verification Criteria).

## Alternative Approaches

1. **SoA typed-array particle pool** — biggest possible win (est. 5-8× on
   step) but restructures the Particle object contract consumed by
   emissions, dedup, GIF rendering and effect-simulation; a multi-session
   refactor with real regression risk. Deferred; revisit only if tasks 2-3
   miss the target and lever B stays off the table.
2. **Wasm-side step loop** — `static/assets/raster.wasm` is a game-shipped
   input nothing in the repo generates (`AGENTS.md`); a new wasm module would
   fork the "shipped assets are inputs" story. Rejected.
3. **Lever B (density/lifetime reduction)** — the only lever that reaches
   60 fps alone (~800 k → ~200 k particles); rejected here because it changes
   the authored look, while this plan is CPU-only. Synergy note: B on top of
   this plan would put 1080p at ~15 ms.
4. **Render-time trail subdivision** (sim at density 1, draw ~scale×2 dots
   per particle along `prevX/prevY → x/y`) — cuts step to ~12 ms but changes
   per-dot physics (each dot drifts independently after emission), a
   structural visual change, not drift. Rejected.

## Non-Goals

- Pool-size reduction (density multiplier, `minTrailLifetime`, adaptive
  quality) — lever B, separate decision.
- Worker/OffscreenCanvas plumbing or putImageData changes.
- Any change to GIF export, demo, grid or the single-effect preview pages.
- Bit-exactness of the meditation fast path (explicitly waived by the user;
  bounded by the task-4 gates instead).

## Assumptions

- "Speed over exactness" applies to the meditation page only; the reference
  renderer and GIF path stay byte-exact (repo invariant kept by the opt-in
  flag and default-off).
- Bun is an acceptable measurement environment for the harness (matches the
  investigation numbers; browser worker adds only putImageData, measured ~3-5
  ms and unchanged by this plan).
