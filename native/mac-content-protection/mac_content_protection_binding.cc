#include <napi.h>
// Note: Don't include AppKit here - it's only needed in the .mm file

// External C functions from the Objective-C++ file
extern void SetAllElectronWindowsContentProtection(bool enable);
extern void SetWindowContentProtection(unsigned long windowId, bool enable);
extern void SetWindowLevelAboveLockdown(unsigned long windowId);
extern void SetWindowContentProtectionFromPointer(void* windowPointer, bool enable);
extern unsigned long GetWindowIdFromHandle(void* handle);
extern void SetContentProtectionForView(void* viewHandle, bool enable);
extern void SetWindowHiddenFromMissionControl(unsigned long windowId, bool hidden);
extern void DisableHardwareVideoCapture(unsigned long windowId, bool disable);
extern void SetFullscreenExclusiveMode(unsigned long windowId, bool enable);
extern void SetProtectedSwapchain(unsigned long windowId, bool enable);
extern void SetSandboxBehavior(unsigned long windowId, bool enable);
extern void ApplyComprehensiveStealth(unsigned long windowId, bool enable);
extern void ApplyComprehensiveStealthUndetectable(unsigned long windowId, bool enable);
extern void SetActivationPolicyAccessory(bool accessory);
extern void EnableSecureInputProtection(unsigned long windowId, bool enable);
extern void EnableGlobalSecureInput(bool enable);
extern void EnableDRMProtection(unsigned long windowId, bool enable);
extern void EnableMetalExclusiveRendering(unsigned long windowId, bool enable);
extern void EnableProtectedOverlay(unsigned long windowId, bool enable);
extern void EnableBankingAppProtection(unsigned long windowId, bool enable);

// N-API wrapper function
Napi::Value SetContentProtection(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowId and enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "First argument must be a window ID (number)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Second argument must be a boolean")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Get window ID (window number on macOS)
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    
    if (windowId == 0) {
        Napi::Error::New(env, "Invalid window ID (0)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Set content protection using window number
    SetWindowContentProtection(windowId, enable);
    
    return Napi::Boolean::New(env, true);
}

// Alternative function that accepts a view handle
Napi::Value SetContentProtectionForViewHandle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: viewHandle and enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsExternal()) {
        Napi::TypeError::New(env, "First argument must be a view handle (external)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Second argument must be a boolean")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    void* viewHandle = info[0].As<Napi::External<void>>().Data();
    bool enable = info[1].As<Napi::Boolean>().Value();
    
    SetContentProtectionForView(viewHandle, enable);
    
    return Napi::Boolean::New(env, true);
}

