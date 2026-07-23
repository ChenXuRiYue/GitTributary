use std::io;

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let stderr = io::stderr();

    if let Err(error) = na_plugin_host::run(stdin.lock(), stdout.lock(), stderr.lock()) {
        eprintln!("na-plugin-host stopped with an I/O error: {error}");
        std::process::exit(1);
    }
}
