//! Ошибки, которые видит человек: код и подробность. Фразу на выбранном языке
//! собирает страница — Rust языка интерфейса не знает и знать не должен.

use serde::Serialize;

pub mod code {
    pub const GAME_NOT_FOUND: &str = "gameNotFound";
    pub const FILE_MISSING: &str = "fileMissing";
    pub const EXE_PATH_MISSING: &str = "exePathMissing";
    pub const ARGS_UNCLOSED_QUOTE: &str = "argsUnclosedQuote";
    pub const EXE_START_FAILED: &str = "exeStartFailed";
    pub const STEAM_OPEN_FAILED: &str = "steamOpenFailed";
    pub const EPIC_OPEN_FAILED: &str = "epicOpenFailed";
    pub const EMPTY_TITLE: &str = "emptyTitle";
    pub const HUB_URL_NOT_HTTPS: &str = "hubUrlNotHttps";
    pub const VIDEO_PICK_FAILED: &str = "videoPickFailed";
    // Проблемы с файлом своего видео (`art::video_file_problem`): их видит
    // человек на вкладке «Вид», поэтому им нужны свои коды, а не `INTERNAL`.
    pub const VIDEO_WRONG_FORMAT: &str = "videoWrongFormat";
    pub const VIDEO_FILE_MISSING: &str = "videoFileMissing";
    pub const VIDEO_TOO_LARGE: &str = "videoTooLarge";
    pub const CACHE_READ_FAILED: &str = "cacheReadFailed";
    pub const LOG_FOLDER_MISSING: &str = "logFolderMissing";
    pub const OPEN_FOLDER_FAILED: &str = "openFolderFailed";
    pub const CONFIG_SAVE_FAILED: &str = "configSaveFailed";
    pub const AUTOSTART_FAILED: &str = "autostartFailed";
    pub const INTERNAL: &str = "internal";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: &'static str) -> Self {
        Self { code, detail: None }
    }

    pub fn with(code: &'static str, detail: impl Into<String>) -> Self {
        Self { code, detail: Some(detail.into()) }
    }
}

/// Для журнала: `код: подробность`.
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{}: {detail}", self.code),
            None => write!(f, "{}", self.code),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_code_and_optional_detail() {
        let full = serde_json::to_value(AppError::with(code::FILE_MISSING, "C:\\g.exe")).unwrap();
        assert_eq!(full, serde_json::json!({ "code": "fileMissing", "detail": "C:\\g.exe" }));
        let bare = serde_json::to_value(AppError::new(code::EMPTY_TITLE)).unwrap();
        assert_eq!(bare, serde_json::json!({ "code": "emptyTitle" }));
        assert_eq!(AppError::with(code::INTERNAL, "x").to_string(), "internal: x");
    }
}
