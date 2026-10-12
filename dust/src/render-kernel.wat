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
)
