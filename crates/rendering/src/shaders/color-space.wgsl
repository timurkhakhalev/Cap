fn bt709_to_srgb(encoded: vec3<f32>) -> vec3<f32> {
    let value = clamp(encoded, vec3<f32>(0.0), vec3<f32>(1.0));
    let linear = select(pow((value + 0.099) / 1.099, vec3<f32>(1.0 / 0.45)), value / 4.5, value < vec3<f32>(0.081));
    return select(1.055 * pow(linear, vec3<f32>(1.0 / 2.4)) - 0.055, 12.92 * linear, linear <= vec3<f32>(0.0031308));
}

fn srgb_to_bt709(encoded: vec3<f32>) -> vec3<f32> {
    let value = clamp(encoded, vec3<f32>(0.0), vec3<f32>(1.0));
    let linear = select(pow((value + 0.055) / 1.055, vec3<f32>(2.4)), value / 12.92, value <= vec3<f32>(0.04045));
    return select(1.099 * pow(linear, vec3<f32>(0.45)) - 0.099, 4.5 * linear, linear < vec3<f32>(0.018));
}
