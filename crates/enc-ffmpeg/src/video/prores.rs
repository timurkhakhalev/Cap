use std::{thread, time::Duration};

use cap_media_info::{RawVideoFormat, VideoInfo};
use ffmpeg::{
    Dictionary,
    codec::{context, encoder},
    color, format, frame,
    threading::Config,
};

use crate::base::EncoderBase;

pub struct ProResEncoderBuilder {
    input_config: VideoInfo,
    output_size: Option<(u32, u32)>,
}

#[derive(thiserror::Error, Debug)]
pub enum ProResEncoderError {
    #[error("{0:?}")]
    FFmpeg(#[from] ffmpeg::Error),
    #[error("Codec not found")]
    CodecNotFound,
    #[error("Invalid output dimensions {width}x{height}; expected non-zero width and height")]
    InvalidOutputDimensions { width: u32, height: u32 },
}

impl ProResEncoderBuilder {
    pub fn new(input_config: VideoInfo) -> Self {
        Self {
            input_config,
            output_size: None,
        }
    }

    pub fn with_output_size(mut self, width: u32, height: u32) -> Result<Self, ProResEncoderError> {
        if width == 0 || height == 0 {
            return Err(ProResEncoderError::InvalidOutputDimensions { width, height });
        }

        self.output_size = Some((width, height));
        Ok(self)
    }

    pub fn build(
        self,
        output: &mut format::context::Output,
    ) -> Result<ProResEncoder, ProResEncoderError> {
        let codec = encoder::find_by_name("prores_ks").ok_or(ProResEncoderError::CodecNotFound)?;
        let input_config = self.input_config;
        let (output_width, output_height) = self
            .output_size
            .unwrap_or((input_config.width, input_config.height));
        let output_format = format::Pixel::YUVA444P10LE;

        let mut converter = if input_config.pixel_format != output_format
            || input_config.width != output_width
            || input_config.height != output_height
        {
            Some(ffmpeg::software::scaling::Context::get(
                input_config.pixel_format,
                input_config.width,
                input_config.height,
                output_format,
                output_width,
                output_height,
                ffmpeg::software::scaling::flag::Flags::BICUBIC,
            )?)
        } else {
            None
        };

        if let Some(converter) = &mut converter {
            super::configure_rgb_converter(converter, input_config.pixel_format, output_format)?;
        }

        let mut encoder_ctx = context::Context::new_with_codec(codec);
        let thread_count = thread::available_parallelism()
            .map(|v| v.get())
            .unwrap_or(1);
        encoder_ctx.set_threading(Config::count(thread_count));

        let mut encoder = encoder_ctx.encoder().video()?;
        encoder.set_width(output_width);
        encoder.set_height(output_height);
        encoder.set_format(output_format);
        encoder.set_time_base(input_config.time_base);
        encoder.set_frame_rate(Some(input_config.frame_rate));
        encoder.set_colorspace(color::Space::BT709);
        encoder.set_color_range(color::Range::MPEG);
        unsafe {
            (*encoder.as_mut_ptr()).color_primaries =
                ffmpeg::ffi::AVColorPrimaries::AVCOL_PRI_BT709;
            (*encoder.as_mut_ptr()).color_trc =
                ffmpeg::ffi::AVColorTransferCharacteristic::AVCOL_TRC_IEC61966_2_1;
        }

        let mut options = Dictionary::new();
        options.set("profile", "4444");
        options.set("alpha_bits", "16");

        let encoder = encoder.open_with(options)?;

        let mut output_stream = output.add_stream(codec)?;
        let stream_index = output_stream.index();
        output_stream.set_time_base(input_config.time_base);
        output_stream.set_rate(input_config.frame_rate);
        output_stream.set_parameters(&encoder);

        let converted_frame_pool = converter
            .as_ref()
            .map(|_| frame::Video::new(output_format, output_width, output_height));

        Ok(ProResEncoder {
            base: EncoderBase::new(stream_index),
            encoder,
            converter,
            converted_frame_pool,
        })
    }
}

pub struct ProResEncoder {
    base: EncoderBase,
    encoder: encoder::Video,
    converter: Option<ffmpeg::software::scaling::Context>,
    converted_frame_pool: Option<frame::Video>,
}

#[derive(thiserror::Error, Debug)]
pub enum QueueFrameError {
    #[error("Converter: {0}")]
    Converter(ffmpeg::Error),
    #[error("Encode: {0}")]
    Encode(ffmpeg::Error),
}

impl ProResEncoder {
    pub fn builder(input_config: VideoInfo) -> ProResEncoderBuilder {
        ProResEncoderBuilder::new(input_config)
    }

