use std::collections::HashMap;

use crate::renderer::blocks::{normalize_plain_text, render_table, unique_slug};
use crate::renderer::context::MarkdownRenderContext;
use crate::renderer::shared::{escape_attr, escape_html};
use crate::types::{Heading, Result};

pub(crate) struct MarkdownRenderState {
    html: String,
    plain_text: String,
    paragraph: Vec<String>,
    headings: Vec<Heading>,
    used_slugs: HashMap<String, usize>,
    in_code: bool,
    list_open: bool,
    ordered_list_open: bool,
    blockquote_open: bool,
}

impl MarkdownRenderState {
    pub(crate) fn new() -> Self {
        Self {
            html: String::new(),
            plain_text: String::new(),
            paragraph: Vec::new(),
            headings: Vec::new(),
            used_slugs: HashMap::new(),
            in_code: false,
            list_open: false,
            ordered_list_open: false,
            blockquote_open: false,
        }
    }

    pub(crate) fn is_in_code(&self) -> bool {
        self.in_code
    }

    pub(crate) fn toggle_code_fence(
        &mut self,
        trimmed: &str,
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<()> {
        self.flush_paragraph(context)?;
        self.close_lists();
        self.close_blockquote();
        if self.in_code {
            self.html.push_str("</code></pre>\n");
            self.in_code = false;
        } else {
            let lang = trimmed.trim_start_matches("```").trim();
            self.html.push_str(&format!(
                "<pre><code{}>",
                if lang.is_empty() {
                    String::new()
                } else {
                    format!(" class=\"language-{}\"", escape_attr(lang))
                }
            ));
            self.in_code = true;
        }
        Ok(())
    }

    pub(crate) fn push_code_line(&mut self, line: &str) {
        self.html.push_str(&escape_html(line));
        self.html.push('\n');
        self.plain_text.push_str(line);
        self.plain_text.push('\n');
    }

    pub(crate) fn push_break(&mut self, context: &mut MarkdownRenderContext<'_>) -> Result<()> {
        self.flush_paragraph(context)?;
        self.close_lists();
        self.close_blockquote();
        Ok(())
    }

    pub(crate) fn push_thematic_break(
        &mut self,
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<()> {
        self.push_break(context)?;
        self.html.push_str("<hr>\n");
        Ok(())
    }

    pub(crate) fn push_table(
        &mut self,
        lines: &[&str],
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<usize> {
        self.push_break(context)?;
        let (table_html, consumed) = render_table(lines, context)?;
        self.html.push_str(&table_html);
        Ok(consumed)
    }

    pub(crate) fn push_heading(
        &mut self,
        level: usize,
        title: String,
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<()> {
        self.push_break(context)?;
        let slug = unique_slug(&title, &mut self.used_slugs);
        self.headings.push(Heading {
            level,
            title: title.clone(),
            slug: slug.clone(),
        });
        self.plain_text.push_str(&title);
        self.plain_text.push('\n');
        let title_html = context.render_inline(&title)?;
        self.html.push_str(&format!(
            "<h{level} id=\"{}\">{}</h{level}>\n",
            escape_attr(&slug),
            title_html
        ));
        Ok(())
    }

    pub(crate) fn push_unordered_item(
        &mut self,
        item: &str,
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<()> {
        self.flush_paragraph(context)?;
        self.close_blockquote();
        if self.ordered_list_open {
            self.html.push_str("</ol>\n");
            self.ordered_list_open = false;
        }
        if !self.list_open {
            self.html.push_str("<ul>\n");
            self.list_open = true;
        }
        self.push_list_item(item, context)
    }

    pub(crate) fn push_ordered_item(
        &mut self,
        item: &str,
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<()> {
        self.flush_paragraph(context)?;
        self.close_blockquote();
        if self.list_open {
            self.html.push_str("</ul>\n");
            self.list_open = false;
        }
        if !self.ordered_list_open {
            self.html.push_str("<ol>\n");
            self.ordered_list_open = true;
        }
        self.push_list_item(item, context)
    }

    pub(crate) fn push_blockquote(
        &mut self,
        quote: &str,
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<()> {
        self.flush_paragraph(context)?;
        self.close_lists();
        if !self.blockquote_open {
            self.html.push_str("<blockquote>\n");
            self.blockquote_open = true;
        }
        let quote = quote.trim();
        self.plain_text.push_str(quote);
        self.plain_text.push('\n');
        let quote_html = context.render_inline(quote)?;
        self.html.push_str(&format!("<p>{quote_html}</p>\n"));
        Ok(())
    }

    pub(crate) fn push_paragraph_line(&mut self, trimmed: &str) {
        self.close_lists();
        self.close_blockquote();
        self.plain_text.push_str(trimmed);
        self.plain_text.push('\n');
        self.paragraph.push(trimmed.to_string());
    }

    pub(crate) fn finish(
        mut self,
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<(String, Vec<Heading>, String)> {
        if self.in_code {
            self.html.push_str("</code></pre>\n");
        }
        self.flush_paragraph(context)?;
        self.close_lists();
        self.close_blockquote();
        Ok((
            self.html,
            self.headings,
            normalize_plain_text(&self.plain_text),
        ))
    }

    fn push_list_item(
        &mut self,
        item: &str,
        context: &mut MarkdownRenderContext<'_>,
    ) -> Result<()> {
        self.plain_text.push_str(item);
        self.plain_text.push('\n');
        let item_html = context.render_inline(item)?;
        self.html.push_str(&format!("<li>{item_html}</li>\n"));
        Ok(())
    }

    fn flush_paragraph(&mut self, context: &mut MarkdownRenderContext<'_>) -> Result<()> {
        if self.paragraph.is_empty() {
            return Ok(());
        }
        let text = self.paragraph.join(" ");
        let paragraph_html = context.render_inline(&text)?;
        self.html.push_str(&format!("<p>{paragraph_html}</p>\n"));
        self.paragraph.clear();
        Ok(())
    }

    fn close_lists(&mut self) {
        if self.list_open {
            self.html.push_str("</ul>\n");
            self.list_open = false;
        }
        if self.ordered_list_open {
            self.html.push_str("</ol>\n");
            self.ordered_list_open = false;
        }
    }

    fn close_blockquote(&mut self) {
        if self.blockquote_open {
            self.html.push_str("</blockquote>\n");
            self.blockquote_open = false;
        }
    }
}
