use std::io;

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let stderr = io::stderr();

    if let Err(error) = gt_plugin_host::run(stdin.lock(), stdout.lock(), stderr.lock()) {
        eprintln!("gt-plugin-host stopped with an I/O error: {error}");
        std::process::exit(1);
    }
}
