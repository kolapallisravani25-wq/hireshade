fn main() {
    #[cfg(target_os = "macos")]
    {
        // screencapturekit-rs links against Swift runtime libraries.
        // The system Swift runtime at /usr/lib/swift MUST be added to the
        // rpath FIRST so dyld picks it up before the Xcode toolchain copy.
        // Reversing this order causes "Class implemented in both …" duplicates
        // because dyld loads the Xcode swift-5.5 libswift_Concurrency.dylib
        // and then finds the system one, logging duplicate-class warnings.
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

        let dev_dir = std::process::Command::new("xcode-select")
            .arg("-p")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .unwrap_or_default();
        let dev_dir = dev_dir.trim();
        if !dev_dir.is_empty() {
            let toolchain_swift = format!(
                "{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx",
                dev_dir
            );
            // swift-5.5 is where libswift_Concurrency.dylib lives in Xcode
            let toolchain_swift55 = format!(
                "{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx",
                dev_dir
            );
            let sdk_swift = format!(
                "{}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/lib/swift",
                dev_dir
            );
            // These are fallback paths; system path above takes precedence.
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", toolchain_swift);
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", toolchain_swift55);
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", sdk_swift);
        }
    }
    tauri_build::build()
}
