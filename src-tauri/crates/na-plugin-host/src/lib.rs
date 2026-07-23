use std::ffi::{CStr, CString};
use std::io::{self, BufRead, Write};
use std::os::raw::c_char;
use std::path::Path;

use na_plugin_protocol::{
    error_code, event, method, Event, HelloPayload, HostState, HostStatus, Message, Request,
    Response, RpcError, PROTOCOL_VERSION,
};
use libloading::Library;
use serde_json::json;

pub const HOST_NAME: &str = "na-plugin-host";
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

type AbiVersionFn = unsafe extern "C" fn() -> u32;
type HandleRequestFn = unsafe extern "C" fn(*const c_char, *const c_char) -> *mut c_char;
type FreeStringFn = unsafe extern "C" fn(*mut c_char);

struct LoadedPlugin {
    _library: Library,
    handle_request: HandleRequestFn,
    free_string: FreeStringFn,
}

pub fn run<R, W, E>(input: R, mut output: W, mut diagnostics: E) -> io::Result<()>
where
    R: BufRead,
    W: Write,
    E: Write,
{
    let mut loaded_plugin: Option<LoadedPlugin> = None;
    write_message(&mut output, &hello_message())?;
    writeln!(
        diagnostics,
        "{HOST_NAME} started (protocol {PROTOCOL_VERSION})"
    )?;

    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let message = match serde_json::from_str::<Message>(&line) {
            Ok(message) => message,
            Err(error) => {
                writeln!(diagnostics, "invalid protocol message: {error}")?;
                write_message(
                    &mut output,
                    &Message::Event(Event::new(
                        event::PROTOCOL_ERROR,
                        json!({
                            "code": error_code::INVALID_REQUEST,
                            "message": "message is not valid protocol JSON"
                        }),
                    )),
                )?;
                continue;
            }
        };

        let request = match message {
            Message::Request(request) => request,
            _ => {
                writeln!(diagnostics, "ignored non-request message from parent")?;
                write_message(
                    &mut output,
                    &Message::Event(Event::new(
                        event::PROTOCOL_ERROR,
                        json!({
                            "code": error_code::INVALID_REQUEST,
                            "message": "plugin host accepts request messages only"
                        }),
                    )),
                )?;
                continue;
            }
        };

        let shutdown =
            request.protocol_version == PROTOCOL_VERSION && request.method == method::SHUTDOWN;
        let response = handle_request(request, &mut loaded_plugin);
        write_message(&mut output, &Message::Response(response))?;

        if shutdown {
            writeln!(diagnostics, "{HOST_NAME} shutting down")?;
            break;
        }
    }

    Ok(())
}

fn hello_message() -> Message {
    Message::Event(Event::new(
        event::HELLO,
        serde_json::to_value(HelloPayload {
            host_name: HOST_NAME.to_owned(),
            host_version: HOST_VERSION.to_owned(),
            process_id: std::process::id(),
            supported_methods: vec![
                method::PING.to_owned(),
                method::STATUS.to_owned(),
                method::LOAD_PLUGIN.to_owned(),
                method::INVOKE.to_owned(),
                method::UNLOAD_PLUGIN.to_owned(),
                method::SHUTDOWN.to_owned(),
            ],
        })
        .expect("hello payload is serializable"),
    ))
}

