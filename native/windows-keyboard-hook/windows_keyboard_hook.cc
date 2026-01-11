#include <napi.h>
#include <windows.h>
#include <map>

// Key event data structure
struct KeyEventData {
    DWORD vkCode;
    DWORD scanCode;
    bool isKeyDown;
    bool isExtended;
    bool isAltPressed;
    bool isCtrlPressed;
    bool isShiftPressed;
};

// Global hook handle
HHOOK g_keyboardHook = nullptr;
Napi::ThreadSafeFunction g_tsfn = nullptr;
bool g_hookActive = false;
bool g_consumeKeys = false;

// Key state tracking
std::map<DWORD, bool> g_keyStates;

// Low-level keyboard hook procedure
LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= HC_ACTION) {
        KBDLLHOOKSTRUCT* kbdStruct = (KBDLLHOOKSTRUCT*)lParam;
        DWORD vkCode = kbdStruct->vkCode;
        
        // Only process if hook is active and we should consume keys
        if (g_hookActive && g_consumeKeys) {
            bool isKeyDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);
            
            // Update key state
            g_keyStates[vkCode] = isKeyDown;
            
            // Prepare key event data
            KeyEventData* eventData = new KeyEventData();
            eventData->vkCode = vkCode;
            eventData->scanCode = kbdStruct->scanCode;
            eventData->isKeyDown = isKeyDown;
            eventData->isExtended = (kbdStruct->flags & LLKHF_EXTENDED) != 0;
            eventData->isAltPressed = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
            eventData->isCtrlPressed = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
            eventData->isShiftPressed = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
            
            // Send to JavaScript (non-blocking)
            if (g_tsfn) {
                auto callback = [](Napi::Env env, Napi::Function jsCallback, KeyEventData* data) {
                    if (jsCallback && data) {
                        Napi::Object eventObj = Napi::Object::New(env);
                        eventObj.Set("keyCode", Napi::Number::New(env, data->vkCode));
                        eventObj.Set("scanCode", Napi::Number::New(env, data->scanCode));
                        eventObj.Set("isKeyDown", Napi::Boolean::New(env, data->isKeyDown));
                        eventObj.Set("isExtended", Napi::Boolean::New(env, data->isExtended));
                        eventObj.Set("isAltPressed", Napi::Boolean::New(env, data->isAltPressed));
                        eventObj.Set("isCtrlPressed", Napi::Boolean::New(env, data->isCtrlPressed));
                        eventObj.Set("isShiftPressed", Napi::Boolean::New(env, data->isShiftPressed));
                        
                        jsCallback.Call({ eventObj });
                    }
                    if (data) {
                        delete data;
                    }
                };
                
                napi_status status = g_tsfn.NonBlockingCall(eventData, callback);
                if (status != napi_ok) {
                    delete eventData;
                }
            } else {
                delete eventData;
            }
            
            // Consume the key (prevent it from reaching other windows)
            return 1;
        }
    }
    
    // Pass through to next hook
    return CallNextHookEx(g_keyboardHook, nCode, wParam, lParam);
}

// Install keyboard hook
Napi::Boolean InstallKeyboardHook(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (g_keyboardHook != nullptr) {
        return Napi::Boolean::New(env, true); // Already installed
    }
    
    // Install low-level keyboard hook
    g_keyboardHook = SetWindowsHookEx(
        WH_KEYBOARD_LL,
        LowLevelKeyboardProc,
        GetModuleHandle(nullptr),
        0
    );
    
    if (g_keyboardHook == nullptr) {
        return Napi::Boolean::New(env, false);
    }
    
    g_hookActive = true;
    return Napi::Boolean::New(env, true);
}

// Uninstall keyboard hook
Napi::Boolean UninstallKeyboardHook(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (g_keyboardHook == nullptr) {
        return Napi::Boolean::New(env, true); // Already uninstalled
    }
    
    g_hookActive = false;
    BOOL result = UnhookWindowsHookEx(g_keyboardHook);
    g_keyboardHook = nullptr;
    g_keyStates.clear();
    
    return Napi::Boolean::New(env, result != FALSE);
}

// Set whether to consume keys
Napi::Boolean SetConsumeKeys(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected boolean argument").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
    
    g_consumeKeys = info[0].As<Napi::Boolean>().Value();
    return Napi::Boolean::New(env, true);
}

// Set callback for key events
Napi::Boolean SetKeyEventCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected function argument").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
    
    // Release previous callback if exists
    if (g_tsfn) {
        g_tsfn.Release();
        g_tsfn = nullptr;
    }
    
    // Create thread-safe function
    g_tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "KeyboardHookCallback",
        0,
        1,
        [](Napi::Env) {
            // Finalizer - called when thread-safe function is destroyed
        }
    );
    
    return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(
        Napi::String::New(env, "installKeyboardHook"),
        Napi::Function::New(env, InstallKeyboardHook)
    );
    exports.Set(
        Napi::String::New(env, "uninstallKeyboardHook"),
        Napi::Function::New(env, UninstallKeyboardHook)
    );
    exports.Set(
        Napi::String::New(env, "setConsumeKeys"),
        Napi::Function::New(env, SetConsumeKeys)
    );
    exports.Set(
        Napi::String::New(env, "setKeyEventCallback"),
        Napi::Function::New(env, SetKeyEventCallback)
    );
    return exports;
}

NODE_API_MODULE(windows_keyboard_hook, Init)

