use std::collections::HashMap;
use std::path::Path;

use crate::renderer::inline::render_inline;
use crate::types::{AssetContext, MarkdownFile, Result};

pub(crate) struct MarkdownRenderContext<'a> {
    pub(crate) repo: &'a Path,
    pub(crate) output_dir: &'a Path,
    pub(crate) file: &'a MarkdownFile,
    pub(crate) page_map: &'a HashMap<String, String>,
    pub(crate) copy_assets: bool,
    pub(crate) assets: &'a mut AssetContext,
}

impl MarkdownRenderContext<'_> {
    pub(crate) fn render_inline(&mut self, text: &str) -> Result<String> {
        render_inline(
            text,
            self.repo,
            self.output_dir,
            self.file,
            self.page_map,
            self.copy_assets,
            self.assets,
        )
    }
}