fn handle_request(request: Request, loaded_plugin: &mut Option<LoadedPlugin>) -> Response {
    if request.protocol_version != PROTOCOL_VERSION {
        return Response::error(
            request.id,
            RpcError::new(
                error_code::PROTOCOL_VERSION_MISMATCH,
                "request protocol version is not supported",
            )
            .with_data(json!({
                "expected": PROTOCOL_VERSION,
                "received": request.protocol_version
            })),
        );
    }

    let result = match request.method.as_str() {
        method::PING => json!({ "pong": true }),
        method::STATUS => serde_json::to_value(HostStatus {
            state: HostState::Running,
            process_id: std::process::id(),
            loaded_plugins: usize::from(loaded_plugin.is_some()),
        })
        .expect("host status is serializable"),
        method::LOAD_PLUGIN => match load_plugin(&request.params) {
            Ok(plugin) => {
                *loaded_plugin = Some(plugin);
                json!({ "loaded": true })
            }
            Err(error) => {
                return Response::error(
                    request.id,
                    RpcError::new(error_code::INVALID_REQUEST, error),
                )
            }
        },
        method::INVOKE => match invoke_plugin(loaded_plugin.as_ref(), &request.params) {
            Ok(value) => value,
            Err(error) => {
                return Response::error(
                    request.id,
                    RpcError::new(error_code::INTERNAL_ERROR, error),
                )
            }
        },
        method::UNLOAD_PLUGIN => {
            *loaded_plugin = None;
            json!({ "loaded": false })
        }
        method::SHUTDOWN => serde_json::to_value(HostStatus {
            state: HostState::ShuttingDown,
            process_id: std::process::id(),
            loaded_plugins: usize::from(loaded_plugin.is_some()),
        })
        .expect("host status is serializable"),
        _ => {
            return Response::error(
                request.id,
                RpcError::new(
                    error_code::METHOD_NOT_FOUND,
                    format!("unknown plugin host method: {}", request.method),
                ),
            )
        }
    };

    Response::success(request.id, result)
}

fn load_plugin(params: &serde_json::Value) -> Result<LoadedPlugin, String> {
    let path = params
        .get("path")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "load_plugin requires path".to_string())?;
    if !Path::new(path).is_file() {
        return Err("plugin library does not exist".to_string());
    }
    unsafe {
        let library = Library::new(path).map_err(|error| error.to_string())?;
        let abi_version = *library
            .get::<AbiVersionFn>(b"noteaura_plugin_abi_version\0")
            .map_err(|error| error.to_string())?;
        if abi_version() != 1 {
            return Err("unsupported plugin ABI version".to_string());
        }
        let handle_request = *library
            .get::<HandleRequestFn>(b"noteaura_plugin_handle_request\0")
            .map_err(|error| error.to_string())?;
        let free_string = *library
            .get::<FreeStringFn>(b"noteaura_plugin_free_string\0")
            .map_err(|error| error.to_string())?;
        Ok(LoadedPlugin {
            _library: library,
            handle_request,
            free_string,
        })
    }
}

fn invoke_plugin(
    plugin: Option<&LoadedPlugin>,
    params: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let plugin = plugin.ok_or_else(|| "plugin is not loaded".to_string())?;
    let method = params
        .get("method")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "invoke requires method".to_string())?;
    let payload = params
        .get("payload")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let method = CString::new(method).map_err(|_| "method contains NUL".to_string())?;
    let payload =
        CString::new(payload.to_string()).map_err(|_| "payload contains NUL".to_string())?;
    unsafe {
        let pointer = (plugin.handle_request)(method.as_ptr(), payload.as_ptr());
        if pointer.is_null() {
            return Err("plugin returned a null response".to_string());
        }
        let raw = CStr::from_ptr(pointer).to_string_lossy().into_owned();
        (plugin.free_string)(pointer);
        let envelope: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|error| format!("plugin returned invalid JSON: {error}"))?;
        if envelope.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
            Ok(envelope
                .get("result")
                .cloned()
                .unwrap_or(serde_json::Value::Null))
        } else {
            Err(envelope
                .get("error")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("plugin request failed")
                .to_string())
        }
    }
}

