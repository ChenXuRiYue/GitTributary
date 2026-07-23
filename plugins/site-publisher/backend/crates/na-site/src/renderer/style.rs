pub(crate) fn site_css(_theme: &str) -> String {
    include_str!("static/site.css").to_string()
}
