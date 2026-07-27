//! Native window-frame theming.
//!
//! Windows draws the caption bar, its text and the window border itself — and, when the user has
//! "Show accent colour on title bars" enabled, it paints the caption in the *system* accent. On a
//! near-black application that is a bright unrelated stripe sitting directly above chrome that was
//! carefully built to be achromatic, and no amount of CSS can reach it.
//!
//! DWM lets an application override all three. That is what this module does, so the frame joins
//! the application surface instead of fighting it. Colours come from the active theme, so the
//! frame follows a theme switch like everything else.
//!
//! Every entry point is a no-op on non-Windows targets and on failure: a window whose frame could
//! not be recoloured is still a perfectly usable window, so nothing here returns an error.

/// The frame colours for one window, as `#rrggbb` strings taken from the active theme.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowChrome {
    /// Caption-bar fill. The theme's card surface, so the frame reads as part of the app panel.
    pub caption: String,
    /// Caption title text.
    pub text: String,
    /// The 1px window border.
    pub border: String,
}

impl WindowChrome {
    /// The frame used the instant a window is created, before the renderer has booted far enough
    /// to report the resolved theme. It matches the `:root` dark defaults in `index.css`, which is
    /// what the first frame paints anyway — so a dark-theme start never flashes, and a light-theme
    /// start corrects within the same beat as the rest of the UI.
    pub fn dark_default() -> Self {
        Self {
            caption: "#171717".into(),
            text: "#fafafa".into(),
            border: "#262626".into(),
        }
    }
}

/// Paint one window's native frame.
pub fn apply<R: tauri::Runtime>(window: &tauri::Window<R>, chrome: &WindowChrome) {
    platform::apply(window, chrome);
}

/// Paint every open window — main, detached and secondary-monitor alike. Used when the theme
/// changes, so a detached window never keeps the previous theme's frame.
pub fn apply_to_all<R: tauri::Runtime>(app: &tauri::AppHandle<R>, chrome: &WindowChrome) {
    use tauri::Manager;
    for window in app.windows().values() {
        platform::apply(window, chrome);
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::WindowChrome;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };

    /// `#rrggbb` (or `#rgb`) into a Win32 `COLORREF`, which is `0x00BBGGRR` — byte order reversed
    /// from the way the same colour is written in CSS.
    fn colorref(hex: &str) -> Option<u32> {
        let digits = hex.strip_prefix('#')?;
        let expanded;
        let digits = match digits.len() {
            3 => {
                expanded = digits.chars().flat_map(|c| [c, c]).collect::<String>();
                expanded.as_str()
            }
            6 => digits,
            _ => return None,
        };
        let r = u32::from_str_radix(&digits[0..2], 16).ok()?;
        let g = u32::from_str_radix(&digits[2..4], 16).ok()?;
        let b = u32::from_str_radix(&digits[4..6], 16).ok()?;
        Some((b << 16) | (g << 8) | r)
    }

    fn set(hwnd: HWND, attribute: u32, color: u32) {
        // SAFETY: `hwnd` came from Tauri's live window handle, `attribute` is a documented DWM
        // attribute, and the pointer/length pair describes the `u32` DWM expects for all three of
        // these attributes. Unsupported attributes (Windows 10 before build 22000) return a
        // failure HRESULT rather than writing anything, which is why the result is discarded.
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                std::ptr::from_ref(&color).cast(),
                std::mem::size_of::<u32>() as u32,
            );
        }
    }

    pub fn apply<R: tauri::Runtime>(window: &tauri::Window<R>, chrome: &WindowChrome) {
        let Ok(handle) = window.hwnd() else { return };
        let hwnd = handle.0 as HWND;
        if let Some(color) = colorref(&chrome.caption) {
            set(hwnd, DWMWA_CAPTION_COLOR as u32, color);
        }
        if let Some(color) = colorref(&chrome.text) {
            set(hwnd, DWMWA_TEXT_COLOR as u32, color);
        }
        if let Some(color) = colorref(&chrome.border) {
            set(hwnd, DWMWA_BORDER_COLOR as u32, color);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::colorref;

        #[test]
        fn converts_css_hex_into_win32_byte_order() {
            // CSS writes RGB; COLORREF stores BGR. Getting this backwards is invisible for greys
            // and wrong for everything else, so it is pinned with a deliberately lopsided colour.
            assert_eq!(colorref("#a78bfa"), Some(0x00fa8ba7));
            assert_eq!(colorref("#171717"), Some(0x00171717));
            assert_eq!(colorref("#fff"), Some(0x00ffffff));
        }

        #[test]
        fn rejects_values_that_are_not_opaque_hex() {
            // The theme layer also emits `rgb(... / a)` and `color-mix(...)`; DWM cannot express
            // either, so those tokens must be refused rather than silently mangled.
            assert_eq!(colorref("rgb(255 255 255 / 0.07)"), None);
            assert_eq!(colorref("color-mix(in srgb, #fff 20%, transparent)"), None);
            assert_eq!(colorref("#12345"), None);
            assert_eq!(colorref("171717"), None);
            assert_eq!(colorref("#zzzzzz"), None);
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::WindowChrome;

    pub fn apply<R: tauri::Runtime>(_window: &tauri::Window<R>, _chrome: &WindowChrome) {}
}
