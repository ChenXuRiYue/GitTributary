use std::fs::{self, File};
use std::path::{Path, PathBuf};

use super::validation::validate_lifecycle;
use super::{JournalFrame, RunJournalRecord, SEGMENT_PREFIX, SEGMENT_SUFFIX};
use crate::{DataError, Result};

pub(super) fn read_run_dir(run_dir: &Path) -> Result<Vec<RunJournalRecord>> {
    let segments = segment_paths(run_dir)?;
    let mut records = Vec::new();
    for segment in segments {
        let content = fs::read(&segment)?;
        if !content.is_empty() && !content.ends_with(b"\n") {
            return Err(DataError::RunJournal(format!(
                "运行日志存在未修复的残行: {}",
                segment.display()
            )));
        }
        for line in content
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
        {
            let frame: JournalFrame = serde_json::from_slice(line).map_err(|error| {
                DataError::RunJournal(format!("运行日志损坏 {}: {error}", segment.display()))
            })?;
            let event_bytes = serde_json::to_vec(&frame.event)?;
            if crc32fast::hash(&event_bytes) != frame.checksum_crc32 {
                return Err(DataError::RunJournal(format!(
                    "运行日志校验失败: {}",
                    segment.display()
                )));
            }
            records.push(frame.event);
        }
    }
    validate_lifecycle(&records)?;
    Ok(records)
}

pub(super) fn segment_paths(run_dir: &Path) -> Result<Vec<PathBuf>> {
    if !run_dir.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(run_dir)? {
        let path = entry?.path();
        if !path.is_file() || segment_number(&path).is_err() {
            return Err(DataError::RunJournal(format!(
                "运行日志目录包含非法文件: {}",
                path.display()
            )));
        }
        paths.push(path);
    }
    paths.sort();
    Ok(paths)
}

pub(super) fn segment_number(path: &Path) -> Result<u64> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| DataError::RunJournal("非法 segment 文件名".to_string()))?;
    name.strip_prefix(SEGMENT_PREFIX)
        .and_then(|value| value.strip_suffix(SEGMENT_SUFFIX))
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| DataError::RunJournal(format!("非法 segment 文件名: {name}")))
}

pub(super) fn segment_name(number: u64) -> String {
    format!("{SEGMENT_PREFIX}{number:06}{SEGMENT_SUFFIX}")
}

pub(super) fn repair_torn_tail(run_dir: &Path) -> Result<()> {
    let Some(last) = segment_paths(run_dir)?.last().cloned() else {
        return Ok(());
    };
    let content = fs::read(&last)?;
    if content.is_empty() || content.ends_with(b"\n") {
        return Ok(());
    }
    let valid_len = content
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    let file = File::options().write(true).open(&last)?;
    file.set_len(valid_len as u64)?;
    file.sync_data()?;
    Ok(())
}

#[cfg(unix)]
pub(super) fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

pub(super) fn sync_directory_chain(path: &Path, max_depth: usize) -> Result<()> {
    let mut current = Some(path);
    for _ in 0..max_depth {
        let Some(directory) = current else {
            break;
        };
        if directory.exists() {
            sync_directory(directory)?;
        }
        current = directory.parent();
    }
    Ok(())
}

#[cfg(not(unix))]
pub(super) fn sync_directory(_path: &Path) -> Result<()> {
    Ok(())
}
