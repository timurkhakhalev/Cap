pub mod h264;
pub mod h264_packet;
pub mod hevc;
pub mod prores;
#[cfg(target_os = "macos")]
pub mod videotoolbox_hw;

fn is_rgb(format: ffmpeg::format::Pixel) -> bool {
    format.descriptor().is_some_and(|descriptor| unsafe {
        (*descriptor.as_ptr()).flags & ffmpeg::ffi::AV_PIX_FMT_FLAG_RGB as u64 != 0
    })
}

pub(crate) fn configure_rgb_converter(
    converter: &mut ffmpeg::software::scaling::Context,
    input: ffmpeg::format::Pixel,
    output: ffmpeg::format::Pixel,
) -> Result<(), ffmpeg::Error> {
    if !is_rgb(input) || is_rgb(output) {
        return Ok(());
    }

    // swscale defaults to BT.601 even though the encoder declares BT.709.
    // RGB input is full range; the encoded YUV contract below is limited range.
    let result = unsafe {
        let coefficients = ffmpeg::ffi::sws_getCoefficients(ffmpeg::ffi::SWS_CS_ITU709);
        ffmpeg::ffi::sws_setColorspaceDetails(
            converter.as_mut_ptr(),
            coefficients,
            1,
            coefficients,
            0,
            0,
            1 << 16,
            1 << 16,
        )
    };
    if result < 0 {
        return Err(ffmpeg::Error::from(result));
    }
    Ok(())
}
