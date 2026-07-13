use serde::Serialize;
use std::fmt::{Display, Formatter};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    pub detail: Option<Box<str>>,
    pub affected_entity: Option<Box<str>>,
    pub recommended_action: Option<Box<str>>,
    pub source_layer: Box<str>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable,
            detail: None,
            affected_entity: None,
            recommended_action: None,
            source_layer: "application".into(),
        }
    }

    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into().into_boxed_str());
        self
    }

    pub fn entity(mut self, entity: impl Into<String>) -> Self {
        self.affected_entity = Some(entity.into().into_boxed_str());
        self
    }

    pub fn action(mut self, action: impl Into<String>) -> Self {
        self.recommended_action = Some(action.into().into_boxed_str());
        self
    }

    pub fn layer(mut self, layer: impl Into<String>) -> Self {
        self.source_layer = layer.into().into_boxed_str();
        self
    }

    pub fn database(error: impl Display) -> Self {
        Self::new(
            "database_error",
            "ForgeMind could not access its local database.",
            true,
        )
        .detail(error.to_string())
        .action("Retry the operation or run Diagnostics health check.")
        .layer("persistence")
    }
}

impl Display for AppError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::new("io_error", "A native file operation failed.", true).detail(value.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::database(value)
    }
}