    pub fn input_format() -> RawVideoFormat {
        RawVideoFormat::Rgba
    }

    pub fn queue_frame(
        &mut self,
        frame: &mut frame::Video,
        timestamp: Duration,
        output: &mut format::context::Output,
    ) -> Result<(), QueueFrameError> {
        self.base.update_pts(frame, timestamp, &mut self.encoder);

        let frame_to_send = if let Some(converter) = &mut self.converter {
            let pts = frame.pts();
            let converted = self.converted_frame_pool.as_mut().unwrap();
            converter
                .run(frame, converted)
                .map_err(QueueFrameError::Converter)?;
            converted.set_pts(pts);
            converted
        } else {
            frame
        };

        // prores_ks writes color metadata from AVFrame into each frame header.
        // Encoder-context tags alone only label the MOV container.
        frame_to_send.set_color_space(color::Space::BT709);
        frame_to_send.set_color_range(color::Range::MPEG);
        frame_to_send.set_color_primaries(color::Primaries::BT709);
        frame_to_send
            .set_color_transfer_characteristic(color::TransferCharacteristic::IEC61966_2_1);

        self.base
            .send_frame(frame_to_send, output, &mut self.encoder)
            .map_err(QueueFrameError::Encode)?;

        Ok(())
    }

    pub fn flush(&mut self, output: &mut format::context::Output) -> Result<(), ffmpeg::Error> {
        self.base.process_eof(output, &mut self.encoder)
    }
}

unsafe impl Send for ProResEncoder {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prores_software_encodes_srgb_transfer_with_bt709_matrix_and_luma() {
        ffmpeg::init().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("colors.mov");
        let info = VideoInfo::from_raw(RawVideoFormat::Rgba, 192, 64, 30);
        let mut output = format::output(&path).unwrap();
        let mut encoder = ProResEncoder::builder(info).build(&mut output).unwrap();
        output.write_header().unwrap();
        let mut input = frame::Video::new(format::Pixel::RGBA, 192, 64);
        let colors = [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
            [0, 0, 0],
            [255, 255, 255],
            [128, 128, 128],
        ];
        let stride = input.stride(0);
        for row in 0..64 {
            for x in 0..192 {
                let rgb = colors[x / 32];
                let offset = row * stride + x * 4;
                input.data_mut(0)[offset..offset + 4]
                    .copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
            }
        }
        encoder
            .queue_frame(&mut input, Duration::ZERO, &mut output)
            .unwrap();
        encoder.flush(&mut output).unwrap();
        output.write_trailer().unwrap();
        drop(output);

        let mut input = format::input(&path).unwrap();
        let stream = input.streams().best(ffmpeg::media::Type::Video).unwrap();
        let index = stream.index();
        let mut decoder = context::Context::from_parameters(stream.parameters())
            .unwrap()
            .decoder()
            .video()
            .unwrap();
        let mut decoded = frame::Video::empty();
        for (stream, packet) in input.packets() {
            if stream.index() != index {
                continue;
            }
            decoder.send_packet(&packet).unwrap();
            if decoder.receive_frame(&mut decoded).is_ok() {
                break;
            }
        }
        assert_eq!(decoded.color_space(), color::Space::BT709);
        assert_eq!(decoded.color_range(), color::Range::MPEG);
        assert_eq!(decoded.color_primaries(), color::Primaries::BT709);
        assert_eq!(
            decoded.color_transfer_characteristic(),
            color::TransferCharacteristic::IEC61966_2_1
        );
        assert_eq!(decoded.format(), format::Pixel::YUVA444P12LE);
        for (index, y) in [63u16, 173, 32, 16, 235, 126].into_iter().enumerate() {
            let offset = 32 * decoded.stride(0) + (index * 32 + 16) * 2;
            let value = u16::from_le_bytes(decoded.data(0)[offset..offset + 2].try_into().unwrap());
            assert!(
                value.abs_diff(y * 16) <= 32,
                "patch {index}: {value} vs {}",
                y * 16
            );
        }
    }
}
