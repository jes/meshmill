struct Params {
    width: u32,
    height: u32,
    radius_px: f32,
    tool_kind: u32, // 0=ball, 1=flat, 2=v (unused)
    depth_mm: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= P.width || y >= P.height) {
        return;
    }
    let R = P.radius_px;
    let r2 = R * R;
    let ix = i32(x);
    let iy = i32(y);
    let rad = i32(ceil(R));
    var best: f32 = -1e30;
    for (var dy: i32 = -rad; dy <= rad; dy++) {
        let yy = iy + dy;
        if (yy < 0 || yy >= i32(P.height)) { continue; }
        for (var dx: i32 = -rad; dx <= rad; dx++) {
            let xx = ix + dx;
            if (xx < 0 || xx >= i32(P.width)) { continue; }
            let d2 = f32(dx * dx + dy * dy);
            if (d2 > r2) { continue; }
            let z = src[u32(yy) * P.width + u32(xx)];
            var add: f32 = 0.0;
            if (P.tool_kind == 0u) {
                // ball: tool surface sits R above contact along Z for offset map
                // offset heightmap = max(z + (R - sqrt(R^2 - d^2)))
                add = R - sqrt(max(r2 - d2, 0.0));
            } // flat: add = 0
            best = max(best, z + add);
        }
    }
    dst[y * P.width + x] = best;
}
