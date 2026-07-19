use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use gt_plugin_protocol::{event, method, Message, Request, Response};
use serde::Serialize;
use serde_json::{json, Value};

const CONTROL_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const PLUGIN_REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub struct PluginHostSupervisor {
    inner: Mutex<SupervisorState>,
    next_request_id: AtomicU64,
}

struct SupervisorState {
    process: Option<HostProcess>,
    last_error: Option<String>,
}

struct HostProcess {
    child: Child,
    stdin: ChildStdin,
    messages: mpsc::Receiver<Message>,
    process_id: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostSnapshot {
    pub running: bool,
    pub process_id: Option<u32>,
    pub last_error: Option<String>,
}

impl Default for PluginHostSupervisor {
    fn default() -> Self {
        Self {
            inner: Mutex::new(SupervisorState {
                process: None,
                last_error: None,
            }),
            next_request_id: AtomicU64::new(1),
        }
    }
}

impl PluginHostSupervisor {
    pub fn start(&self) -> Result<PluginHostSnapshot, String> {
        let mut state = self.inner.lock().unwrap();
        if let Some(process) = state.process.as_mut() {
            if process
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                return Ok(snapshot(&state));
            }
            state.process = None;
        }

        match spawn_host() {
            Ok(process) => {
                state.process = Some(process);
                state.last_error = None;
                Ok(snapshot(&state))
            }
            Err(error) => {
                state.last_error = Some(error.clone());
                Err(error)
            }
        }
    }

    pub fn status(&self) -> PluginHostSnapshot {
        let mut state = self.inner.lock().unwrap();
        refresh_process_state(&mut state);
        snapshot(&state)
    }

    pub fn ping(&self) -> Result<Value, String> {
        self.call(method::PING, json!({}))
    }

    pub fn call(&self, method_name: &str, params: Value) -> Result<Value, String> {
        self.ensure_started()?;
        let mut state = self.inner.lock().unwrap();
        let result = self.call_locked(&mut state, method_name, params, CONTROL_REQUEST_TIMEOUT);
        if matches!(result, Err(HostCallError::Transport(_))) {
            terminate_process(&mut state);
        }
        result.map_err(HostCallError::into_string)
    }

    pub fn invoke_plugin(
        &self,
        path: &Path,
        method_name: &str,
        payload: Value,
    ) -> Result<Value, String> {
        self.ensure_started()?;
        let mut state = self.inner.lock().unwrap();
        let result = self
            .call_locked(
                &mut state,
                method::LOAD_PLUGIN,
                json!({ "path": path }),
                CONTROL_REQUEST_TIMEOUT,
            )
            .and_then(|_| {
                self.call_locked(
                    &mut state,
                    method::INVOKE,
                    json!({ "method": method_name, "payload": payload }),
                    PLUGIN_REQUEST_TIMEOUT,
                )
            });
        if matches!(result, Err(HostCallError::Transport(_))) {
            terminate_process(&mut state);
        }
        result.map_err(HostCallError::into_string)
    }

    pub fn unload_plugin(&self) -> Result<(), String> {
        if self.inner.lock().unwrap().process.is_none() {
            return Ok(());
        }
        self.call(method::UNLOAD_PLUGIN, json!({})).map(|_| ())
    }

    pub fn shutdown(&self) {
        let _ = self.call(method::SHUTDOWN, json!({}));
        let mut state = self.inner.lock().unwrap();
        if let Some(mut process) = state.process.take() {
            let _ = process.child.wait();
        }
    }

    fn ensure_started(&self) -> Result<(), String> {
        if self.inner.lock().unwrap().process.is_none() {
            self.start()?;
        }
        Ok(())
    }