// Function to set content protection using window pointer
Napi::Value SetContentProtectionFromPointer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowPointer and enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsBuffer() && !info[0].IsExternal()) {
        Napi::TypeError::New(env, "First argument must be a Buffer (window pointer) or External")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Second argument must be a boolean")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    void* windowPointer = nullptr;
    
    if (info[0].IsBuffer()) {
        Napi::Buffer<void> buffer = info[0].As<Napi::Buffer<void>>();
        windowPointer = buffer.Data();
    } else if (info[0].IsExternal()) {
        windowPointer = info[0].As<Napi::External<void>>().Data();
    }
    
    bool enable = info[1].As<Napi::Boolean>().Value();
    
    if (!windowPointer) {
        Napi::Error::New(env, "Invalid window pointer")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    SetWindowContentProtectionFromPointer(windowPointer, enable);
    
    return Napi::Boolean::New(env, true);
}

// Set only window level above Lockdown Browser (so overlay appears on top)
Napi::Value SetWindowLevelAboveLockdownJs(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected windowId (number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    if (windowId == 0) return Napi::Boolean::New(env, false);
    SetWindowLevelAboveLockdown(windowId);
    return Napi::Boolean::New(env, true);
}

// Function to protect all windows (most reliable method)
Napi::Value SetAllWindowsContentProtection(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument: enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Argument must be a boolean")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    bool enable = info[0].As<Napi::Boolean>().Value();
    SetAllElectronWindowsContentProtection(enable);
    
    return Napi::Boolean::New(env, true);
}

// Function to hide from Mission Control
Napi::Value HideFromMissionControl(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowId and hidden")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Arguments must be (number, boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool hidden = info[1].As<Napi::Boolean>().Value();
    
    SetWindowHiddenFromMissionControl(windowId, hidden);
    
    return Napi::Boolean::New(env, true);
}

// Function to disable hardware video capture
Napi::Value DisableVideoCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowId and disable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Arguments must be (number, boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool disable = info[1].As<Napi::Boolean>().Value();
    
    DisableHardwareVideoCapture(windowId, disable);
    
    return Napi::Boolean::New(env, true);
}

// Function to enable fullscreen exclusive mode
Napi::Value FullscreenExclusiveMode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowId and enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Arguments must be (number, boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    
    SetFullscreenExclusiveMode(windowId, enable);
    
    return Napi::Boolean::New(env, true);
}

// Function to enable protected swapchain
Napi::Value ProtectedSwapchain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowId and enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Arguments must be (number, boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    
    SetProtectedSwapchain(windowId, enable);
    
    return Napi::Boolean::New(env, true);
}

// Function to set sandbox behavior
Napi::Value SandboxBehavior(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowId and enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Arguments must be (number, boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    
    SetSandboxBehavior(windowId, enable);
    
    return Napi::Boolean::New(env, true);
}

// Master function to apply comprehensive stealth
Napi::Value ComprehensiveStealth(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowId and enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Arguments must be (number, boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    
    ApplyComprehensiveStealth(windowId, enable);
    
    return Napi::Boolean::New(env, true);
}

// Undetectable stealth: same protections but window level 1000 (less detectable than 3000)
Napi::Value ComprehensiveStealthUndetectable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (windowId, enable)").ThrowAsJavaScriptException();
        return env.Null();
    }
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    ApplyComprehensiveStealthUndetectable(windowId, enable);
    return Napi::Boolean::New(env, true);
}

// Function to enable secure input protection (like password fields)
Napi::Value SecureInputProtection(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments: windowId and enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "Arguments must be (number, boolean)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    unsigned long windowId = info[0].As<Napi::Number>().Uint32Value();
    bool enable = info[1].As<Napi::Boolean>().Value();
    
    EnableSecureInputProtection(windowId, enable);
    
    return Napi::Boolean::New(env, true);
}

// Function to enable global secure input (all windows)
Napi::Value GlobalSecureInput(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected 1 argument: enable")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    if (!info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Argument must be a boolean")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    
    bool enable = info[0].As<Napi::Boolean>().Value();
    
    EnableGlobalSecureInput(enable);
    
    return Napi::Boolean::New(env, true);
}

// Set activation policy to Accessory (hide from Dock + Cmd+Tab) for stealth
Napi::Value SetActivationPolicyAccessoryJs(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Expected one boolean argument").ThrowAsJavaScriptException();
        return env.Null();
    }
    SetActivationPolicyAccessory(info[0].As<Napi::Boolean>().Value());
    return Napi::Boolean::New(env, true);
}

