#include <napi.h>
#include <windows.h>

// Hide window from Alt+Tab by setting WS_EX_TOOLWINDOW style
Napi::Boolean HideFromAltTab(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected HWND buffer").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
    
    // Get HWND from buffer
    Napi::Buffer<uint8_t> hwndBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    HWND hwnd = *reinterpret_cast<HWND*>(hwndBuffer.Data());
    
    if (!hwnd || !IsWindow(hwnd)) {
        return Napi::Boolean::New(env, false);
    }
    
    // Get current window style
    LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
    
    // Add WS_EX_TOOLWINDOW to hide from Alt+Tab
    // Remove WS_EX_APPWINDOW to prevent it from appearing in taskbar
    exStyle |= WS_EX_TOOLWINDOW;
    exStyle &= ~WS_EX_APPWINDOW;
    
    // Set the new style
    SetWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);
    
    return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(
        Napi::String::New(env, "hideFromAltTab"),
        Napi::Function::New(env, HideFromAltTab)
    );
    return exports;
}

NODE_API_MODULE(windows_hide_alt_tab, Init)

