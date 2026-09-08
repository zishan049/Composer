//! Session-scoped allowlist of user-confirmed filesystem paths.
//!
//! Restricted commands (import, path inspection, theme import/export and
//! storage-path changes) only accept paths that are either inside the active
//! workspace sandbox or explicitly produced by the user in this session —
//! through a native dialog picker or a drag-and-drop onto the window. This
//! preserves the "pick a file, then import it" flow while preventing a
//! compromised webview from feeding arbitrary system paths into those
//! commands.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Managed Tauri state recording every dialog/drag-drop originated path in
/// this session. Both the raw path and its canonicalized form are stored so
/// lookups succeed regardless of which form a command receives.
#[derive(Default)]
pub struct SessionPaths(Mutex<HashSet<PathBuf>>);

/// Strips the `\\?\` verbatim prefix that Windows `canonicalize()` produces
/// so canonical paths remain comparable with plain user-facing paths.
fn normalize(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = text.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

/// Best-effort canonicalization that falls back to the raw path when the
/// target does not exist (yet).
pub fn canonicalize_best_effort(path: &Path) -> PathBuf {
    normalize(&path.canonicalize().unwrap_or_else(|_| path.to_path_buf()))
}

/// Returns true when `path` — or any of its ancestors, so that a picked
/// directory covers everything below it — is contained in `allowed`.
pub fn is_in_allowed_set(allowed: &HashSet<PathBuf>, path: &Path) -> bool {
    for candidate in [path.to_path_buf(), canonicalize_best_effort(path)] {
        let mut current: &Path = &candidate;
        loop {
            if allowed.contains(current) {
                return true;
            }
            match current.parent() {
                Some(parent) => current = parent,
                None => break,
            }
        }
    }
    false
}

impl SessionPaths {
    /// Records a path the user explicitly produced this session.
    pub fn register(&self, path: &Path) {
        let mut set = self.0.lock().unwrap();
        set.insert(path.to_path_buf());
        set.insert(canonicalize_best_effort(path));
    }

    /// Returns true when `path` (or an ancestor of it) was registered.
    pub fn is_allowed(&self, path: &Path) -> bool {
        is_in_allowed_set(&self.0.lock().unwrap(), path)
    }

    /// Clones the registered set for use inside `spawn_blocking` tasks.
    pub fn snapshot(&self) -> HashSet<PathBuf> {
        self.0.lock().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registered_file_is_allowed() {
        let mut allowed = HashSet::new();
        let file = std::env::temp_dir().join("composer_session_test_file.txt");
        allowed.insert(file.clone());
        allowed.insert(canonicalize_best_effort(&file));

        assert!(is_in_allowed_set(&allowed, &file));
    }

    #[test]
    fn test_registered_directory_covers_children() {
        let mut allowed = HashSet::new();
        let dir = std::env::temp_dir().join("composer_session_test_dir");
        allowed.insert(dir.clone());
        allowed.insert(canonicalize_best_effort(&dir));

        let child = dir.join("sub").join("file.md");
        assert!(is_in_allowed_set(&allowed, &child));
    }

    #[test]
    fn test_unrelated_path_is_rejected() {
        let mut allowed = HashSet::new();
        let dir = std::env::temp_dir().join("composer_session_test_dir_a");
        allowed.insert(dir.clone());

        let outside = std::env::temp_dir().join("composer_session_test_dir_b").join("secret.txt");
        assert!(!is_in_allowed_set(&allowed, &outside));
    }

    #[test]
    fn test_sibling_of_registered_directory_is_rejected() {
        let mut allowed = HashSet::new();
        let dir = std::env::temp_dir().join("composer_session_test_dir_c");
        allowed.insert(dir.clone());

        // A path sharing a prefix but leaving the registered directory must fail.
        let sibling = dir.with_file_name(format!("{}x", dir.file_name().unwrap().to_string_lossy()));
        assert!(!is_in_allowed_set(&allowed, &sibling));
    }
}