// Initialize the module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(
        Napi::String::New(env, "setWindowLevelAboveLockdown"),
        Napi::Function::New(env, SetWindowLevelAboveLockdownJs)
    );
    exports.Set(
        Napi::String::New(env, "setAllWindowsContentProtection"),
        Napi::Function::New(env, SetAllWindowsContentProtection)
    );
    
    exports.Set(
        Napi::String::New(env, "setContentProtection"),
        Napi::Function::New(env, SetContentProtection)
    );
    
    exports.Set(
        Napi::String::New(env, "setContentProtectionFromPointer"),
        Napi::Function::New(env, SetContentProtectionFromPointer)
    );
    
    exports.Set(
        Napi::String::New(env, "setContentProtectionForView"),
        Napi::Function::New(env, SetContentProtectionForViewHandle)
    );
    
    exports.Set(
        Napi::String::New(env, "hideFromMissionControl"),
        Napi::Function::New(env, HideFromMissionControl)
    );
    
    exports.Set(
        Napi::String::New(env, "disableHardwareVideoCapture"),
        Napi::Function::New(env, DisableVideoCapture)
    );
    
    exports.Set(
        Napi::String::New(env, "setFullscreenExclusiveMode"),
        Napi::Function::New(env, FullscreenExclusiveMode)
    );
    
    exports.Set(
        Napi::String::New(env, "setProtectedSwapchain"),
        Napi::Function::New(env, ProtectedSwapchain)
    );
    
    exports.Set(
        Napi::String::New(env, "setSandboxBehavior"),
        Napi::Function::New(env, SandboxBehavior)
    );
    
    exports.Set(
        Napi::String::New(env, "applyComprehensiveStealth"),
        Napi::Function::New(env, ComprehensiveStealth)
    );
    exports.Set(
        Napi::String::New(env, "applyComprehensiveStealthUndetectable"),
        Napi::Function::New(env, ComprehensiveStealthUndetectable)
    );
    exports.Set(
        Napi::String::New(env, "setActivationPolicyAccessory"),
        Napi::Function::New(env, SetActivationPolicyAccessoryJs)
    );
    
    exports.Set(
        Napi::String::New(env, "enableSecureInputProtection"),
        Napi::Function::New(env, SecureInputProtection)
    );
    
    exports.Set(
        Napi::String::New(env, "enableGlobalSecureInput"),
        Napi::Function::New(env, GlobalSecureInput)
    );
    
    // Method 12: DRM Protection
    exports.Set(
        Napi::String::New(env, "enableDRMProtection"),
        Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
            Napi::Env env = info.Env();
            if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
                Napi::TypeError::New(env, "Expected (number, boolean)").ThrowAsJavaScriptException();
                return env.Null();
            }
            EnableDRMProtection(info[0].As<Napi::Number>().Uint32Value(), info[1].As<Napi::Boolean>().Value());
            return Napi::Boolean::New(env, true);
        })
    );
    
    // Method 13: Metal Exclusive Rendering
    exports.Set(
        Napi::String::New(env, "enableMetalExclusiveRendering"),
        Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
            Napi::Env env = info.Env();
            if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
                Napi::TypeError::New(env, "Expected (number, boolean)").ThrowAsJavaScriptException();
                return env.Null();
            }
            EnableMetalExclusiveRendering(info[0].As<Napi::Number>().Uint32Value(), info[1].As<Napi::Boolean>().Value());
            return Napi::Boolean::New(env, true);
        })
    );
    
    // Method 14: Protected Overlay
    exports.Set(
        Napi::String::New(env, "enableProtectedOverlay"),
        Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
            Napi::Env env = info.Env();
            if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
                Napi::TypeError::New(env, "Expected (number, boolean)").ThrowAsJavaScriptException();
                return env.Null();
            }
            EnableProtectedOverlay(info[0].As<Napi::Number>().Uint32Value(), info[1].As<Napi::Boolean>().Value());
            return Napi::Boolean::New(env, true);
        })
    );
    
    // Method 15: Banking App Protection
    exports.Set(
        Napi::String::New(env, "enableBankingAppProtection"),
        Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
            Napi::Env env = info.Env();
            if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
                Napi::TypeError::New(env, "Expected (number, boolean)").ThrowAsJavaScriptException();
                return env.Null();
            }
            EnableBankingAppProtection(info[0].As<Napi::Number>().Uint32Value(), info[1].As<Napi::Boolean>().Value());
            return Napi::Boolean::New(env, true);
        })
    );
    
    return exports;
}

NODE_API_MODULE(mac_content_protection, Init)

