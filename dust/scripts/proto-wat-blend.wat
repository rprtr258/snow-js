(module
  ;; Scene RGBA8 at offset 0 (1920*1080*4 = 8294400 bytes = 127 pages),
  ;; staging f64 [x, y, alpha, onGridFalse?0:1] at 8_400_000.
  (memory (export "mem") 256 256)

  ;; debug: return [bx, by, af, r, g, b, inv] for one staged particle at index 0
  (func (export "dbg") (param $stage i32) (param $scale f64) (param $ox f64) (param $oy f64)
    (result f64 f64 f64 f64 f64 f64 f64)
    (local $p i32) (local $x f64) (local $rc f64) (local $af f64) (local $inv f64)
    (local $bx f64) (local $by f64)
    local.get $stage
    local.set $p
    ;; bx path (og = stage[3])
    local.get $p
    f64.load offset=24
    f64.const 0
    f64.ne
    if (result f64)
      local.get $p
      f64.load offset=0
      f64.const 0.5
      f64.add
      local.tee $rc
      f64.const 0
      f64.ge
      if (result f64)
        local.get $rc
        f64.const 0.5
        f64.add
      else
        local.get $rc
        f64.const -0.5
        f64.add
      end
      f64.floor
    else
      local.get $p
      f64.load offset=0
    end
    f64.const 1
    f64.sub
    local.get $scale
    f64.mul
    local.get $ox
    f64.add
    local.set $bx
    ;; by (same, y path)
    local.get $p
    f64.load offset=24
    f64.const 0
    f64.ne
    if (result f64)
      local.get $p
      f64.load offset=8
      f64.const 0.5
      f64.add
      local.tee $rc
      f64.const 0
      f64.ge
      if (result f64)
        local.get $rc
        f64.const 0.5
        f64.add
      else
        local.get $rc
        f64.const -0.5
        f64.add
      end
      f64.floor
    else
      local.get $p
      f64.load offset=8
    end
    f64.const 1
    f64.sub
    local.get $scale
    f64.mul
    local.get $oy
    f64.add
    local.set $by
    ;; af = trunc(alpha*255)&255 / 255
    local.get $p
    f64.load offset=16
    f64.const 255
    f64.mul
    f64.trunc
    i32.trunc_f64_s
    i32.const 255
    i32.and
    f64.convert_i32_u
    f64.const 255
    f64.div
    local.set $af
    ;; return bx, by, af, 68a, 180a, 60a, 1-a
    local.get $bx
    local.get $by
    local.get $af
    local.get $af
    f64.const 68
    f64.mul
    local.get $af
    f64.const 180
    f64.mul
    local.get $af
    f64.const 60
    f64.mul
    f64.const 1
    local.get $af
    f64.sub
  )

  ;; Render all packed 1px particles: replicate of software-renderer.ts's lean
  ;; body path (f = identity, width 1, PURPLE) in f64 for byte-exactness.
  (func (export "blend") (param $stage i32) (param $n i32)
        (param $scale f64) (param $ox f64) (param $oy f64)
        (param $margin f64) (param $sw i32) (param $sh i32)
        (param $nostore i32)
    (local $i i32) (local $p i32)
    (local $x f64) (local $y f64) (local $a f64) (local $og i32)
    (local $sx f64) (local $sy f64) (local $bx f64) (local $by f64)
    (local $ai i32) (local $af f64) (local $inv f64)
    (local $r f64) (local $g f64) (local $b f64)
    (local $x0 i32) (local $x1 i32) (local $y0 i32) (local $y1 i32)
    (local $i4 i32) (local $v f64) (local $vi i32) (local $ogf f64)
    (local $lim i32)
    block $done
      loop $outer
        ;; if i >= n break
        local.get $i
        local.get $n
        i32.ge_s
        br_if $done
        block $next
          ;; p = stage + i*32
          local.get $i
          i32.const 32
          i32.mul
          local.get $stage
          i32.add
          local.set $p

          ;; a = stage[p+16]; og = i32.load p+24
          local.get $p
          f64.load offset=16
          local.set $a
          local.get $p
          f64.load offset=24
          local.set $ogf
          local.get $ogf
          f64.const 0
          f64.ne
          local.set $og

          ;; ai = trunc(a * 255) & 255; skip if 0
          local.get $a
          f64.const 255
          f64.mul
          f64.trunc
          i32.trunc_f64_s
          i32.const 255
          i32.and
          local.tee $ai
          i32.eqz
          br_if $next

          ;; sx = x*scale + ox ; skip outside margin
          local.get $p
          f64.load offset=0
          local.get $scale
          f64.mul
          local.get $ox
          f64.add
          local.tee $sx
          local.get $margin
          f64.neg
          f64.lt
          br_if $next
          local.get $sx
          ;; (f64.convert sw + margin)
          local.get $sw
          f64.convert_i32_s
          local.get $margin
          f64.add
          f64.gt
          br_if $next

          local.get $p
          f64.load offset=8
          local.get $scale
          f64.mul
          local.get $oy
          f64.add
          local.tee $sy
          local.get $margin
          f64.neg
          f64.lt
          br_if $next
          local.get $sy
          local.get $sh
          f64.convert_i32_s
          local.get $margin
          f64.add
          f64.gt
          br_if $next

          ;; af = ai / 255 ; inv = 1 - af
          local.get $ai
          f64.convert_i32_u
          f64.const 255
          f64.div
          local.set $af
          f64.const 1
          local.get $af
          f64.sub
          local.set $inv
          ;; r = 68a, g = 180a, b = 60a
          local.get $af
          f64.const 68
          f64.mul
          local.set $r
          local.get $af
          f64.const 180
          f64.mul
          local.set $g
          local.get $af
          f64.const 60
          f64.mul
          local.set $b

          ;; bx = (onGridFalse ? x : floor(x+0.5+sign*0.5)) - 1) * scale + ox
          local.get $og
          if
            ;; roundCell(x + 0.5): floor(v + (v >= 0 ? 0.5 : -0.5)), v = x+0.5
            local.get $p
            f64.load offset=0
            f64.const 0.5
            f64.add
            local.tee $bx
            f64.const 0
            f64.ge
            if (result f64)
              local.get $bx
              f64.const 0.5
              f64.add
            else
              local.get $bx
              f64.const -0.5
              f64.add
            end
            f64.floor
            local.set $bx
          else
            local.get $p
            f64.load offset=0
            local.set $bx
          end
          local.get $bx
          f64.const 1
          f64.sub
          local.get $scale
          f64.mul
          local.get $ox
          f64.add
          local.set $bx

          ;; by = (same for y) - 1) * scale + oy
          local.get $og
          if
            local.get $p
            f64.load offset=8
            f64.const 0.5
            f64.add
            local.tee $sy
            f64.const 0
            f64.ge
            if (result f64)
              local.get $sy
              f64.const 0.5
              f64.add
            else
              local.get $sy
              f64.const -0.5
              f64.add
            end
            f64.floor
            local.set $sy
          else
            local.get $p
            f64.load offset=8
            local.set $sy
          end
          local.get $sy
          f64.const 1
          f64.sub
          local.get $scale
          f64.mul
          local.get $oy
          f64.add
          local.set $by

          ;; x0 = ceil(bx - 0.5) ; x1 = ceil(bx + 0.5)
          local.get $bx
          f64.const 0.5
          f64.sub
          f64.ceil
          i32.trunc_f64_s
          local.set $x0
          local.get $bx
          f64.const 0.5
          f64.add
          f64.ceil
          i32.trunc_f64_s
          local.set $x1
          local.get $by
          f64.const 0.5
          f64.sub
          f64.ceil
          i32.trunc_f64_s
          local.set $y0
          local.get $by
          f64.const 0.5
          f64.add
          f64.ceil
          i32.trunc_f64_s
          local.set $y1

          ;; clamp to scene
          local.get $x0
          i32.const 0
          i32.lt_s
          if
            i32.const 0
            local.set $x0
          end
          local.get $x1
          local.get $sw
          i32.gt_s
          if
            local.get $sw
            local.set $x1
          end
          local.get $y0
          i32.const 0
          i32.lt_s
          if
            i32.const 0
            local.set $y0
          end
          local.get $y1
          local.get $sh
          i32.gt_s
          if
            local.get $sh
            local.set $y1
          end
          ;; 1x1 rect: blend if x1 > x0 && y1 > y0
          local.get $x1
          local.get $x0
          i32.gt_s
          if
            local.get $y1
            local.get $y0
            i32.gt_s
            if
              ;; i4 = (y0 * sw + x0) * 4
              local.get $y0
              local.get $sw
              i32.mul
              local.get $x0
              i32.add
              i32.const 4
              i32.mul
              local.set $i4
              ;; R: scene[i4] = r + scene[i4]*inv (store = clamp+round-half-even; in-range → nearest)
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
              local.get $nostore
              i32.eqz
              if
                local.get $i4
                local.get $vi
                i32.store8
              end
              ;; G: scene[i4+1] = g + scene[i4+1]*inv
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
              local.get $nostore
              i32.eqz
              if
                local.get $i4
                local.get $vi
                i32.store8 offset=1
              end
              ;; B: scene[i4+2] = b + scene[i4+1]*inv — reads the just-written
              ;; green byte (committed lean-path quirk, kept byte-exact)
              local.get $i4
              i32.load8_u offset=1
              f64.convert_i32_u
              local.get $inv
              f64.mul
              local.get $b
              f64.add
              f64.nearest
              i32.trunc_f64_s
              local.set $vi
              local.get $nostore
              i32.eqz
              if
                local.get $i4
                local.get $vi
                i32.store8 offset=2
              end
            end
          end
        end ;; $next
        ;; i++
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $outer
      end
    end
  )
)