fn write_message(output: &mut impl Write, message: &Message) -> io::Result<()> {
    serde_json::to_writer(&mut *output, message).map_err(io::Error::other)?;
    output.write_all(b"\n")?;
    output.flush()
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use na_plugin_protocol::{event, method, Message, Request};
    use serde_json::Value;

    fn run_messages(input: &str) -> (Vec<Message>, String) {
        let mut output = Vec::new();
        let mut diagnostics = Vec::new();
        run(Cursor::new(input), &mut output, &mut diagnostics).unwrap();

        let messages = String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        (messages, String::from_utf8(diagnostics).unwrap())
    }

    #[test]
    fn emits_hello_then_answers_ping_and_status() {
        let ping = serde_json::to_string(&Message::Request(Request::new(
            "ping-1",
            method::PING,
            Value::Null,
        )))
        .unwrap();
        let status = serde_json::to_string(&Message::Request(Request::new(
            "status-1",
            method::STATUS,
            Value::Null,
        )))
        .unwrap();

        let (messages, diagnostics) = run_messages(&format!("{ping}\n{status}\n"));

        assert!(matches!(
            &messages[0],
            Message::Event(value) if value.event == event::HELLO
        ));
        assert!(matches!(
            &messages[1],
            Message::Response(value) if value.id == "ping-1" && value.error.is_none()
        ));
        assert!(matches!(
            &messages[2],
            Message::Response(value) if value.id == "status-1" && value.error.is_none()
        ));
        assert!(diagnostics.contains("started"));
    }

    #[test]
    fn shutdown_responds_and_stops_reading() {
        let shutdown = serde_json::to_string(&Message::Request(Request::new(
            "shutdown-1",
            method::SHUTDOWN,
            Value::Null,
        )))
        .unwrap();
        let ping = serde_json::to_string(&Message::Request(Request::new(
            "ignored",
            method::PING,
            Value::Null,
        )))
        .unwrap();

        let (messages, diagnostics) = run_messages(&format!("{shutdown}\n{ping}\n"));

        assert_eq!(messages.len(), 2);
        assert!(matches!(
            &messages[1],
            Message::Response(value) if value.id == "shutdown-1"
        ));
        assert!(diagnostics.contains("shutting down"));
    }

    #[test]
    fn malformed_input_is_reported_without_stopping_host() {
        let ping = serde_json::to_string(&Message::Request(Request::new(
            "ping-1",
            method::PING,
            Value::Null,
        )))
        .unwrap();

        let (messages, diagnostics) = run_messages(&format!("not-json\n{ping}\n"));

        assert!(matches!(
            &messages[1],
            Message::Event(value) if value.event == event::PROTOCOL_ERROR
        ));
        assert!(matches!(&messages[2], Message::Response(value) if value.id == "ping-1"));
        assert!(diagnostics.contains("invalid protocol message"));
    }

    #[test]
    fn rejects_unknown_method_and_incompatible_version() {
        let unknown = serde_json::to_string(&Message::Request(Request::new(
            "unknown-1",
            "unknown_method",
            Value::Null,
        )))
        .unwrap();
        let incompatible = serde_json::to_string(&Message::Request(Request {
            protocol_version: PROTOCOL_VERSION + 1,
            id: "version-1".to_owned(),
            method: method::PING.to_owned(),
            params: Value::Null,
        }))
        .unwrap();

        let (messages, _) = run_messages(&format!("{unknown}\n{incompatible}\n"));

        assert!(matches!(
            &messages[1],
            Message::Response(value)
                if value.error.as_ref().map(|error| error.code.as_str())
                    == Some(error_code::METHOD_NOT_FOUND)
        ));
        assert!(matches!(
            &messages[2],
            Message::Response(value)
                if value.error.as_ref().map(|error| error.code.as_str())
                    == Some(error_code::PROTOCOL_VERSION_MISMATCH)
        ));
    }

    #[test]
    fn incompatible_shutdown_does_not_stop_host() {
        let shutdown = serde_json::to_string(&Message::Request(Request {
            protocol_version: PROTOCOL_VERSION + 1,
            id: "shutdown-1".to_owned(),
            method: method::SHUTDOWN.to_owned(),
            params: Value::Null,
        }))
        .unwrap();
        let ping = serde_json::to_string(&Message::Request(Request::new(
            "ping-1",
            method::PING,
            Value::Null,
        )))
        .unwrap();

        let (messages, diagnostics) = run_messages(&format!("{shutdown}\n{ping}\n"));

        assert_eq!(messages.len(), 3);
        assert!(matches!(
            &messages[2],
            Message::Response(value) if value.id == "ping-1" && value.error.is_none()
        ));
        assert!(!diagnostics.contains("shutting down"));
    }
}
