use serde::{Deserialize, Serialize};

/// Geometry (CSS/logical pixels, relative to the owning window's content area) for the embedded
/// browser webview. The frontend measures the panel body and pushes this down; the browser view is
/// positioned to exactly overlay that rectangle.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Lifecycle + security events emitted from an embedded browser view to its owning window. The page
/// itself never emits these — they originate in Rust navigation/load hooks — so a hostile page cannot
/// forge them. The frontend re-validates every payload before acting on it.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum BrowserEvent {
    #[serde(rename_all = "camelCase")]
    LoadStarted { workspace_id: String, url: String },
    #[serde(rename_all = "camelCase")]
    LoadFinished { workspace_id: String, url: String },
    #[serde(rename_all = "camelCase")]
    TitleChanged { workspace_id: String, title: String },
    /// A navigation to a scheme/host outside the allow-list was refused before any request was made.
    #[serde(rename_all = "camelCase")]
    NavBlocked {
        workspace_id: String,
        url: String,
        scheme: String,
    },
    /// An element was selected in Inspect mode. `payload` is an opaque base64url string decoded and
    /// re-sanitized on the frontend; Rust treats it as untrusted and never interprets it.
    #[serde(rename_all = "camelCase")]
    InspectSelected {
        workspace_id: String,
        payload: String,
    },
}
