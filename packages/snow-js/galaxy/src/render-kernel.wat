;; Galaxy render kernel (port of the PocketGalaxyJs canvas loop): fades the
;; whole framebuffer and plots the chaotic particle walk. Built by
;; scripts/build-render-kernel.ts into static/assets/render-kernel.wasm.
;;
;; Memory layout: framebuffer at 0 (w*h*4 bytes, RGBA), tables at 64MiB:
;;   cos LUT  67108864 .. +32768  (8192 f32, cos over [0, 2.4))
;;   sin LUT  67141632 .. +32768  (8192 f32, sin over [0, 1.6))
;;   gains    67174400 / +256 / +512  (3 x 256 B, written by the host)
;; The map's trig args are bounded (cos arg < 2.3, sin arg < 1.5), so table
;; lookups replace Math.cos/sin; the gain maps reproduce clamped-array
;; float-add rounding per hit.
;; wabt 1.0.39 rejects i32.min/i32.max/i32.select (plain `select` works),
;; hence the select / ge_u-mul formulations below.
(module
  (memory (export "mem") 1180)
  (global $rng (mut i32) (i32.const 1))

  ;; xorshift32 → uniform [0, 1) with 2^-24 granularity. The three XOR steps
  ;; are sequential (each consumes the previous state) — combining them into
  ;; one expression changes the sequence.
  (func $rand01 (export "rand01") (result f64)
    (global.set $rng (i32.xor (global.get $rng) (i32.shl (global.get $rng) (i32.const 13))))
    (global.set $rng (i32.xor (global.get $rng) (i32.shr_u (global.get $rng) (i32.const 17))))
    (global.set $rng (i32.xor (global.get $rng) (i32.shl (global.get $rng) (i32.const 5))))
    (f64.mul
      (f64.convert_i32_u (i32.shr_u (global.get $rng) (i32.const 8)))
      (f64.const 0.000000059604644775390625)))

  ;; Saturating subtract over every byte (RGB and A fade together so empty
  ;; areas stay transparent); 16-byte SIMD body + scalar tail. len is a
  ;; multiple of 4 but need not be a multiple of 16 (odd-sized canvases).
  (func (export "fade") (param $len i32) (param $fade i32)
    (local $i i32) (local $splat v128)
    (local.set $splat (i8x16.splat (local.get $fade)))
    (block $done
      (loop $l
        (br_if $done (i32.gt_u (i32.add (local.get $i) (i32.const 16)) (local.get $len)))
        (v128.store (local.get $i)
          (i8x16.sub_sat_u (v128.load (local.get $i)) (local.get $splat)))
        (local.set $i (i32.add (local.get $i) (i32.const 16)))
        (br $l)))
    (block $done
      (loop $tail
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (i32.store8 (local.get $i)
          (select
            (i32.sub (i32.load8_u (local.get $i)) (local.get $fade))
            (i32.const 0)
            (i32.ge_u (i32.load8_u (local.get $i)) (local.get $fade))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $tail))))

  ;; One frame: re-seed the walk, fade, then plot particles*steps hits.
  ;; time advances by the speed option per call (host-side).
  (func (export "draw")
    (param $w i32) (param $h i32) (param $particles i32) (param $steps i32)
    (param $time f64) (param $seed i32)
    (local $i i32) (local $j i32) (local $t f64) (local $x f64) (local $y f64)
    (local $wf f64) (local $hf f64) (local $px i32) (local $py i32) (local $idx i32)
    (global.set $rng (i32.or (local.get $seed) (i32.const 1)))
    (local.set $wf (f64.convert_i32_u (local.get $w)))
    (local.set $hf (f64.convert_i32_u (local.get $h)))
    (local.set $i (i32.const 0))
    (block $done
      (loop $outer
        (br_if $done (i32.ge_u (local.get $i) (local.get $particles)))
        (local.set $x (call $rand01))
        (local.set $y (call $rand01))
        (local.set $j (i32.const 0))
        (block $done
          (loop $inner
            (br_if $done (i32.ge_u (local.get $j) (local.get $steps)))
            ;; x = frac(time + x + cos(y*2.2 + x*0.1))
            (local.set $t
              (f64.add (f64.mul (local.get $y) (f64.const 2.2))
                       (f64.mul (local.get $x) (f64.const 0.1))))
            (local.set $t
              (f64.promote_f32
                (f32.load
                  (i32.add (i32.const 67108864)
                    (i32.shl (i32.trunc_sat_f64_u (f64.mul (local.get $t) (f64.const 3413.3333333333335)))
                             (i32.const 2))))))
            (local.set $t (f64.add (f64.add (local.get $time) (local.get $x)) (local.get $t)))
            (local.set $x (f64.sub (local.get $t) (f64.floor (local.get $t))))
            ;; y = frac(time*0.3 + y + sin(x*1.5))
            (local.set $t
              (f64.promote_f32
                (f32.load
                  (i32.add (i32.const 67141632)
                    (i32.shl (i32.trunc_sat_f64_u
                               (f64.mul (f64.mul (local.get $x) (f64.const 1.5)) (f64.const 5120)))
                             (i32.const 2))))))
            (local.set $t (f64.add (f64.add (f64.mul (local.get $time) (f64.const 0.3)) (local.get $y)) (local.get $t)))
            (local.set $y (f64.sub (local.get $t) (f64.floor (local.get $t))))
            ;; pixel index; x/y rounding to 1.0 would address one past the
            ;; row/frame, so clamp to the last column/row
            (local.set $px (i32.trunc_sat_f64_u (f64.mul (local.get $x) (local.get $wf))))
            (local.set $py (i32.trunc_sat_f64_u (f64.mul (local.get $y) (local.get $hf))))
            (local.set $px
              (select (i32.sub (local.get $w) (i32.const 1)) (local.get $px)
                          (i32.ge_u (local.get $px) (local.get $w))))
            (local.set $py
              (select (i32.sub (local.get $h) (i32.const 1)) (local.get $py)
                          (i32.ge_u (local.get $py) (local.get $h))))
            (local.set $idx
              (i32.shl (i32.add (i32.mul (local.get $py) (local.get $w)) (local.get $px))
                       (i32.const 2)))
            ;; per-channel saturating add via the 256-entry maps; a hit
            ;; re-lights alpha so the pixel stays visible while it fades
            (i32.store8 (local.get $idx)
              (i32.load8_u (i32.add (i32.const 67174400) (i32.load8_u (local.get $idx)))))
            (i32.store8 (i32.add (local.get $idx) (i32.const 1))
              (i32.load8_u (i32.add (i32.const 67174656)
                                    (i32.load8_u (i32.add (local.get $idx) (i32.const 1))))))
            (i32.store8 (i32.add (local.get $idx) (i32.const 2))
              (i32.load8_u (i32.add (i32.const 67174912)
                                    (i32.load8_u (i32.add (local.get $idx) (i32.const 2))))))
            (i32.store8 (i32.add (local.get $idx) (i32.const 3)) (i32.const 255))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $inner)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer))))
)
