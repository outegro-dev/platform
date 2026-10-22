//! [`DiskStat`] via `statvfs(2)` (the `nix` crate; no `unsafe` here).

use std::path::PathBuf;

use async_trait::async_trait;
use nix::sys::statvfs::statvfs;

use crate::checks::disk::percent_used;
use crate::ports::{DiskStat, SourceError};

/// Usage of the filesystem behind `path` (the probe volume on the node disk).
#[derive(Debug, Clone)]
pub struct StatvfsDisk {
    path: PathBuf,
}

impl StatvfsDisk {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("filesystem reports no blocks")]
struct EmptyFilesystem;

/// `statvfs` block counts are `u64` on Linux but `u32` on macOS, so the
/// conversion is needed for portability even where it is a no-op.
#[allow(clippy::useless_conversion)]
fn usage(path: &std::path::Path) -> Result<u8, SourceError> {
    let stat = statvfs(path).map_err(std::io::Error::from)?;
    let blocks = u64::from(stat.blocks());
    let free = u64::from(stat.blocks_free());
    let available = u64::from(stat.blocks_available());
    percent_used(blocks.saturating_sub(free), available)
        .ok_or_else(|| SourceError::Decode(Box::new(EmptyFilesystem)))
}

#[async_trait]
impl DiskStat for StatvfsDisk {
    async fn percent_used(&self) -> Result<u8, SourceError> {
        // A syscall blocks the thread; keep it off the async worker.
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || usage(&path))
            .await
            .map_err(std::io::Error::other)?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_a_real_filesystem() {
        let percent = StatvfsDisk::new(std::env::temp_dir())
            .percent_used()
            .await
            .expect("statvfs");
        assert!(percent <= 100);
    }

    #[tokio::test]
    async fn missing_path_is_an_error() {
        let result = StatvfsDisk::new("/definitely/not/here")
            .percent_used()
            .await;
        assert!(matches!(result, Err(SourceError::Io(_))));
    }
}
