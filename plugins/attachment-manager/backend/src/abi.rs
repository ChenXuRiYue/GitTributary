use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use serde_json::{json, Value};

pub const PLUGIN_ABI_VERSION: u32 = 1;

#[no_mangle]
pub extern "C" fn noteaura_plugin_abi_version() -> u32 {
    PLUGIN_ABI_VERSION
}

#[no_mangle]
/// Handles one plugin request encoded as JSON.
///
/// # Safety
///
/// `method` and `payload` must be non-null pointers to valid, NUL-terminated C strings. The
/// returned pointer must be released exactly once with [`noteaura_plugin_free_string`].
pub unsafe extern "C" fn noteaura_plugin_handle_request(
    method: *const c_char,
    payload: *const c_char,
) -> *mut c_char {
    if method.is_null() || payload.is_null() {
        return CString::new(r#"{"error":"invalid_pointer"}"#)
            .unwrap()
            .into_raw();
    }
    let method = CStr::from_ptr(method).to_string_lossy();
    let payload = CStr::from_ptr(payload).to_string_lossy();
    let result = serde_json::from_str::<Value>(&payload)
        .map_err(|error| error.to_string())
        .and_then(|value| crate::handle_request(&method, value));
    let response = match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    CString::new(response.to_string()).unwrap().into_raw()
}

#[no_mangle]
/// Releases a response allocated by [`noteaura_plugin_handle_request`].
///
/// # Safety
///
/// `value` must be null or a pointer returned by [`noteaura_plugin_handle_request`] that has
/// not already been released.
pub unsafe extern "C" fn noteaura_plugin_free_string(value: *mut c_char) {
    if !value.is_null() {
        drop(CString::from_raw(value));
    }
}
