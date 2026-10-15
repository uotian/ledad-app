use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWindow};
use objc2_foundation::{NSRect, NSString};
use tauri::WebviewWindow;

pub fn restore(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let main_thread = MainThreadMarker::new().ok_or("ウィンドウはメインスレッドで設定します。")?;
    // Tauriが所有するNSWindowを、起動処理のメインスレッドでだけ参照します。
    let native = unsafe { window.ns_window()?.cast::<NSWindow>().as_ref() }
        .ok_or("ウィンドウを取得できません。")?;
    let name = NSString::from_str("ledad-main");
    let restored = native.setFrameUsingName_force(&name, true);
    let screen = native
        .screen()
        .or_else(|| NSScreen::mainScreen(main_thread))
        .ok_or("表示するモニターを取得できません。")?;
    native.setFrame_display(fit(native.frame(), screen.visibleFrame(), restored), false);
    if !native.setFrameAutosaveName(&name) {
        return Err("ウィンドウの配置を保存できません。".into());
    }
    native.saveFrameUsingName(&name);
    Ok(())
}

fn fit(mut frame: NSRect, visible: NSRect, restored: bool) -> NSRect {
    if !restored {
        return visible;
    }
    frame.size.width = frame.size.width.min(visible.size.width);
    frame.size.height = frame.size.height.min(visible.size.height);
    frame.origin.x = frame.origin.x.clamp(
        visible.origin.x,
        visible.origin.x + visible.size.width - frame.size.width,
    );
    frame.origin.y = frame.origin.y.clamp(
        visible.origin.y,
        visible.origin.y + visible.size.height - frame.size.height,
    );
    frame
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_foundation::{NSPoint, NSSize};

    fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
    }

    #[test]
    fn first_launch_fills_available_area() {
        assert_eq!(
            fit(
                rect(15., 0., 1440., 988.),
                rect(0., 33., 1470., 923.),
                false
            ),
            rect(0., 33., 1470., 923.)
        );
        assert_eq!(
            fit(
                rect(15., 100., 1440., 988.),
                rect(1920., 33., 2560., 1407.),
                false
            ),
            rect(1920., 33., 2560., 1407.)
        );
    }

    #[test]
    fn saved_window_keeps_size_and_position() {
        let saved = rect(200., 100., 1100., 780.);
        assert_eq!(fit(saved, rect(0., 33., 1470., 923.), true), saved);
    }

    #[test]
    fn missing_monitor_moves_and_shrinks_window_into_visible_area() {
        assert_eq!(
            fit(
                rect(-2560., -1400., 2000., 1100.),
                rect(0., 33., 1470., 923.),
                true
            ),
            rect(0., 33., 1470., 923.)
        );
        assert_eq!(
            fit(
                rect(2560., 1000., 1100., 780.),
                rect(0., 33., 1470., 923.),
                true
            ),
            rect(370., 176., 1100., 780.)
        );
    }
}
