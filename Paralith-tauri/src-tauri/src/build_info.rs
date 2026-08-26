use serde::{Deserialize, Serialize};

pub const STABLE_IDENTIFIER: &str = "com.corelith.paralith";
pub const PREVIEW_IDENTIFIER: &str = "com.corelith.paralith.preview";
pub const LEGACY_STABLE_IDENTIFIER: &str = "com.forgemind.workspace";

pub fn runtime_identifier() -> &'static str {
    ProductEdition::current().identifier()
}

pub const fn updater_enabled_for(development_build: bool) -> bool {
    !development_build
}

pub const fn updater_enabled() -> bool {
    updater_enabled_for(cfg!(debug_assertions))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProductEdition {
    Stable,
    Preview,
}

impl ProductEdition {
    pub fn current() -> Self {
        match env!("PARALITH_BUILD_EDITION") {
            "preview" => Self::Preview,
            _ => Self::Stable,
        }
    }

    pub const fn channel(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Preview => "preview",
        }
    }

    pub const fn identifier(self) -> &'static str {
        match self {
            Self::Stable => STABLE_IDENTIFIER,
            Self::Preview => PREVIEW_IDENTIFIER,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub product: String,
    pub edition: ProductEdition,
    pub version: String,
    pub git_commit: String,
    pub build_timestamp: String,
    pub release_channel: String,
    pub database_schema_version: i64,
    pub target: String,
    pub architecture: String,
    pub app_identifier: String,
    pub update_endpoint: String,
    pub updater_public_key_provisioned: bool,
    pub bundled_release: serde_json::Value,
}

impl BuildInfo {
    pub fn current() -> Self {
        let edition = ProductEdition::current();
        let configured_identifier = env!("PARALITH_BUILD_IDENTIFIER");
        debug_assert_eq!(configured_identifier, edition.identifier());
        let target = env!("PARALITH_BUILD_TARGET").to_owned();
        let architecture = target.split('-').next().unwrap_or("unknown").to_owned();
        Self {
            product: "PARALITH".into(),
            edition,
            version: env!("CARGO_PKG_VERSION").into(),
            git_commit: env!("PARALITH_BUILD_COMMIT").into(),
            build_timestamp: env!("PARALITH_BUILD_TIMESTAMP_VALUE").into(),
            release_channel: env!("PARALITH_BUILD_CHANNEL").into(),
            database_schema_version: crate::database::migrations::CURRENT_SCHEMA_VERSION,
            target,
            architecture,
            app_identifier: configured_identifier.into(),
            update_endpoint: env!("PARALITH_BUILD_UPDATE_ENDPOINT").into(),
            updater_public_key_provisioned: updater_public_key().is_some(),
            bundled_release: serde_json::from_str(include_str!(
                "../../release/generated/current-release.json"
            ))
            .unwrap_or(serde_json::Value::Null),
        }
    }
}

pub fn updater_public_key() -> Option<&'static str> {
    let value = env!("PARALITH_BUILD_PUBLIC_KEY").trim();
    (!value.is_empty() && !value.starts_with("REPLACE_WITH_")).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editions_have_isolated_identity_and_channel() {
        assert_ne!(
            ProductEdition::Stable.identifier(),
            ProductEdition::Preview.identifier()
        );
        assert_ne!(
            ProductEdition::Stable.channel(),
            ProductEdition::Preview.channel()
        );
        assert_eq!(ProductEdition::Stable.identifier(), STABLE_IDENTIFIER);
        assert_eq!(STABLE_IDENTIFIER, "com.corelith.paralith");
        assert_eq!(PREVIEW_IDENTIFIER, "com.corelith.paralith.preview");
        assert_ne!(STABLE_IDENTIFIER, LEGACY_STABLE_IDENTIFIER);
    }

    #[test]
    fn local_development_uses_the_configured_product_identity() {
        assert_eq!(ProductEdition::Stable.identifier(), STABLE_IDENTIFIER);
        assert_eq!(ProductEdition::Preview.identifier(), PREVIEW_IDENTIFIER);
        assert!(!updater_enabled_for(true));
        assert!(updater_enabled_for(false));
    }

    #[test]
    fn bundled_release_matches_crate_version() {
        let release: serde_json::Value =
            serde_json::from_str(include_str!("../../release/generated/current-release.json"))
                .unwrap();
        assert_eq!(release["version"], env!("CARGO_PKG_VERSION"));
    }
}