    fn call_locked(
        &self,
        state: &mut SupervisorState,
        method_name: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, HostCallError> {
        let request_id = format!(
            "app-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        let request = Message::Request(Request::new(&request_id, method_name, params));
        let encoded = serde_json::to_string(&request)
            .map_err(|error| HostCallError::Transport(error.to_string()))?;
        let process = state
            .process
            .as_mut()
            .ok_or_else(|| HostCallError::Transport("plugin_host_not_running".to_string()))?;
        writeln!(process.stdin, "{encoded}")
            .map_err(|error| HostCallError::Transport(error.to_string()))?;
        process
            .stdin
            .flush()
            .map_err(|error| HostCallError::Transport(error.to_string()))?;

        loop {
            match process.messages.recv_timeout(timeout) {
                Ok(Message::Response(response)) if response.id == request_id => {
                    return response_result(response).map_err(HostCallError::Rpc)
                }
                Ok(_) => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    return Err(HostCallError::Transport("plugin_host_timeout".to_string()))
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(HostCallError::Transport(
                        "plugin_host_disconnected".to_string(),
                    ))
                }
            }
        }
    }
}

enum HostCallError {
    Transport(String),
    Rpc(String),
}

impl HostCallError {
    fn into_string(self) -> String {
        match self {
            Self::Transport(message) | Self::Rpc(message) => message,
        }
    }
}

impl Drop for PluginHostSupervisor {
    fn drop(&mut self) {
        let state = self.inner.get_mut().unwrap();
        if let Some(process) = state.process.as_mut() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

#[tauri::command]
pub fn plugin_host_status(state: tauri::State<'_, crate::AppState>) -> PluginHostSnapshot {
    state.plugin_host.status()
}

#[tauri::command]
pub fn plugin_host_ping(state: tauri::State<'_, crate::AppState>) -> Result<Value, String> {
    state.plugin_host.ping()
}

fn spawn_host() -> Result<HostProcess, String> {
    let executable = resolve_host_executable().ok_or_else(|| {
        "找不到 gt-plugin-host；请先运行 cargo build -p gt-plugin-host".to_string()
    })?;
    let mut child = Command::new(&executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 {} 失败: {error}", executable.display()))?;
    let process_id = child.id();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "plugin_host_stdin_missing".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "plugin_host_stdout_missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "plugin_host_stderr_missing".to_string())?;
    let (sender, receiver) = mpsc::channel();

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => match serde_json::from_str::<Message>(&line) {
                    Ok(message) => {
                        if sender.send(message).is_err() {
                            break;
                        }
                    }
                    Err(error) => eprintln!("[gt-plugin-host] invalid stdout frame: {error}"),
                },
                Err(error) => {
                    eprintln!("[gt-plugin-host] stdout error: {error}");
                    break;
                }
            }
        }
    });
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[gt-plugin-host] {line}");
        }
    });

    match receiver.recv_timeout(CONTROL_REQUEST_TIMEOUT) {
        Ok(Message::Event(message)) if message.event == event::HELLO => Ok(HostProcess {
            child,
            stdin,
            messages: receiver,
            process_id,
        }),
        Ok(_) => {
            let _ = child.kill();
            Err("plugin_host_invalid_handshake".to_string())
        }
        Err(_) => {
            let _ = child.kill();
            Err("plugin_host_handshake_timeout".to_string())
        }
    }
}

fn resolve_host_executable() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("GT_PLUGIN_HOST_BIN").map(PathBuf::from) {
        if is_executable_file(&path) {
            return Some(path);
        }
    }
    let file_name = if cfg!(windows) {
        "gt-plugin-host.exe"
    } else {
        "gt-plugin-host"
    };
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let sibling = parent.join(file_name);
            if is_executable_file(&sibling) {
                return Some(sibling);
            }
        }
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        })
        .join(file_name);
    is_executable_file(&development).then_some(development)
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn refresh_process_state(state: &mut SupervisorState) {
    let finished = state
        .process
        .as_mut()
        .and_then(|process| process.child.try_wait().ok().flatten());
    if let Some(status) = finished {
        state.last_error = Some(format!("gt-plugin-host 已退出: {status}"));
        state.process = None;
    }
}

fn terminate_process(state: &mut SupervisorState) {
    if let Some(mut process) = state.process.take() {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
    state.last_error = Some("gt-plugin-host transport failed and was terminated".to_string());
}

fn snapshot(state: &SupervisorState) -> PluginHostSnapshot {
    PluginHostSnapshot {
        running: state.process.is_some(),
        process_id: state.process.as_ref().map(|process| process.process_id),
        last_error: state.last_error.clone(),
    }
}

fn response_result(response: Response) -> Result<Value, String> {
    if let Some(error) = response.error {
        return Err(error.code);
    }
    Ok(response.result.unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_override_falls_back_without_panicking() {
        let _ = resolve_host_executable();
    }
}
