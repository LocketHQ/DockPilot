use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub bind: String,
    pub token: String,
}

impl Config {
    pub fn load(path: &str) -> Result<Self> {
        let s = std::fs::read_to_string(path)
            .with_context(|| format!("reading {path}"))?;
        let cfg: Config = toml::from_str(&s)
            .with_context(|| format!("parsing {path}"))?;
        Ok(cfg)
    }
}
