use std::sync::OnceLock;

pub(crate) const SHADER: &str = include_str!("shaders/color-space.wgsl");

pub(crate) fn bt709_to_srgb(value: u8) -> u8 {
    static TABLE: OnceLock<[u8; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        std::array::from_fn(|value| {
            let encoded = value as f32 / 255.0;
            let linear = if encoded < 0.081 {
                encoded / 4.5
            } else {
                ((encoded + 0.099) / 1.099).powf(1.0 / 0.45)
            };
            let srgb = if linear <= 0.003_130_8 {
                linear * 12.92
            } else {
                1.055 * linear.powf(1.0 / 2.4) - 0.055
            };
            (srgb * 255.0).round().clamp(0.0, 255.0) as u8
        })
    })[value as usize]
}

pub fn srgb_to_bt709(value: u8) -> u8 {
    static TABLE: OnceLock<[u8; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        std::array::from_fn(|value| {
            let encoded = value as f32 / 255.0;
            let linear = if encoded <= 0.04045 {
                encoded / 12.92
            } else {
                ((encoded + 0.055) / 1.055).powf(2.4)
            };
            let bt709 = if linear < 0.018 {
                linear * 4.5
            } else {
                1.099 * linear.powf(0.45) - 0.099
            };
            (bt709 * 255.0).round().clamp(0.0, 255.0) as u8
        })
    })[value as usize]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_matches_native_screen_capture_gray_patches() {
        let srgb = [
            0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255,
        ];
        let captured_bt709 = [
            0, 6, 19, 35, 52, 70, 88, 106, 125, 142, 161, 179, 198, 217, 236, 255,
        ];
        for (source, captured) in srgb.into_iter().zip(captured_bt709) {
            assert!(srgb_to_bt709(source).abs_diff(captured) <= 2);
            assert!(bt709_to_srgb(captured).abs_diff(source) <= 2);
        }
    }
}
