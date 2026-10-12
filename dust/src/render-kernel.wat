;; Wasm render kernel for software-renderer.ts's inlined 1-2 px particle body
;; blend. Byte-exact replica of the lean blend in render() (see the "Lean
;; 1-2 px x 1 px body blend" block), fed from the simulation's SoA particle
;; mirror (portal-physics.ts): xs/ys/alpha as f64 columns, packed meta u32.
;;
;; Per-particle meta layout (built by PortalSimulation.advanceParticles):
;;   bit 0    onGrid === false
;;   bit 1    drawLong (never blended here; reported via the return value)
;;   bit 2    wide (2 px body: singleWidth === false && cellType gas/fire)
;;   bits 8+  particle color RGB (color & 0xffffff; PURPLE when unset)
;;
;; Scene is RGBA8 at offset 0 of the imported memory. Blend stores replicate
;; Uint8ClampedArray semantics: every written value is a weighted average of
;; two bytes in [0, 255], so f64x2.nearest + i32.store8 match the clamped
;; round-half-even store exactly.
;;
;; Odd particle counts: the caller stores alpha = 0 at staging index n (one
;; spare slot); the pad lane dies on the alpha test, so the kernel only walks
;; pairs and needs no scalar tail.
(module
  (import "env" "mem" (memory 1))

  ;; Scalar blend of one body rect (pixel bounds already ceiled by the caller,
  ;; as f64 to pass through the vector lane extracts). Mirrors the reference's
  ;; clamp dance and blend arithmetic; the px loop covers 1 or 2 columns.
  (func $blendLane
    (param $scene i32) (param $x0 f64) (param $x1 f64) (param $y0 f64) (param $y1 f64)
    (param $r f64) (param $g f64) (param $b f64) (param $inv f64)
    (param $sw i32) (param $sh i32)
    (local $ix0 i32) (local $ix1 i32) (local $iy0 i32) (local $iy1 i32)
    (local $px i32) (local $py i32) (local $row i32) (local $i4 i32) (local $vi i32)
    (local $clamp i32) (local $t i32)
    local.get $x0
    i32.trunc_f64_s
    local.set $ix0
    local.get $x1
    i32.trunc_f64_s
    local.set $ix1
    local.get $y0
    i32.trunc_f64_s
    local.set $iy0
    local.get $y1
    i32.trunc_f64_s
    local.set $iy1
    ;; if (x0 < 0 || x1 > sw || y0 < 0 || y1 > sh) clamp all four
    local.get $ix0
    i32.const 0
    i32.lt_s
    local.get $ix1
    local.get $sw
    i32.gt_s
    i32.or
    local.get $iy0
    i32.const 0
    i32.lt_s
    i32.or
    local.get $iy1
    local.get $sh
    i32.gt_s
    i32.or
    local.set $clamp
    local.get $clamp
    if
      ;; ix0 = min(sw, max(0, ix0)) — select(v1, v2, cond) = cond ? v1 : v2
      local.get $ix0
      i32.const 0
      local.get $ix0
      i32.const 0
      i32.gt_s
      select
      local.set $t
      local.get $sw
      local.get $t
      local.get $sw
      local.get $t
      i32.lt_s
      select
      local.set $ix0
      local.get $ix1
      i32.const 0
      local.get $ix1
      i32.const 0
      i32.gt_s
      select
      local.set $t
      local.get $sw
      local.get $t
      local.get $sw
      local.get $t
      i32.lt_s
      select
      local.set $ix1
      local.get $iy0
      i32.const 0
      local.get $iy0
      i32.const 0
      i32.gt_s
      select
      local.set $t
      local.get $sh
      local.get $t
      local.get $sh
      local.get $t
      i32.lt_s
      select
      local.set $iy0
      local.get $iy1
      i32.const 0
      local.get $iy1
      i32.const 0
      i32.gt_s
      select
      local.set $t
      local.get $sh
      local.get $t
      local.get $sh
      local.get $t
      i32.lt_s
      select
      local.set $iy1
    end
    local.get $iy0
    local.set $py
    block $rowsDone
      loop $rows
        local.get $py
        local.get $iy1
        i32.ge_s
        br_if $rowsDone
        local.get $py
        local.get $sw
        i32.mul
        local.set $row
        local.get $ix0
        local.set $px
        block $colsDone
          loop $cols
            local.get $px
            local.get $ix1
            i32.ge_s
            br_if $colsDone
            local.get $scene
            local.get $row
            local.get $px
            i32.add
            i32.const 4
            i32.mul
            i32.add
            local.set $i4
            ;; R: scene[i4] = r + scene[i4] * inv
            local.get $scene
            local.get $i4
            i32.load8_u
            f64.convert_i32_u
            local.get $inv
            f64.mul
            local.get $r
            f64.add
            f64.nearest
            i32.trunc_f64_s
            local.set $vi
            local.get $scene
            local.get $i4
            i32.add
            local.get $vi
            i32.store8
            ;; G: scene[i4+1] = g + scene[i4+1] * inv
            local.get $scene
            local.get $i4
            i32.load8_u offset=1
            f64.convert_i32_u
            local.get $inv
            f64.mul
            local.get $g
            f64.add
            f64.nearest
            i32.trunc_f64_s
            local.set $vi
            local.get $scene
            local.get $i4
            i32.add
            local.get $vi
            i32.store8 offset=1
            ;; B: scene[i4+2] = b + scene[i4+2] * inv
            local.get $scene
            local.get $i4
            i32.load8_u offset=2
            f64.convert_i32_u
            local.get $inv
            f64.mul
            local.get $b
            f64.add
            f64.nearest
            i32.trunc_f64_s
            local.set $vi
            local.get $scene
            local.get $i4
            i32.add
            local.get $vi
            i32.store8 offset=2
            local.get $px
            i32.const 1
            i32.add
            local.set $px
            br $cols
          end
        end
        local.get $py
        i32.const 1
        i32.add
        local.set $py
        br $rows
      end
    end
  )

  ;; Blend all staged particles. Pointers are byte offsets into env.mem.
  ;; Returns the number of drawLong particles encountered (callers re-render
  ;; through the JS loop when nonzero; the normal gate keeps it at zero).
  (func (export "blend")
    (param $scene i32) (param $xs i32) (param $ys i32) (param $as i32) (param $meta i32)
    (param $n i32)
    (param $scale f64) (param $ox f64) (param $oy f64) (param $margin f64)
    (param $sw i32) (param $sh i32)
    (result i32)
    (local $i i32) (local $np i32) (local $skipped i32)
    (local $m0 i32) (local $m1 i32) (local $c0 i32) (local $c1 i32)
    (local $x2 v128) (local $y2 v128) (local $a2 v128)
    (local $active v128) (local $ogm v128) (local $width2 v128) (local $half2 v128)
    (local $a8 v128) (local $af v128) (local $inv v128)
    (local $r v128) (local $g v128) (local $b v128)
    (local $bx v128) (local $by v128)
    (local $x0 v128) (local $x1 v128) (local $y0 v128) (local $y1 v128)
    (local $tmp v128) (local $m v128)
    ;; np = n + (n & 1): the caller staged alpha = 0 at index n when odd.
    local.get $n
    local.get $n
    i32.const 1
    i32.and
    i32.add
    local.set $np
    i32.const 0
    local.set $i
    i32.const 0
    local.set $skipped
    block $done
      loop $pair
        ;; while (i + 1 < np)
        local.get $i
        i32.const 1
        i32.add
        local.get $np
        i32.ge_u
        br_if $done
        ;; m0 = meta[i], m1 = meta[i+1]
        local.get $meta
        local.get $i
        i32.const 2
        i32.shl
        i32.add
        i32.load
        local.set $m0
        local.get $meta
        local.get $i
        i32.const 2
        i32.shl
        i32.add
        i32.const 4
        i32.add
        i32.load
        local.set $m1
        ;; x2 / y2 / a2 lanes = particles i, i+1
        local.get $xs
        local.get $i
        i32.const 3
        i32.shl
        i32.add
        v128.load
        local.set $x2
        local.get $ys
        local.get $i
        i32.const 3
        i32.shl
        i32.add
        v128.load
        local.set $y2
        local.get $as
        local.get $i
        i32.const 3
        i32.shl
        i32.add
        v128.load
        local.set $a2
        ;; width2 = wide ? 2 : 1 per lane (meta bit 2)
        f64.const 1
        f64x2.splat
        local.set $width2
        local.get $m0
        i32.const 4
        i32.and
        if
          local.get $width2
          f64.const 2
          f64x2.replace_lane 0
          local.set $width2
        end
        local.get $m1
        i32.const 4
        i32.and
        if
          local.get $width2
          f64.const 2
          f64x2.replace_lane 1
          local.set $width2
        end
        ;; half2 = wide ? 0.5 : 1 per lane (the alpha pre-scale)
        f64.const 1
        f64x2.splat
        local.set $half2
        local.get $m0
        i32.const 4
        i32.and
        if
          local.get $half2
          f64.const 0.5
          f64x2.replace_lane 0
          local.set $half2
        end
        local.get $m1
        i32.const 4
        i32.and
        if
          local.get $half2
          f64.const 0.5
          f64x2.replace_lane 1
          local.set $half2
        end
        ;; alpha8 = trunc((a * half2) * 255) & 255, back to f64
        local.get $a2
        local.get $half2
        f64x2.mul
        f64.const 255
        f64x2.splat
        f64x2.mul
        f64x2.trunc
        i32x4.trunc_sat_f64x2_s_zero
        i32.const 255
        i32x4.splat
        v128.and
        f64x2.convert_low_i32x4_u
        local.set $a8
        ;; af = alpha8 / 255 ; inv = 1 - af
        local.get $a8
        f64.const 255
        f64x2.splat
        f64x2.div
        local.set $af
        f64.const 1
        f64x2.splat
        local.get $af
        f64x2.sub
        local.set $inv
        ;; base = (a > 0) & in-x & in-y — the JS loop culls these before
        ;; handing drawLong particles to drawParticle(), so the drawLong
        ;; count is gated on exactly this mask (alpha8 gate comes later)
        local.get $a2
        f64.const 0
        f64x2.splat
        f64x2.gt
        local.set $active
        ;; xpix = x * scale + ox ; keep when -margin <= xpix <= sw + margin
        local.get $x2
        local.get $scale
        f64x2.splat
        f64x2.mul
        local.get $ox
        f64x2.splat
        f64x2.add
        local.set $tmp
        local.get $tmp
        local.get $margin
        f64.neg
        f64x2.splat
        f64x2.ge
        local.set $m
        local.get $active
        local.get $m
        v128.and
        local.set $active
        local.get $tmp
        local.get $sw
        f64.convert_i32_s
        local.get $margin
        f64.add
        f64x2.splat
        f64x2.le
        local.set $m
        local.get $active
        local.get $m
        v128.and
        local.set $active
        ;; ypix = y * scale + oy ; keep when -margin <= ypix <= sh + margin
        local.get $y2
        local.get $scale
        f64x2.splat
        f64x2.mul
        local.get $oy
        f64x2.splat
        f64x2.add
        local.set $tmp
        local.get $tmp
        local.get $margin
        f64.neg
        f64x2.splat
        f64x2.ge
        local.set $m
        local.get $active
        local.get $m
        v128.and
        local.set $active
        local.get $tmp
        local.get $sh
        f64.convert_i32_s
        local.get $margin
        f64.add
        f64x2.splat
        f64x2.le
        local.set $m
        local.get $active
        local.get $m
        v128.and
        local.set $active
        ;; drawLong lanes (meta bit 1): never blended here, counted for the caller
        f64.const 0
        f64x2.splat
        local.set $tmp
        local.get $m0
        i32.const 2
        i32.and
        if
          local.get $tmp
          f64.const 1
          f64x2.replace_lane 0
          local.set $tmp
        end
        local.get $m1
        i32.const 2
        i32.and
        if
          local.get $tmp
          f64.const 1
          f64x2.replace_lane 1
          local.set $tmp
        end
        local.get $tmp
        f64.const 0
        f64x2.splat
        f64x2.ne
        local.set $tmp
        ;; count drawLong lanes passing a>0 + margin (pad lane has meta 0,
        ;; never counts); caller re-renders via JS when the count is nonzero
        local.get $tmp
        local.get $active
        v128.and
        local.set $m
        local.get $m
        i64x2.extract_lane 0
        i64.eqz
        i32.eqz
        if
          local.get $skipped
          i32.const 1
          i32.add
          local.set $skipped
        end
        local.get $m
        i64x2.extract_lane 1
        i64.eqz
        i32.eqz
        if
          local.get $skipped
          i32.const 1
          i32.add
          local.set $skipped
        end
        ;; alpha8 > 0 gate, then drop drawLong lanes
        local.get $a8
        f64.const 0
        f64x2.splat
        f64x2.gt
        local.set $m
        local.get $active
        local.get $m
        v128.and
        local.set $active
        local.get $active
        local.get $tmp
        v128.andnot
        local.set $active
        ;; og mask (meta bit 0)
        f64.const 0
        f64x2.splat
        local.set $tmp
        local.get $m0
        i32.const 1
        i32.and
        if
          local.get $tmp
          f64.const 1
          f64x2.replace_lane 0
          local.set $tmp
        end
        local.get $m1
        i32.const 1
        i32.and
        if
          local.get $tmp
          f64.const 1
          f64x2.replace_lane 1
          local.set $tmp
        end
        local.get $tmp
        f64.const 0
        f64x2.splat
        f64x2.ne
        local.set $ogm
        ;; bx = (og ? roundCell(x + 0.5) : x) - width) * scale + ox
        local.get $x2
        f64.const 0.5
        f64x2.splat
        f64x2.add
        local.set $tmp
        local.get $tmp
        f64.const 0
        f64x2.splat
        f64x2.ge
        local.set $m
        f64.const 0.5
        f64x2.splat
        f64.const -0.5
        f64x2.splat
        local.get $m
        v128.bitselect
        local.set $m
        local.get $tmp
        local.get $m
        f64x2.add
        f64x2.floor
        local.set $tmp
        ;; srcX = bit0 ? raw x : roundCell(x + 0.5)  (bit0 = onGrid === false)
        local.get $x2
        local.get $tmp
        local.get $ogm
        v128.bitselect
        local.set $tmp
        local.get $tmp
        local.get $width2
        f64x2.sub
        local.get $scale
        f64x2.splat
        f64x2.mul
        local.get $ox
        f64x2.splat
        f64x2.add
        local.set $bx
        ;; x0 = ceil(bx - 0.5) ; x1 = ceil(bx + width - 0.5)
        local.get $bx
        f64.const 0.5
        f64x2.splat
        f64x2.sub
        f64x2.ceil
        local.set $x0
        local.get $bx
        local.get $width2
        f64x2.add
        f64.const 0.5
        f64x2.splat
        f64x2.sub
        f64x2.ceil
        local.set $x1
        ;; by = (og ? roundCell(y + 0.5) : y) - 1) * scale + oy
        local.get $y2
        f64.const 0.5
        f64x2.splat
        f64x2.add
        local.set $tmp
        local.get $tmp
        f64.const 0
        f64x2.splat
        f64x2.ge
        local.set $m
        f64.const 0.5
        f64x2.splat
        f64.const -0.5
        f64x2.splat
        local.get $m
        v128.bitselect
        local.set $m
        local.get $tmp
        local.get $m
        f64x2.add
        f64x2.floor
        local.set $tmp
        ;; srcY = bit0 ? raw y : roundCell(y + 0.5)
        local.get $y2
        local.get $tmp
        local.get $ogm
        v128.bitselect
        f64.const 1
        f64x2.splat
        f64x2.sub
        local.get $scale
        f64x2.splat
        f64x2.mul
        local.get $oy
        f64x2.splat
        f64x2.add
        local.set $by
        ;; y0 = ceil(by - 0.5) ; y1 = ceil(by + 1 - 0.5)
        local.get $by
        f64.const 0.5
        f64x2.splat
        f64x2.sub
        f64x2.ceil
        local.set $y0
        local.get $by
        f64.const 0.5
        f64x2.splat
        f64x2.add
        f64x2.ceil
        local.set $y1
        ;; r/g/b = channel * af, channels decoded from meta bits 8+
        local.get $m0
        i32.const 8
        i32.shr_u
        local.set $c0
        local.get $m1
        i32.const 8
        i32.shr_u
        local.set $c1
        f64.const 0
        f64x2.splat
        local.get $c0
        i32.const 16
        i32.shr_u
        i32.const 255
        i32.and
        f64.convert_i32_u
        f64x2.replace_lane 0
        local.get $c1
        i32.const 16
        i32.shr_u
        i32.const 255
        i32.and
        f64.convert_i32_u
        f64x2.replace_lane 1
        local.get $af
        f64x2.mul
        local.set $r
        f64.const 0
        f64x2.splat
        local.get $c0
        i32.const 8
        i32.shr_u
        i32.const 255
        i32.and
        f64.convert_i32_u
        f64x2.replace_lane 0
        local.get $c1
        i32.const 8
        i32.shr_u
        i32.const 255
        i32.and
        f64.convert_i32_u
        f64x2.replace_lane 1
        local.get $af
        f64x2.mul
        local.set $g
        f64.const 0
        f64x2.splat
        local.get $c0
        i32.const 255
        i32.and
        f64.convert_i32_u
        f64x2.replace_lane 0
        local.get $c1
        i32.const 255
        i32.and
        f64.convert_i32_u
        f64x2.replace_lane 1
        local.get $af
        f64x2.mul
        local.set $b
        ;; lane 0
        local.get $active
        i64x2.extract_lane 0
        i64.eqz
        i32.eqz
        if
          local.get $scene
          local.get $x0
          f64x2.extract_lane 0
          local.get $x1
          f64x2.extract_lane 0
          local.get $y0
          f64x2.extract_lane 0
          local.get $y1
          f64x2.extract_lane 0
          local.get $r
          f64x2.extract_lane 0
          local.get $g
          f64x2.extract_lane 0
          local.get $b
          f64x2.extract_lane 0
          local.get $inv
          f64x2.extract_lane 0
          local.get $sw
          local.get $sh
          call $blendLane
        end
        ;; lane 1
        local.get $active
        i64x2.extract_lane 1
        i64.eqz
        i32.eqz
        if
          local.get $scene
          local.get $x0
          f64x2.extract_lane 1
          local.get $x1
          f64x2.extract_lane 1
          local.get $y0
          f64x2.extract_lane 1
          local.get $y1
          f64x2.extract_lane 1
          local.get $r
          f64x2.extract_lane 1
          local.get $g
          f64x2.extract_lane 1
          local.get $b
          f64x2.extract_lane 1
          local.get $inv
          f64x2.extract_lane 1
          local.get $sw
          local.get $sh
          call $blendLane
        end
        local.get $i
        i32.const 2
        i32.add
        local.set $i
        br $pair
      end
    end
    local.get $skipped
  )

  ;; Debug: run the pair body for particle pair (0, 1) and return
  ;; [bx0, by0, x0_0, x1_0, y0_0, y1_0, af_0, m0] as f64s.
  (func (export "dbgpair")
    (param $scene i32) (param $xs i32) (param $ys i32) (param $as i32) (param $meta i32)
    (param $scale f64) (param $ox f64) (param $oy f64) (param $margin f64)
    (param $sw i32) (param $sh i32)
    (result f64 f64 f64 f64 f64 f64 f64 f64)
    (local $m0 i32) (local $m1 i32)
    (local $x2 v128) (local $y2 v128) (local $a2 v128) (local $a8 v128)
    (local $active v128) (local $tmp v128) (local $m v128)
    (local $ogm v128) (local $width2 v128) (local $half2 v128)
    (local $af v128) (local $bx v128) (local $by v128)
    (local $x0 v128) (local $x1 v128) (local $y0 v128) (local $y1 v128)
    local.get $meta
    i32.load
    local.set $m0
    local.get $meta
    i32.load offset=4
    local.set $m1
    local.get $xs
    v128.load
    local.set $x2
    local.get $ys
    v128.load
    local.set $y2
    local.get $as
    v128.load
    local.set $a2
    local.get $a2
    f64.const 0
    f64x2.splat
    f64x2.gt
    local.set $active
    local.get $x2
    local.get $scale
    f64x2.splat
    f64x2.mul
    local.get $ox
    f64x2.splat
    f64x2.add
    local.set $tmp
    local.get $tmp
    local.get $margin
    f64.neg
    f64x2.splat
    f64x2.ge
    local.set $m
    local.get $active
    local.get $m
    v128.and
    local.set $active
    local.get $tmp
    local.get $sw
    f64.convert_i32_s
    local.get $margin
    f64.add
    f64x2.splat
    f64x2.le
    local.set $m
    local.get $active
    local.get $m
    v128.and
    local.set $active
    local.get $y2
    local.get $scale
    f64x2.splat
    f64x2.mul
    local.get $oy
    f64x2.splat
    f64x2.add
    local.set $tmp
    local.get $tmp
    local.get $margin
    f64.neg
    f64x2.splat
    f64x2.ge
    local.set $m
    local.get $active
    local.get $m
    v128.and
    local.set $active
    local.get $tmp
    local.get $sh
    f64.convert_i32_s
    local.get $margin
    f64.add
    f64x2.splat
    f64x2.le
    local.set $m
    local.get $active
    local.get $m
    v128.and
    local.set $active
    ;; a8 for lane 0
    f64.const 1
    f64x2.splat
    local.set $tmp
    local.get $a2
    local.get $tmp
    f64x2.mul
    f64.const 255
    f64x2.splat
    f64x2.mul
    f64x2.trunc
    i32x4.trunc_sat_f64x2_s_zero
    i32.const 255
    i32x4.splat
    v128.and
    f64x2.convert_low_i32x4_u
    local.set $a8
    ;; geometry for lane 0: [bx, by, x0, x1, y0, y1, af, m0]
    local.get $a8
    f64.const 255
    f64x2.splat
    f64x2.div
    local.set $af
    f64.const 0
    f64x2.splat
    local.set $tmp
    local.get $m0
    i32.const 1
    i32.and
    if
      local.get $tmp
      f64.const 1
      f64x2.replace_lane 0
      local.set $tmp
    end
    local.get $tmp
    f64.const 0
    f64x2.splat
    f64x2.ne
    local.set $ogm
    f64.const 1
    f64x2.splat
    local.set $width2
    local.get $m0
    i32.const 4
    i32.and
    if
      local.get $width2
      f64.const 2
      f64x2.replace_lane 0
      local.set $width2
    end
    local.get $x2
    f64.const 0.5
    f64x2.splat
    f64x2.add
    local.set $tmp
    local.get $tmp
    f64.const 0
    f64x2.splat
    f64x2.ge
    local.set $m
    f64.const 0.5
    f64x2.splat
    f64.const -0.5
    f64x2.splat
    local.get $m
    v128.bitselect
    local.set $m
    local.get $tmp
    local.get $m
    f64x2.add
    f64x2.floor
    local.set $tmp
    local.get $x2
    local.get $tmp
    local.get $ogm
    v128.bitselect
    local.set $tmp
    local.get $tmp
    local.get $width2
    f64x2.sub
    local.get $scale
    f64x2.splat
    f64x2.mul
    local.get $ox
    f64x2.splat
    f64x2.add
    local.set $bx
    local.get $bx
    f64.const 0.5
    f64x2.splat
    f64x2.sub
    f64x2.ceil
    local.set $x0
    local.get $bx
    local.get $width2
    f64x2.add
    f64.const 0.5
    f64x2.splat
    f64x2.sub
    f64x2.ceil
    local.set $x1
    local.get $y2
    f64.const 0.5
    f64x2.splat
    f64x2.add
    local.set $tmp
    local.get $tmp
    f64.const 0
    f64x2.splat
    f64x2.ge
    local.set $m
    f64.const 0.5
    f64x2.splat
    f64.const -0.5
    f64x2.splat
    local.get $m
    v128.bitselect
    local.set $m
    local.get $tmp
    local.get $m
    f64x2.add
    f64x2.floor
    local.set $tmp
    local.get $y2
    local.get $tmp
    local.get $ogm
    v128.bitselect
    f64.const 1
    f64x2.splat
    f64x2.sub
    local.get $scale
    f64x2.splat
    f64x2.mul
    local.get $oy
    f64x2.splat
    f64x2.add
    local.set $by
    local.get $by
    f64.const 0.5
    f64x2.splat
    f64x2.sub
    f64x2.ceil
    local.set $y0
    local.get $by
    f64.const 0.5
    f64x2.splat
    f64x2.add
    f64x2.ceil
    local.set $y1
    local.get $bx
    f64x2.extract_lane 0
    local.get $by
    f64x2.extract_lane 0
    local.get $x0
    f64x2.extract_lane 0
    local.get $x1
    f64x2.extract_lane 0
    local.get $y0
    f64x2.extract_lane 0
    local.get $y1
    f64x2.extract_lane 0
    local.get $af
    f64x2.extract_lane 0
    local.get $m0
    f64.convert_i32_u
  )

  ;; ------------------------------------------------------------------
  ;; Airflow noise batch (portal-physics.ts's simplex3, bit-exact port).
  ;; Feeds PortalSimulation.advanceParticles's fast path: one wasm call per
  ;; step evaluates the whole pool's noise instead of one JS call per
  ;; particle (the dominant sim cost at fullscreen densities). Operation
  ;; order matches the JS reference exactly (left-associative chains, same
  ;; literals), so results are bit-identical — enforced by
  ;; src/render-kernel.test.ts. Table layout (copied in once by
  ;; RenderKernel): doubled 256-byte permutation at 0, 12 gradients × 3 f64
  ;; at 512. Lattice coords convert with i32.trunc_sat_f64_s: identical to
  ;; JS ToInt32 for |i| < 2³¹ (particle positions keep lattice indices
  ;; ≤ ~10³); beyond it JS wraps while wasm saturates — an unreachable
  ;; domain, and the saturating form cannot trap.
  (func $simplexCorner
    (param $x f64) (param $y f64) (param $z f64) (param $index i32) (result f64)
    (local $t f64) (local $g i32)
    ;; t = 0.6 - x*x - y*y - z*z, left-associative: ((0.6 - x²) - y²) - z²
    f64.const 0x1.3333333333333p-1
    local.get $x
    local.get $x
    f64.mul
    f64.sub
    local.get $y
    local.get $y
    f64.mul
    f64.sub
    local.get $z
    local.get $z
    f64.mul
    f64.sub
    local.set $t
    local.get $t
    f64.const 0
    f64.lt
    if (result f64)
      f64.const 0
    else
      local.get $index
      i32.const 12
      i32.rem_u
      i32.const 24
      i32.mul
      local.set $g
      ;; (g[1]*y + g[0]*x + g[2]*z) * t * t * t * t, left-associative.
      local.get $g
      f64.load offset=520
      local.get $y
      f64.mul
      local.get $g
      f64.load offset=512
      local.get $x
      f64.mul
      f64.add
      local.get $g
      f64.load offset=528
      local.get $z
      f64.mul
      f64.add
      local.get $t
      f64.mul
      local.get $t
      f64.mul
      local.get $t
      f64.mul
      local.get $t
      f64.mul
    end
  )

  ;; simplex3(x, y, z) — exact port of portal-physics.ts's noise (the fround
  ;; stepParticle path frounds its own inputs and is never fed these values).
  (func $simplex
    (param $x f64) (param $y f64) (param $z f64) (result f64)
    (local $s f64) (local $i f64) (local $j f64) (local $k f64) (local $t f64)
    (local $x0 f64) (local $y0 f64) (local $z0 f64)
    (local $i1 i32) (local $j1 i32) (local $k1 i32)
    (local $i2 i32) (local $j2 i32) (local $k2 i32)
    (local $ii i32) (local $jj i32) (local $kk i32)
    (local $n0 f64) (local $n1 f64) (local $n2 f64) (local $n3 f64)
    ;; s = (x + y + z) * (1/3)
    local.get $x
    local.get $y
    f64.add
    local.get $z
    f64.add
    f64.const 0x1.5555555555555p-2
    f64.mul
    local.set $s
    ;; i/j/k = Math.floor(coord + s)
    local.get $x
    local.get $s
    f64.add
    f64.floor
    local.set $i
    local.get $y
    local.get $s
    f64.add
    f64.floor
    local.set $j
    local.get $z
    local.get $s
    f64.add
    f64.floor
    local.set $k
    ;; t = (i + j + k) * (1/6)
    local.get $i
    local.get $j
    f64.add
    local.get $k
    f64.add
    f64.const 0x1.5555555555555p-3
    f64.mul
    local.set $t
    ;; x0 = x - (i - t); y0, z0 likewise
    local.get $x
    local.get $i
    local.get $t
    f64.sub
    f64.sub
    local.set $x0
    local.get $y
    local.get $j
    local.get $t
    f64.sub
    f64.sub
    local.set $y0
    local.get $z
    local.get $k
    local.get $t
    f64.sub
    f64.sub
    local.set $z0
    ;; Corner ranking (i1/j1/k1/i2/j2/k2 default 0).
    local.get $x0
    local.get $y0
    f64.ge
    if
      local.get $y0
      local.get $z0
      f64.ge
      if
        i32.const 1
        local.set $i1
        i32.const 1
        local.set $i2
        i32.const 1
        local.set $j2
      else
        local.get $x0
        local.get $z0
        f64.ge
        if
          i32.const 1
          local.set $i1
          i32.const 1
          local.set $i2
          i32.const 1
          local.set $k2
        else
          i32.const 1
          local.set $k1
          i32.const 1
          local.set $i2
          i32.const 1
          local.set $k2
        end
      end
    else
      local.get $y0
      local.get $z0
      f64.lt
      if
        i32.const 1
        local.set $k1
        i32.const 1
        local.set $j2
        i32.const 1
        local.set $k2
      else
        local.get $x0
        local.get $z0
        f64.lt
        if
          i32.const 1
          local.set $j1
          i32.const 1
          local.set $j2
          i32.const 1
          local.set $k2
        else
          i32.const 1
          local.set $j1
          i32.const 1
          local.set $i2
          i32.const 1
          local.set $j2
        end
      end
    end
    ;; ii/jj/kk = ToInt32(i/j/k) & 255
    local.get $i
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $ii
    local.get $j
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $jj
    local.get $k
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $kk
    ;; n0 = corner(x0, y0, z0, perm[ii + perm[jj + perm[kk]]])
    local.get $x0
    local.get $y0
    local.get $z0
    local.get $kk
    i32.load8_u
    local.get $jj
    i32.add
    i32.load8_u
    local.get $ii
    i32.add
    i32.load8_u
    call $simplexCorner
    local.set $n0
    ;; n1 = corner(x0 - i1 + 1/6, y0 - j1 + 1/6, z0 - k1 + 1/6,
    ;;             perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]])
    local.get $x0
    local.get $i1
    f64.convert_i32_s
    f64.sub
    f64.const 0x1.5555555555555p-3
    f64.add
    local.get $y0
    local.get $j1
    f64.convert_i32_s
    f64.sub
    f64.const 0x1.5555555555555p-3
    f64.add
    local.get $z0
    local.get $k1
    f64.convert_i32_s
    f64.sub
    f64.const 0x1.5555555555555p-3
    f64.add
    local.get $kk
    local.get $k1
    i32.add
    i32.load8_u
    local.get $jj
    local.get $j1
    i32.add
    i32.add
    i32.load8_u
    local.get $ii
    local.get $i1
    i32.add
    i32.add
    i32.load8_u
    call $simplexCorner
    local.set $n1
    ;; n2 = corner(x0 - i2 + 1/3, y0 - j2 + 1/3, z0 - k2 + 1/3,
    ;;             perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]])
    local.get $x0
    local.get $i2
    f64.convert_i32_s
    f64.sub
    f64.const 0x1.5555555555555p-2
    f64.add
    local.get $y0
    local.get $j2
    f64.convert_i32_s
    f64.sub
    f64.const 0x1.5555555555555p-2
    f64.add
    local.get $z0
    local.get $k2
    f64.convert_i32_s
    f64.sub
    f64.const 0x1.5555555555555p-2
    f64.add
    local.get $kk
    local.get $k2
    i32.add
    i32.load8_u
    local.get $jj
    local.get $j2
    i32.add
    i32.add
    i32.load8_u
    local.get $ii
    local.get $i2
    i32.add
    i32.add
    i32.load8_u
    call $simplexCorner
    local.set $n2
    ;; n3 = corner(x0 - 1 + 0.5, y0 - 1 + 0.5, z0 - 1 + 0.5,
    ;;             perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]])
    local.get $x0
    f64.const 1
    f64.sub
    f64.const 0.5
    f64.add
    local.get $y0
    f64.const 1
    f64.sub
    f64.const 0.5
    f64.add
    local.get $z0
    f64.const 1
    f64.sub
    f64.const 0.5
    f64.add
    local.get $kk
    i32.const 1
    i32.add
    i32.load8_u
    local.get $jj
    i32.const 1
    i32.add
    i32.add
    i32.load8_u
    local.get $ii
    i32.const 1
    i32.add
    i32.add
    i32.load8_u
    call $simplexCorner
    local.set $n3
    ;; (n1 + n0 + n2 + n3) * 32
    local.get $n1
    local.get $n0
    f64.add
    local.get $n2
    f64.add
    local.get $n3
    f64.add
    f64.const 32
    f64.mul
  )

  ;; cornerPair: portal-physics.ts's corner() for both f64x2 lanes at once.
  ;; Same op order as $simplexCorner: t = ((0.6 - x²) - y²) - z²,
  ;; t < 0 → 0, (g[1]*y + g[0]*x + g[2]*z) * t * t * t * t. $gA/$gB are the
  ;; per-lane gradient row byte offsets ((index % 12) * 24); the gradient
  ;; components are loaded scalar and splatted into lanes. Every arithmetic
  ;; op is lane-wise IEEE f64, so lanes match the scalar results bitwise.
  (func $cornerPair
    (param $xv v128) (param $yv v128) (param $zv v128)
    (param $gA i32) (param $gB i32) (result v128)
    (local $t v128) (local $v v128)
    (local $g1 v128) (local $g0 v128) (local $g2 v128)
    ;; t
    f64.const 0x1.3333333333333p-1
    f64x2.splat
    local.get $xv
    local.get $xv
    f64x2.mul
    f64x2.sub
    local.get $yv
    local.get $yv
    f64x2.mul
    f64x2.sub
    local.get $zv
    local.get $zv
    f64x2.mul
    f64x2.sub
    local.set $t
    ;; gradient splats per lane: g[1] at row+8, g[0] at row+0, g[2] at row+16
    v128.const i64x2 0 0
    local.get $gA
    f64.load offset=520
    f64x2.replace_lane 0
    local.get $gB
    f64.load offset=520
    f64x2.replace_lane 1
    local.set $g1
    v128.const i64x2 0 0
    local.get $gA
    f64.load offset=512
    f64x2.replace_lane 0
    local.get $gB
    f64.load offset=512
    f64x2.replace_lane 1
    local.set $g0
    v128.const i64x2 0 0
    local.get $gA
    f64.load offset=528
    f64x2.replace_lane 0
    local.get $gB
    f64.load offset=528
    f64x2.replace_lane 1
    local.set $g2
    ;; dot = (g[1]*y + g[0]*x) + g[2]*z
    local.get $g1
    local.get $yv
    f64x2.mul
    local.get $g0
    local.get $xv
    f64x2.mul
    f64x2.add
    local.get $g2
    local.get $zv
    f64x2.mul
    f64x2.add
    ;; ((dot*t)*t)*t)*t
    local.get $t
    f64x2.mul
    local.get $t
    f64x2.mul
    local.get $t
    f64x2.mul
    local.get $t
    f64x2.mul
    local.set $v
    ;; t < 0 → 0 (both lanes)
    v128.const i64x2 0 0
    local.get $v
    local.get $t
    v128.const i64x2 0 0
    f64x2.lt
    v128.bitselect
  )

  ;; simplexPair: $simplex for two adjacent particles (lane 0 = first,
  ;; lane 1 = second), reading inputs from and writing the result to the
  ;; host scratch. The scalar $simplex keeps the exact same operation order
  ;; per lane; the ranking is the branchless mask form derived from the same
  ;; JS branch table (checked row by row in the noise export comment above).
  (func $simplexPair
    (param $axPtr i32) (param $ayPtr i32) (param $outPtr i32) (param $time f64)
    (local $xv v128) (local $yv v128) (local $zv v128)
    (local $s v128) (local $i v128) (local $j v128) (local $k v128) (local $t v128)
    (local $x0 v128) (local $y0 v128) (local $z0 v128)
    (local $c1 v128) (local $c2 v128) (local $c3 v128)
    (local $i1m v128) (local $j1m v128) (local $k1m v128)
    (local $i2m v128) (local $j2m v128) (local $k2m v128)
    (local $iiA i32) (local $iiB i32) (local $jjA i32) (local $jjB i32) (local $kkA i32) (local $kkB i32)
    (local $gA i32) (local $gB i32)
    (local $n0 v128) (local $n1 v128) (local $n2 v128) (local $n3 v128)
    local.get $axPtr
    v128.load
    local.set $xv
    local.get $ayPtr
    v128.load
    local.set $yv
    local.get $time
    f64x2.splat
    local.set $zv
    ;; s = (x + y + z) * (1/3)
    local.get $xv
    local.get $yv
    f64x2.add
    local.get $zv
    f64x2.add
    f64.const 0x1.5555555555555p-2
    f64x2.splat
    f64x2.mul
    local.set $s
    ;; i/j/k = floor(coord + s)
    local.get $xv
    local.get $s
    f64x2.add
    f64x2.floor
    local.set $i
    local.get $yv
    local.get $s
    f64x2.add
    f64x2.floor
    local.set $j
    local.get $zv
    local.get $s
    f64x2.add
    f64x2.floor
    local.set $k
    ;; t = (i + j + k) * (1/6)
    local.get $i
    local.get $j
    f64x2.add
    local.get $k
    f64x2.add
    f64.const 0x1.5555555555555p-3
    f64x2.splat
    f64x2.mul
    local.set $t
    ;; x0 = x - (i - t); y0, z0 likewise
    local.get $xv
    local.get $i
    local.get $t
    f64x2.sub
    f64x2.sub
    local.set $x0
    local.get $yv
    local.get $j
    local.get $t
    f64x2.sub
    f64x2.sub
    local.set $y0
    local.get $zv
    local.get $k
    local.get $t
    f64x2.sub
    f64x2.sub
    local.set $z0
    ;; ranking masks: c1 = x0 >= y0, c2 = y0 >= z0, c3 = x0 >= z0
    local.get $x0
    local.get $y0
    f64x2.ge
    local.set $c1
    local.get $y0
    local.get $z0
    f64x2.ge
    local.set $c2
    local.get $x0
    local.get $z0
    f64x2.ge
    local.set $c3
    local.get $c1
    local.get $c2
    local.get $c3
    v128.or
    v128.and
    local.set $i1m
    local.get $c1
    v128.not
    local.get $c2
    v128.and
    local.set $j1m
    local.get $c2
    v128.not
    local.get $c1
    v128.not
    local.get $c3
    v128.not
    v128.or
    v128.and
    local.set $k1m
    local.get $c1
    local.get $c2
    local.get $c3
    v128.and
    v128.or
    local.set $i2m
    local.get $c1
    v128.not
    local.get $c2
    v128.or
    local.set $j2m
    local.get $c1
    local.get $c2
    v128.and
    v128.not
    local.get $c1
    v128.not
    local.get $c2
    v128.and
    local.get $c3
    v128.and
    v128.not
    v128.and
    local.set $k2m
    ;; ii/jj/kk per lane: ToInt32(floor) & 255
    local.get $i
    f64x2.extract_lane 0
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $iiA
    local.get $i
    f64x2.extract_lane 1
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $iiB
    local.get $j
    f64x2.extract_lane 0
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $jjA
    local.get $j
    f64x2.extract_lane 1
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $jjB
    local.get $k
    f64x2.extract_lane 0
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $kkA
    local.get $k
    f64x2.extract_lane 1
    i32.trunc_sat_f64_s
    i32.const 255
    i32.and
    local.set $kkB
    ;; n0 = corner(x0, y0, z0, perm[ii + perm[jj + perm[kk]]])
    local.get $kkA
    i32.load8_u
    local.get $jjA
    i32.add
    i32.load8_u
    local.get $iiA
    i32.add
    i32.load8_u
    i32.const 12
    i32.rem_u
    i32.const 24
    i32.mul
    local.set $gA
    local.get $kkB
    i32.load8_u
    local.get $jjB
    i32.add
    i32.load8_u
    local.get $iiB
    i32.add
    i32.load8_u
    i32.const 12
    i32.rem_u
    i32.const 24
    i32.mul
    local.set $gB
    local.get $x0
    local.get $y0
    local.get $z0
    local.get $gA
    local.get $gB
    call $cornerPair
    local.set $n0
    ;; n1 = corner(x0 - i1 + 1/6, ..., perm[ii+i1 + perm[jj+j1 + perm[kk+k1]]])
    local.get $x0
    local.get $i1m
    f64.const 1
    f64x2.splat
    v128.and
    f64x2.sub
    f64.const 0x1.5555555555555p-3
    f64x2.splat
    f64x2.add
    local.get $y0
    local.get $j1m
    f64.const 1
    f64x2.splat
    v128.and
    f64x2.sub
    f64.const 0x1.5555555555555p-3
    f64x2.splat
    f64x2.add
    local.get $z0
    local.get $k1m
    f64.const 1
    f64x2.splat
    v128.and
    f64x2.sub
    f64.const 0x1.5555555555555p-3
    f64x2.splat
    f64x2.add
    local.get $kkA
    local.get $k1m
    i32x4.extract_lane 0
    i32.const 1
    i32.and
    i32.add
    i32.load8_u
    local.get $jjA
    local.get $j1m
    i32x4.extract_lane 0
    i32.const 1
    i32.and
    i32.add
    i32.add
    i32.load8_u
    local.get $iiA
    local.get $i1m
    i32x4.extract_lane 0
    i32.const 1
    i32.and
    i32.add
    i32.add
    i32.load8_u
    i32.const 12
    i32.rem_u
    i32.const 24
    i32.mul
    local.set $gA
    local.get $kkB
    local.get $k1m
    i32x4.extract_lane 2
    i32.const 1
    i32.and
    i32.add
    i32.load8_u
    local.get $jjB
    local.get $j1m
    i32x4.extract_lane 2
    i32.const 1
    i32.and
    i32.add
    i32.add
    i32.load8_u
    local.get $iiB
    local.get $i1m
    i32x4.extract_lane 2
    i32.const 1
    i32.and
    i32.add
    i32.add
    i32.load8_u
    i32.const 12
    i32.rem_u
    i32.const 24
    i32.mul
    local.set $gB
    local.get $gA
    local.get $gB
    call $cornerPair
    local.set $n1
    ;; n2 = corner(x0 - i2 + 1/3, ..., perm[ii+i2 + perm[jj+j2 + perm[kk+k2]]])
    local.get $x0
    local.get $i2m
    f64.const 1
    f64x2.splat
    v128.and
    f64x2.sub
    f64.const 0x1.5555555555555p-2
    f64x2.splat
    f64x2.add
    local.get $y0
    local.get $j2m
    f64.const 1
    f64x2.splat
    v128.and
    f64x2.sub
    f64.const 0x1.5555555555555p-2
    f64x2.splat
    f64x2.add
    local.get $z0
    local.get $k2m
    f64.const 1
    f64x2.splat
    v128.and
    f64x2.sub
    f64.const 0x1.5555555555555p-2
    f64x2.splat
    f64x2.add
    local.get $kkA
    local.get $k2m
    i32x4.extract_lane 0
    i32.const 1
    i32.and
    i32.add
    i32.load8_u
    local.get $jjA
    local.get $j2m
    i32x4.extract_lane 0
    i32.const 1
    i32.and
    i32.add
    i32.add
    i32.load8_u
    local.get $iiA
    local.get $i2m
    i32x4.extract_lane 0
    i32.const 1
    i32.and
    i32.add
    i32.add
    i32.load8_u
    i32.const 12
    i32.rem_u
    i32.const 24
    i32.mul
    local.set $gA
    local.get $kkB
    local.get $k2m
    i32x4.extract_lane 2
    i32.const 1
    i32.and
    i32.add
    i32.load8_u
    local.get $jjB
    local.get $j2m
    i32x4.extract_lane 2
    i32.const 1
    i32.and
    i32.add
    i32.add
    i32.load8_u
    local.get $iiB
    local.get $i2m
    i32x4.extract_lane 2
    i32.const 1
    i32.and
    i32.add
    i32.add
    i32.load8_u
    i32.const 12
    i32.rem_u
    i32.const 24
    i32.mul
    local.set $gB
    local.get $gA
    local.get $gB
    call $cornerPair
    local.set $n2
    ;; n3 = corner(x0 - 1 + 0.5, ..., perm[ii+1 + perm[jj+1 + perm[kk+1]]])
    local.get $x0
    f64.const 1
    f64x2.splat
    f64x2.sub
    f64.const 0.5
    f64x2.splat
    f64x2.add
    local.get $y0
    f64.const 1
    f64x2.splat
    f64x2.sub
    f64.const 0.5
    f64x2.splat
    f64x2.add
    local.get $z0
    f64.const 1
    f64x2.splat
    f64x2.sub
    f64.const 0.5
    f64x2.splat
    f64x2.add
    local.get $kkA
    i32.const 1
    i32.add
    i32.load8_u
    local.get $jjA
    i32.const 1
    i32.add
    i32.add
    i32.load8_u
    local.get $iiA
    i32.const 1
    i32.add
    i32.add
    i32.load8_u
    i32.const 12
    i32.rem_u
    i32.const 24
    i32.mul
    local.set $gA
    local.get $kkB
    i32.const 1
    i32.add
    i32.load8_u
    local.get $jjB
    i32.const 1
    i32.add
    i32.add
    i32.load8_u
    local.get $iiB
    i32.const 1
    i32.add
    i32.add
    i32.load8_u
    i32.const 12
    i32.rem_u
    i32.const 24
    i32.mul
    local.set $gB
    local.get $gA
    local.get $gB
    call $cornerPair
    local.set $n3
    ;; ((n1 + n0) + n2) + n3) * 32 → scratch
    local.get $outPtr
    local.get $n1
    local.get $n0
    f64x2.add
    local.get $n2
    f64x2.add
    local.get $n3
    f64x2.add
    f64.const 32
    f64x2.splat
    f64x2.mul
    v128.store
  )

  ;; Batch entry: out[i] = simplex3(ax[i], ay[i], time) for i in [0, n).
  ;; ax/ay/out are host-managed scratch pointers after the tables (see
  ;; RenderKernel.noiseAngles). Pairs of adjacent particles run through the
  ;; f64x2 lane path ($simplexPair — every arithmetic op is lane-wise IEEE,
  ;; so results are bit-identical to $simplex); an odd tail particle takes
  ;; the scalar path. Per-lane data-dependent perm lookups stay scalar; the
  ;; ranking is branchless from three f64x2 comparisons (c1 = x0>=y0,
  ;; c2 = y0>=z0, c3 = x0>=z0): i1 = c1&(c2|c3), j1 = !c1&c2,
  ;; k1 = !c2&(!c1|!c3), i2 = c1|(c2&c3), j2 = !c1|c2,
  ;; k2 = !(c1&c2) & !(!c1&c2&c3) — each row checked against the JS branch
  ;; table in portal-physics.ts. 0.0/1.0 flag values come from
  ;; mask & splat(1.0) (all-ones & 1.0 bits = 1.0), i32 flags from
  ;; extract_lane & 1.
  (func (export "noise")
    (param $axPtr i32) (param $ayPtr i32) (param $outPtr i32) (param $n i32) (param $time f64)
    (local $p i32)
    block $done
      loop $pairs
        local.get $p
        local.get $n
        i32.const 1
        i32.shr_s
        i32.ge_s
        br_if $done
        local.get $axPtr
        local.get $p
        i32.const 4
        i32.shl
        i32.add
        local.get $ayPtr
        local.get $p
        i32.const 4
        i32.shl
        i32.add
        local.get $outPtr
        local.get $p
        i32.const 4
        i32.shl
        i32.add
        local.get $time
        call $simplexPair
        local.get $p
        i32.const 1
        i32.add
        local.set $p
        br $pairs
      end
    end
    ;; Odd tail: scalar evaluation of the last particle.
    local.get $n
    i32.const 1
    i32.and
    if
      local.get $outPtr
      local.get $n
      i32.const 1
      i32.sub
      i32.const 3
      i32.shl
      i32.add
      local.get $axPtr
      local.get $n
      i32.const 1
      i32.sub
      i32.const 3
      i32.shl
      i32.add
      f64.load
      local.get $ayPtr
      local.get $n
      i32.const 1
      i32.sub
      i32.const 3
      i32.shl
      i32.add
      f64.load
      local.get $time
      call $simplex
      f64.store
    end
  )
)
