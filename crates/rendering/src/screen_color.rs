use crate::{
    frame_pipeline::RgbaToNv12Converter,
    iosurface_texture::{IOSurfaceTextureCache, import_metal_texture_to_wgpu},
};
use cidre::{arc, cm, cv};

/// Converts ScreenCaptureKit's sRGB BGRA surface to correctly encoded BT.709 NV12.
/// The display-filter path does not produce correct transfer values when asked
/// for BT.709 directly. Reuse the export shader, with no CPU pixel readback.
pub struct ScreenColorConverter {
    device: wgpu::Device,
    queue: wgpu::Queue,
    textures: IOSurfaceTextureCache,
    converter: RgbaToNv12Converter,
}

// CoreFoundation references are atomic; the owning capture callback serializes
// all access to the converter and its surface pool.
unsafe impl Send for ScreenColorConverter {}

impl ScreenColorConverter {
    pub async fn new() -> Result<Self, String> {
        let instance = crate::create_wgpu_instance_sync();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                ..Default::default()
            })
            .await
            .map_err(|error| error.to_string())?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|error| error.to_string())?;
        let textures = IOSurfaceTextureCache::new().ok_or("Metal device unavailable")?;
        let mut converter = RgbaToNv12Converter::new(&device);
        converter.enable_surface_output();
        Ok(Self {
            device,
            queue,
            textures,
            converter,
        })
    }

    pub async fn convert(
        &mut self,
        sample: &cm::SampleBuf,
    ) -> Result<arc::R<cm::SampleBuf>, String> {
        let image = sample.image_buf().ok_or("Screen frame has no image")?;
        if image.pixel_format() != cv::PixelFormat::_32_BGRA {
            return Err("Screen color conversion requires sRGB BGRA".into());
        }
        let width = image.width() as u32;
        let height = image.height() as u32;
        let surface = image.io_surf().ok_or("Screen frame has no IOSurface")?;
        let metal = self
            .textures
            .create_bgra_texture(surface, width, height)
            .map_err(|error| error.to_string())?;
        let texture = import_metal_texture_to_wgpu(
            &self.device,
            &metal,
            wgpu::TextureFormat::Bgra8Unorm,
            width,
            height,
            Some("sRGB screen capture"),
        )
        .map_err(|error| error.to_string())?;
        let mut encoder = self.device.create_command_encoder(&Default::default());
        if !self
            .converter
            .submit_conversion(
                &self.device,
                &self.queue,
                &mut encoder,
                &texture,
                width,
                height,
                0,
                30,
            )
            .await
            .map_err(|error| error.to_string())?
        {
            return Err("Screen color conversion was not submitted".into());
        }
        self.queue.submit([encoder.finish()]);
        self.converter.after_submit(&self.queue);
        let output = self
            .converter
            .take_pending()
            .ok_or("Screen color conversion has no output")?
            .wait_with_pool(&self.device, None)
            .await
            .map_err(|error| error.to_string())?;
        let mut pixel = output
            .surface
            .ok_or("Screen color conversion requires an NV12 IOSurface")?
            .into_pixel_buffer();
        for (key, value) in [
            (
                cv::image_buf_attach::keys::color_primaries(),
                cv::image_buf_attach::color_primaries::itu_r_709_2(),
            ),
            (
                cv::image_buf_attach::keys::transfer_fn(),
                cv::image_buf_attach::transfer_fn::itu_r_709_2(),
            ),
            (
                cv::image_buf_attach::keys::ycbcr_matrix(),
                cv::image_buf_attach::ycbcr_matrix::itu_r_709_2(),
            ),
        ] {
            pixel.set_attach(key, value.as_ref(), cv::AttachMode::ShouldPropagate);
        }
        let format =
            cm::VideoFormatDesc::with_image_buf(&pixel).map_err(|error| error.to_string())?;
        let timing = sample.timing_info(0).map_err(|error| error.to_string())?;
        cm::SampleBuf::with_image_buf(&pixel, true, None, std::ptr::null(), &format, &timing)
            .map_err(|error| error.to_string())
    }
}
