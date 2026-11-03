struct Uniforms {
    // columns of mat4x4 (column-major): world XYZmm → clip
    mvp: mat4x4<f32>,
    // unused pad for future (bottom/rotary)
    _pad: vec4<f32>,
};

@group(0) @binding(0) var<uniform> U: Uniforms;

struct VSOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) world_z: f32,
};

@vertex
fn vs_main(@location(0) pos: vec3<f32>) -> VSOut {
    var out: VSOut;
    out.clip_pos = U.mvp * vec4<f32>(pos, 1.0);
    out.world_z = pos.z;
    return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    // Store world Z in R; depth test keeps the maximum Z.
    return vec4<f32>(in.world_z, 0.0, 0.0, 1.0);
}
