import AppKit
import AVFoundation
import ScreenCaptureKit

final class PatchView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        for n in 0..<16 {
            let gray = CGFloat(n) / 15
            NSColor(srgbRed: gray, green: gray, blue: gray, alpha: 1).setFill()
            NSRect(x: CGFloat(n) * bounds.width / 16, y: 0, width: bounds.width / 16, height: bounds.height).fill()
        }
    }
}
final class Collector: NSObject, SCStreamOutput {
    private let lock = NSLock()
    private var frame: CVPixelBuffer?
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen, let image = CMSampleBufferGetImageBuffer(sample) else { return }
        lock.lock(); frame = image; lock.unlock()
    }
    func image() -> CVPixelBuffer? { lock.lock(); defer { lock.unlock() }; return frame }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 100, y: 200, width: 1280, height: 720), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Cap Color Calibration"
window.contentView = PatchView()
window.orderFrontRegardless()
let windowID = CGWindowID(window.windowNumber)
Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let target = content.windows.first(where: { $0.windowID == windowID }) else { fatalError("calibration window unavailable") }
        for (name, space) in [("sRGB", CGColorSpace.sRGB), ("709", CGColorSpace.itur_709)] {
            let config = SCStreamConfiguration()
            config.width = 1280; config.height = 748
            config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            config.colorSpaceName = space
            let collector = Collector()
            let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: target), configuration: config, delegate: nil)
            try stream.addStreamOutput(collector, type: .screen, sampleHandlerQueue: DispatchQueue(label: "color-probe"))
            try await stream.startCapture()
            try await Task.sleep(nanoseconds: 300_000_000)
            guard let image = collector.image() else { fatalError("capture produced no frame") }
            let attachments = CVBufferCopyAttachments(image, .shouldPropagate)
            print(name, String(describing: attachments))
            CVPixelBufferLockBaseAddress(image, .readOnly)
            let bytes = CVPixelBufferGetBaseAddressOfPlane(image, 0)!.assumingMemoryBound(to: UInt8.self)
            let stride = CVPixelBufferGetBytesPerRowOfPlane(image, 0)
            print("Y", (0..<16).map { bytes[60 * stride + $0 * 80 + 40] })
            CVPixelBufferUnlockBaseAddress(image, .readOnly)
            let output = URL(fileURLWithPath: "/tmp/cap-capture-\(name)-writer709.mp4")
            try? FileManager.default.removeItem(at: output)
            let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 1280, AVVideoHeightKey: 748,
                AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 8_000_000],
                AVVideoColorPropertiesKey: [AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                    AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2, AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2]
            ])
            let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
            writer.add(input); precondition(writer.startWriting()); writer.startSession(atSourceTime: .zero)
            for n in 0..<30 {
                while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 1_000_000) }
                precondition(adaptor.append(image, withPresentationTime: CMTime(value: Int64(n), timescale: 30)))
            }
            input.markAsFinished(); await writer.finishWriting()
            print("Writer", writer.status.rawValue, String(describing: writer.error))
            try await stream.stopCapture()
        }
    } catch { print("ERROR", error) }
    app.terminate(nil)
}
app.run()
