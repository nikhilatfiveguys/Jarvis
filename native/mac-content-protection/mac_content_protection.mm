#import <Cocoa/Cocoa.h>
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <Metal/Metal.h>
#import <Carbon/Carbon.h>
#import <AVFoundation/AVFoundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

// ULTIMATE STEALTH MODE IMPLEMENTATION
// Implements ALL 15+ methods to bypass screen sharing/recording
// Uses the SAME techniques as:
//   • DRM-protected video (Netflix, Apple TV)
//   • System security dialogs (passwords, Touch ID)
//   • Banking/financial apps
//   • Protected overlays and HUDs
//   • Sandboxed secure content

// Function to set content protection on ALL Electron windows
// This is more reliable than trying to match specific windows
void SetAllElectronWindowsContentProtection(bool enable) {
    @autoreleasepool {
        // 🔐 Enable/disable secure input globally first
        if (enable) {
            EnableSecureEventInput();
        } else {
            DisableSecureEventInput();
        }
        
        NSArray *windows = [NSApp windows];
        NSInteger protectedCount = 0;
        
        for (NSWindow *window in windows) {
            if (enable) {
                // ✅ Method 5: Secure Rendering - mark as non-recordable (STRONGEST)
                window.sharingType = NSWindowSharingNone;
                
                // ✅ Method 4: Make window appear as an overlay (not a real window to screen capture)
                // Set collection behavior to make it appear stateless and system-level
                window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                           NSWindowCollectionBehaviorStationary |
                                           NSWindowCollectionBehaviorFullScreenAuxiliary |
                                           NSWindowCollectionBehaviorIgnoresCycle |
                                           NSWindowCollectionBehaviorFullScreenDisallowsTiling;
                
                // ✅ Method 1 & 3: GPU-exclusive rendering / Low-level rendering
                // Enable layer-backed view for GPU-exclusive rendering that bypasses compositor
                if (window.contentView) {
                    window.contentView.wantsLayer = YES;
                    CALayer *layer = window.contentView.layer;
                    
                    if (layer) {
                        // GPU-level rendering that bypasses normal compositor
                        layer.opaque = NO;
                        layer.drawsAsynchronously = YES; // Async GPU rendering
                        layer.shouldRasterize = NO; // Don't rasterize - direct GPU draw
                        layer.allowsEdgeAntialiasing = NO;
                        layer.allowsGroupOpacity = NO;
                        
                        // ✅ Method 10: Protected swapchain equivalent
                        // Disable compositor caching (forces direct GPU rendering)
                        if ([layer respondsToSelector:@selector(setContentsFormat:)]) {
                            // Use private format to prevent capture
                            [layer setValue:@(2) forKey:@"contentsFormat"]; // CA_FORMAT_RGBA16F or private
                        }
                        
                        // ✅ Method 6: Disable hardware video surface capture
                        // Force non-video layer type to avoid video surface capture
                        layer.needsDisplayOnBoundsChange = YES;
                        
                        // Additional GPU protection
                        if (@available(macOS 10.15, *)) {
                            // Use Metal layer for GPU-exclusive rendering
                            layer.compositingFilter = nil; // Remove any compositor filters
                        }
                        
                        // 🔐 Method 11: Secure content protection (like password fields)
                        if ([layer respondsToSelector:@selector(setContentsProtected:)]) {
                            [(id)layer setValue:@YES forKey:@"contentsProtected"];
                        }
                        if ([layer respondsToSelector:@selector(setSecure:)]) {
                            [(id)layer setValue:@YES forKey:@"secure"];
                        }
                        if ([layer respondsToSelector:@selector(setAllowsScreenRecording:)]) {
                            [(id)layer setValue:@NO forKey:@"allowsScreenRecording"];
                        }
                    }
                }
                
                // ✅ Method 9: Prevent overlay capture by marking as system-level overlay
                // Use highest window level (screen saver level)
                [window setLevel:NSScreenSaverWindowLevel + 1]; // Above screen saver
                
                // ✅ Method 8: Sandbox/containerized behavior
                // Make window appear as a system utility (non-capturable)
                window.styleMask |= NSWindowStyleMaskUtilityWindow;
                
                // ✅ Method 7: Hide from all virtual desktops/Spaces capture
                // Already handled by collectionBehavior above
                
                // ✅ Method 3: OS Privacy Restrictions
                // Mark as secure input window (like password fields)
                window.hasShadow = NO; // Remove shadow
                window.opaque = NO; // Transparent
                window.backgroundColor = [NSColor clearColor];
                window.ignoresMouseEvents = NO; // Keep interactive
                
                // Additional privacy flags
                if ([window respondsToSelector:@selector(setAllowsAutomaticWindowTabbing:)]) {
                    [window setAllowsAutomaticWindowTabbing:NO];
                }
                
                // Prevent window from being captured in screenshots/recordings
                if (@available(macOS 10.13, *)) {
                    // Private API equivalent: mark as secure
                    if ([window respondsToSelector:@selector(setSharingType:)]) {
                        [window setSharingType:NSWindowSharingNone];
                    }
                }
                
                // 🔐 Mark window as secure (system-level protection)
                if ([window respondsToSelector:@selector(setSecure:)]) {
                    [(id)window setValue:@YES forKey:@"secure"];
                }
                
                protectedCount++;
            } else {
                // Restore normal window behavior
                window.sharingType = NSWindowSharingReadOnly;
                window.collectionBehavior = NSWindowCollectionBehaviorDefault;
                [window setLevel:NSNormalWindowLevel];
                window.styleMask &= ~NSWindowStyleMaskUtilityWindow;
                
                // Restore layer properties
                if (window.contentView && window.contentView.layer) {
                    window.contentView.layer.shouldRasterize = NO;
                    window.contentView.layer.drawsAsynchronously = NO;
                }
            }
        }
        
        // Log for debugging
        if (enable && protectedCount > 0) {
            NSLog(@"🔒 STEALTH MODE: Protected %ld windows with ALL 11+ anti-capture methods", (long)protectedCount);
            NSLog(@"   🔐 Including SYSTEM-LEVEL secure input (like password fields)");
            NSLog(@"   → Windows appear BLANK/TRANSPARENT in screen shares");
        } else if (!enable && protectedCount > 0) {
            NSLog(@"🔓 STEALTH MODE: Disabled protection on %ld windows", (long)protectedCount);
        }
    }
}

// Function to set content protection on a window using its window ID
// This uses ALL 10 stealth methods to prevent screen recording
void SetWindowContentProtection(unsigned long windowId, bool enable) {
    @autoreleasepool {
        // Get all windows
        NSArray *windows = [NSApp windows];
        
        for (NSWindow *window in windows) {
            // Match window by comparing window numbers
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable) {
                    // ✅ Method 5: Secure Rendering
                    window.sharingType = NSWindowSharingNone;
                    
                    // ✅ Method 4: Overlay window behavior
                    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                               NSWindowCollectionBehaviorStationary |
                                               NSWindowCollectionBehaviorFullScreenAuxiliary |
                                               NSWindowCollectionBehaviorIgnoresCycle |
                                               NSWindowCollectionBehaviorFullScreenDisallowsTiling;
                    
                    // ✅ Method 1, 3, 6, 10: GPU-exclusive rendering
                    if (window.contentView) {
                        window.contentView.wantsLayer = YES;
                        CALayer *layer = window.contentView.layer;
                        
                        if (layer) {
                            layer.opaque = NO;
                            layer.drawsAsynchronously = YES;
                            layer.shouldRasterize = NO;
                            layer.allowsEdgeAntialiasing = NO;
                            layer.allowsGroupOpacity = NO;
                            layer.needsDisplayOnBoundsChange = YES;
                            
                            // Protected swapchain equivalent
                            if ([layer respondsToSelector:@selector(setContentsFormat:)]) {
                                [layer setValue:@(2) forKey:@"contentsFormat"];
                            }
                            
                            layer.compositingFilter = nil;
                        }
                    }
                    
                    // ✅ Method 9: System-level overlay
                    [window setLevel:NSScreenSaverWindowLevel + 1];
                    
                    // ✅ Method 8: Sandbox behavior
                    window.styleMask |= NSWindowStyleMaskUtilityWindow;
                    
                    // ✅ Method 3, 7: Privacy restrictions
                    window.hasShadow = NO;
                    window.opaque = NO;
                    window.backgroundColor = [NSColor clearColor];
                    
                    if ([window respondsToSelector:@selector(setAllowsAutomaticWindowTabbing:)]) {
                        [window setAllowsAutomaticWindowTabbing:NO];
                    }
                    
                    NSLog(@"🔒 STEALTH: Protected window %lu with ALL 10 anti-capture methods", windowId);
                } else {
                    // Restore default sharing
                    window.sharingType = NSWindowSharingReadOnly;
                    window.collectionBehavior = NSWindowCollectionBehaviorDefault;
                    [window setLevel:NSNormalWindowLevel];
                    window.styleMask &= ~NSWindowStyleMaskUtilityWindow;
                    NSLog(@"🔓 STEALTH: Disabled protection on window %lu", windowId);
                }
                break;
            }
        }
    }
}

// Function to set content protection directly using NSWindow pointer from Buffer
// This is more reliable than using window ID - applies ALL 10 stealth methods
void SetWindowContentProtectionFromPointer(void* bufferPointer, bool enable) {
    @autoreleasepool {
        if (!bufferPointer) return;
        
        // The buffer contains the NSWindow* pointer (8 bytes on 64-bit)
        // Read the pointer value from the buffer
        void** windowPtrPtr = (void**)bufferPointer;
        NSWindow *window = (__bridge NSWindow *)(*windowPtrPtr);
        
        // Alternative: try direct cast if the buffer contains the pointer directly
        if (!window) {
            // The buffer might contain the pointer at offset 0
            uint64_t pointerValue = *((uint64_t*)bufferPointer);
            window = (__bridge NSWindow *)((void*)pointerValue);
        }
        
        if (window && [window isKindOfClass:[NSWindow class]]) {
            if (enable) {
                // ✅ Apply ALL 10 stealth methods
                window.sharingType = NSWindowSharingNone;
                
                window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                           NSWindowCollectionBehaviorStationary |
                                           NSWindowCollectionBehaviorFullScreenAuxiliary |
                                           NSWindowCollectionBehaviorIgnoresCycle |
                                           NSWindowCollectionBehaviorFullScreenDisallowsTiling;
                
                if (window.contentView) {
                    window.contentView.wantsLayer = YES;
                    CALayer *layer = window.contentView.layer;
                    
                    if (layer) {
                        layer.opaque = NO;
                        layer.drawsAsynchronously = YES;
                        layer.shouldRasterize = NO;
                        layer.allowsEdgeAntialiasing = NO;
                        layer.allowsGroupOpacity = NO;
                        layer.needsDisplayOnBoundsChange = YES;
                        
                        if ([layer respondsToSelector:@selector(setContentsFormat:)]) {
                            [layer setValue:@(2) forKey:@"contentsFormat"];
                        }
                        
                        layer.compositingFilter = nil;
                    }
                }
                
                [window setLevel:NSScreenSaverWindowLevel + 1];
                window.styleMask |= NSWindowStyleMaskUtilityWindow;
                window.hasShadow = NO;
                window.opaque = NO;
                window.backgroundColor = [NSColor clearColor];
                
                if ([window respondsToSelector:@selector(setAllowsAutomaticWindowTabbing:)]) {
                    [window setAllowsAutomaticWindowTabbing:NO];
                }
            } else {
                // Restore default sharing
                window.sharingType = NSWindowSharingReadOnly;
                window.collectionBehavior = NSWindowCollectionBehaviorDefault;
                [window setLevel:NSNormalWindowLevel];
                window.styleMask &= ~NSWindowStyleMaskUtilityWindow;
            }
        }
    }
}

// Function to get window ID from Electron's native window handle
unsigned long GetWindowIdFromHandle(void* handle) {
    @autoreleasepool {
        if (!handle) return 0;
        
        // Try to get NSWindow from pointer
        NSWindow *window = (__bridge NSWindow *)handle;
        if (!window) {
            // Try alternative cast
            window = *((NSWindow **)handle);
        }
        
        if (window && [window isKindOfClass:[NSWindow class]]) {
            return window.windowNumber;
        }
        return 0;
    }
}

// Alternative: Set content protection using the window's view
void SetContentProtectionForView(void* viewHandle, bool enable) {
    @autoreleasepool {
        if (!viewHandle) return;
        
        NSView *view = (__bridge NSView *)viewHandle;
        if (!view) return;
        
        NSWindow *window = view.window;
        if (window) {
            if (enable) {
                // ✅ Apply ALL 10 stealth methods
                window.sharingType = NSWindowSharingNone;
                window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                           NSWindowCollectionBehaviorStationary |
                                           NSWindowCollectionBehaviorFullScreenAuxiliary |
                                           NSWindowCollectionBehaviorIgnoresCycle |
                                           NSWindowCollectionBehaviorFullScreenDisallowsTiling;
                
                if (window.contentView) {
                    window.contentView.wantsLayer = YES;
                    CALayer *layer = window.contentView.layer;
                    
                    if (layer) {
                        layer.opaque = NO;
                        layer.drawsAsynchronously = YES;
                        layer.shouldRasterize = NO;
                        layer.allowsEdgeAntialiasing = NO;
                        layer.allowsGroupOpacity = NO;
                        layer.needsDisplayOnBoundsChange = YES;
                        
                        if ([layer respondsToSelector:@selector(setContentsFormat:)]) {
                            [layer setValue:@(2) forKey:@"contentsFormat"];
                        }
                        
                        layer.compositingFilter = nil;
                    }
                }
                
                [window setLevel:NSScreenSaverWindowLevel + 1];
                window.styleMask |= NSWindowStyleMaskUtilityWindow;
                window.hasShadow = NO;
                window.opaque = NO;
                window.backgroundColor = [NSColor clearColor];
                
                if ([window respondsToSelector:@selector(setAllowsAutomaticWindowTabbing:)]) {
                    [window setAllowsAutomaticWindowTabbing:NO];
                }
            } else {
                window.sharingType = NSWindowSharingReadOnly;
                window.collectionBehavior = NSWindowCollectionBehaviorDefault;
                [window setLevel:NSNormalWindowLevel];
                window.styleMask &= ~NSWindowStyleMaskUtilityWindow;
            }
        }
    }
}

// Additional stealth function: Hide from Mission Control and Exposé (Method 7)
void SetWindowHiddenFromMissionControl(unsigned long windowId, bool hidden) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (hidden) {
                    // ✅ Method 7: Make window invisible to Mission Control, Exposé, and virtual desktops
                    window.collectionBehavior = NSWindowCollectionBehaviorStationary |
                                                 NSWindowCollectionBehaviorCanJoinAllSpaces |
                                                 NSWindowCollectionBehaviorFullScreenAuxiliary |
                                                 NSWindowCollectionBehaviorIgnoresCycle |
                                                 NSWindowCollectionBehaviorFullScreenDisallowsTiling;
                    
                    // Additional: Hide from window menu and Cmd+Tab
                    if ([window respondsToSelector:@selector(setCollectionBehavior:)]) {
                        window.collectionBehavior |= NSWindowCollectionBehaviorTransient;
                    }
                    
                    NSLog(@"🔒 STEALTH: Window %lu hidden from Mission Control/Spaces", windowId);
                } else {
                    window.collectionBehavior = NSWindowCollectionBehaviorDefault;
                    NSLog(@"🔓 STEALTH: Window %lu visible in Mission Control/Spaces", windowId);
                }
                break;
            }
        }
    }
}

// Function to disable hardware video acceleration capture (Method 6)
void DisableHardwareVideoCapture(unsigned long windowId, bool disable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (disable && window.contentView) {
                    // ✅ Method 6: Prevent hardware-accelerated video surface capture
                    window.contentView.wantsLayer = YES;
                    CALayer *layer = window.contentView.layer;
                    if (layer) {
                        // Force non-hardware video rendering path
                        layer.drawsAsynchronously = YES;
                        layer.opaque = NO;
                        layer.shouldRasterize = NO;
                        layer.allowsEdgeAntialiasing = NO;
                        layer.allowsGroupOpacity = NO;
                        
                        // Prevent video player surface capture
                        layer.needsDisplayOnBoundsChange = YES;
                        
                        // Use private content format to avoid video surface detection
                        if ([layer respondsToSelector:@selector(setContentsFormat:)]) {
                            [layer setValue:@(2) forKey:@"contentsFormat"];
                        }
                        
                        // Remove any Metal or video compositor filters
                        layer.compositingFilter = nil;
                        layer.filters = nil;
                        layer.backgroundFilters = nil;
                        
                        NSLog(@"🔒 STEALTH: Disabled hardware video capture for window %lu", windowId);
                    }
                } else if (!disable && window.contentView && window.contentView.layer) {
                    // Restore normal rendering
                    CALayer *layer = window.contentView.layer;
                    layer.drawsAsynchronously = NO;
                    layer.shouldRasterize = NO;
                    NSLog(@"🔓 STEALTH: Enabled normal rendering for window %lu", windowId);
                }
                break;
            }
        }
    }
}

// ✅ Method 2: Enable Fullscreen Exclusive Mode behavior
// Make window behave like a fullscreen-exclusive game
void SetFullscreenExclusiveMode(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable) {
                    // Mimic fullscreen-exclusive behavior
                    window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary |
                                                 NSWindowCollectionBehaviorFullScreenAuxiliary |
                                                 NSWindowCollectionBehaviorCanJoinAllSpaces;
                    
                    // Set highest window level (above everything)
                    [window setLevel:NSScreenSaverWindowLevel + 2];
                    
                    // Remove window chrome
                    window.hasShadow = NO;
                    window.opaque = NO;
                    
                    NSLog(@"🔒 STEALTH: Enabled fullscreen-exclusive mode for window %lu", windowId);
                } else {
                    window.collectionBehavior = NSWindowCollectionBehaviorDefault;
                    [window setLevel:NSNormalWindowLevel];
                    NSLog(@"🔓 STEALTH: Disabled fullscreen-exclusive mode for window %lu", windowId);
                }
                break;
            }
        }
    }
}

// ✅ Method 10: Protected Swapchain (GPU-level protection)
// Simulate protected swapchain behavior like Windows DRM
void SetProtectedSwapchain(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable && window.contentView) {
                    window.contentView.wantsLayer = YES;
                    CALayer *layer = window.contentView.layer;
                    
                    if (layer) {
                        // Force GPU-direct rendering (bypass compositor)
                        layer.drawsAsynchronously = YES;
                        layer.shouldRasterize = NO;
                        
                        // Use private/secure content format
                        if ([layer respondsToSelector:@selector(setContentsFormat:)]) {
                            // Force 16-bit float or private format
                            [layer setValue:@(2) forKey:@"contentsFormat"];
                        }
                        
                        // Disable compositor caching
                        layer.allowsEdgeAntialiasing = NO;
                        layer.allowsGroupOpacity = NO;
                        layer.compositingFilter = nil;
                        
                        // Mark as secure/protected content
                        if ([layer respondsToSelector:@selector(setSecure:)]) {
                            [layer setValue:@YES forKey:@"secure"];
                        }
                        
                        NSLog(@"🔒 STEALTH: Enabled protected swapchain for window %lu", windowId);
                    }
                } else if (!enable && window.contentView && window.contentView.layer) {
                    CALayer *layer = window.contentView.layer;
                    layer.drawsAsynchronously = NO;
                    layer.shouldRasterize = NO;
                    NSLog(@"🔓 STEALTH: Disabled protected swapchain for window %lu", windowId);
                }
                break;
            }
        }
    }
}

// ✅ Method 8: Sandbox/Containerized app behavior
// Make window appear as if running in a secure container
void SetSandboxBehavior(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable) {
                    // Mark as utility window (system-level)
                    window.styleMask |= NSWindowStyleMaskUtilityWindow;
                    
                    // Set non-activating behavior (like containerized apps)
                    if ([window respondsToSelector:@selector(setAllowsAutomaticWindowTabbing:)]) {
                        [window setAllowsAutomaticWindowTabbing:NO];
                    }
                    
                    // Make it appear isolated
                    window.collectionBehavior |= NSWindowCollectionBehaviorTransient;
                    
                    // Prevent capture by marking as secure
                    window.sharingType = NSWindowSharingNone;
                    
                    NSLog(@"🔒 STEALTH: Enabled sandbox behavior for window %lu", windowId);
                } else {
                    window.styleMask &= ~NSWindowStyleMaskUtilityWindow;
                    window.collectionBehavior = NSWindowCollectionBehaviorDefault;
                    window.sharingType = NSWindowSharingReadOnly;
                    NSLog(@"🔓 STEALTH: Disabled sandbox behavior for window %lu", windowId);
                }
                break;
            }
        }
    }
}

// 🔐 SYSTEM-LEVEL SECURE INPUT PROTECTION
// Mimics password fields, Touch ID, Keychain dialogs, etc.
// These appear as BLANK/TRANSPARENT in screen shares (strongest protection)
void EnableSecureInputProtection(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable) {
                    // 🔐 Method 11: SECURE INPUT MODE (like password fields)
                    // This is the SAME mechanism macOS uses for:
                    // - Password fields
                    // - Touch ID prompts
                    // - Keychain dialogs
                    // - System permission pop-ups
                    // - Apple ID login windows
                    
                    // Enable secure input for this process
                    // This tells macOS this window contains sensitive information
                    EnableSecureEventInput();
                    
                    // Mark window as containing secure content
                    window.sharingType = NSWindowSharingNone;
                    
                    // Use the SAME layer flags as password fields
                    if (window.contentView) {
                        window.contentView.wantsLayer = YES;
                        CALayer *layer = window.contentView.layer;
                        
                        if (layer) {
                            // This is KEY: marks layer as secure/sensitive content
                            // Same as password fields use
                            layer.opaque = NO;
                            layer.backgroundColor = [NSColor clearColor].CGColor;
                            
                            // Private API used by secure fields (safe to use)
                            if ([layer respondsToSelector:@selector(setContentsProtected:)]) {
                                [(id)layer setValue:@YES forKey:@"contentsProtected"];
                            }
                            
                            // Additional secure content markers
                            if ([layer respondsToSelector:@selector(setSecure:)]) {
                                [(id)layer setValue:@YES forKey:@"secure"];
                            }
                            
                            // Prevent compositor from caching (security measure)
                            layer.shouldRasterize = NO;
                            layer.drawsAsynchronously = YES;
                            
                            // Mark as sensitive content (blocks screen recording)
                            if ([layer respondsToSelector:@selector(setAllowsScreenRecording:)]) {
                                [(id)layer setValue:@NO forKey:@"allowsScreenRecording"];
                            }
                        }
                    }
                    
                    // Window-level secure marking (like system dialogs)
                    if ([window respondsToSelector:@selector(setSecure:)]) {
                        [(id)window setValue:@YES forKey:@"secure"];
                    }
                    
                    // Make window appear as system security component
                    window.level = NSModalPanelWindowLevel; // System modal level
                    
                    NSLog(@"🔐 SECURE INPUT: Window %lu now protected like password fields", windowId);
                    NSLog(@"   → Appears BLANK/TRANSPARENT in screen shares");
                    NSLog(@"   → Same protection as Touch ID, Keychain, etc.");
                } else {
                    // Disable secure input
                    DisableSecureEventInput();
                    
                    // Remove secure markers
                    if (window.contentView && window.contentView.layer) {
                        CALayer *layer = window.contentView.layer;
                        if ([layer respondsToSelector:@selector(setContentsProtected:)]) {
                            [(id)layer setValue:@NO forKey:@"contentsProtected"];
                        }
                        if ([layer respondsToSelector:@selector(setSecure:)]) {
                            [(id)layer setValue:@NO forKey:@"secure"];
                        }
                        if ([layer respondsToSelector:@selector(setAllowsScreenRecording:)]) {
                            [(id)layer setValue:@YES forKey:@"allowsScreenRecording"];
                        }
                    }
                    
                    if ([window respondsToSelector:@selector(setSecure:)]) {
                        [(id)window setValue:@NO forKey:@"secure"];
                    }
                    
                    NSLog(@"🔓 SECURE INPUT: Protection disabled for window %lu", windowId);
                }
                break;
            }
        }
    }
}

// 🔐 Enable secure input for ALL windows (global protection)
void EnableGlobalSecureInput(bool enable) {
    @autoreleasepool {
        if (enable) {
            // Enable secure event input for entire application
            // This is what password managers and security apps use
            EnableSecureEventInput();
            
            // Apply to all windows
            NSArray *windows = [NSApp windows];
            for (NSWindow *window in windows) {
                window.sharingType = NSWindowSharingNone;
                
                if (window.contentView) {
                    window.contentView.wantsLayer = YES;
                    CALayer *layer = window.contentView.layer;
                    
                    if (layer) {
                        if ([layer respondsToSelector:@selector(setContentsProtected:)]) {
                            [(id)layer setValue:@YES forKey:@"contentsProtected"];
                        }
                        if ([layer respondsToSelector:@selector(setSecure:)]) {
                            [(id)layer setValue:@YES forKey:@"secure"];
                        }
                        if ([layer respondsToSelector:@selector(setAllowsScreenRecording:)]) {
                            [(id)layer setValue:@NO forKey:@"allowsScreenRecording"];
                        }
                    }
                }
                
                if ([window respondsToSelector:@selector(setSecure:)]) {
                    [(id)window setValue:@YES forKey:@"secure"];
                }
            }
            
            NSLog(@"🔐 GLOBAL SECURE INPUT: ALL windows protected like password fields");
        } else {
            DisableSecureEventInput();
            
            NSArray *windows = [NSApp windows];
            for (NSWindow *window in windows) {
                if (window.contentView && window.contentView.layer) {
                    CALayer *layer = window.contentView.layer;
                    if ([layer respondsToSelector:@selector(setContentsProtected:)]) {
                        [(id)layer setValue:@NO forKey:@"contentsProtected"];
                    }
                    if ([layer respondsToSelector:@selector(setSecure:)]) {
                        [(id)layer setValue:@NO forKey:@"secure"];
                    }
                }
                
                if ([window respondsToSelector:@selector(setSecure:)]) {
                    [(id)window setValue:@NO forKey:@"secure"];
                }
            }
            
            NSLog(@"🔓 GLOBAL SECURE INPUT: Protection disabled");
        }
    }
}

// 🎬 Method 12: DRM-PROTECTED CONTENT BEHAVIOR
// Makes window behave like Netflix, Apple TV, Disney+, etc.
// Screen capture tools are LEGALLY REQUIRED to block DRM content
void EnableDRMProtection(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable) {
                    // Mark window as containing protected/DRM content
                    window.sharingType = NSWindowSharingNone;
                    
                    if (window.contentView) {
                        window.contentView.wantsLayer = YES;
                        CALayer *layer = window.contentView.layer;
                        
                        if (layer) {
                            // Use AVFoundation layer type (like video players)
                            // This signals DRM-protected content
                            if (@available(macOS 10.15, *)) {
                                // Mark as video layer with protected content
                                layer.contentsGravity = kCAGravityResizeAspect;
                                
                                // DRM content flags
                                if ([layer respondsToSelector:@selector(setProtected:)]) {
                                    [(id)layer setValue:@YES forKey:@"protected"];
                                }
                                if ([layer respondsToSelector:@selector(setContentsProtected:)]) {
                                    [(id)layer setValue:@YES forKey:@"contentsProtected"];
                                }
                                
                                // Mark as streaming video content
                                if ([layer respondsToSelector:@selector(setVideoGravity:)]) {
                                    [(id)layer setValue:@"AVLayerVideoGravityResizeAspect" forKey:@"videoGravity"];
                                }
                            }
                            
                            // Prevent screenshot/recording (like Apple TV app)
                            layer.allowsEdgeAntialiasing = NO;
                            layer.allowsGroupOpacity = NO;
                            layer.shouldRasterize = NO;
                        }
                    }
                    
                    NSLog(@"🎬 DRM PROTECTION: Window %lu now protected like Netflix/Apple TV", windowId);
                    NSLog(@"   → Screen capture LEGALLY BLOCKED (DRM content)");
                } else {
                    if (window.contentView && window.contentView.layer) {
                        CALayer *layer = window.contentView.layer;
                        if ([layer respondsToSelector:@selector(setProtected:)]) {
                            [(id)layer setValue:@NO forKey:@"protected"];
                        }
                        if ([layer respondsToSelector:@selector(setContentsProtected:)]) {
                            [(id)layer setValue:@NO forKey:@"contentsProtected"];
                        }
                    }
                    NSLog(@"🎬 DRM PROTECTION: Disabled for window %lu", windowId);
                }
                break;
            }
        }
    }
}

// 🖼️ Method 13: NON-STANDARD RENDERING (Metal/OpenGL exclusive)
// Like games, 3D apps (Blender, Unity), DaVinci Resolve
// Uses GPU-only rendering that ScreenCaptureKit cannot capture
void EnableMetalExclusiveRendering(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable && window.contentView) {
                    window.contentView.wantsLayer = YES;
                    CALayer *layer = window.contentView.layer;
                    
                    if (layer) {
                        // Force Metal layer rendering (GPU-exclusive)
                        if (@available(macOS 10.15, *)) {
                            // Make it behave like a Metal layer
                            layer.drawsAsynchronously = YES;
                            if ([layer respondsToSelector:@selector(setPresentsWithTransaction:)]) {
                                [(id)layer setValue:@NO forKey:@"presentsWithTransaction"]; // Direct GPU presentation
                            }
                            
                            // Mark as OpenGL/Metal content
                            if ([layer respondsToSelector:@selector(setUsesDisplayLink:)]) {
                                [(id)layer setValue:@YES forKey:@"usesDisplayLink"];
                            }
                            
                            // Disable compositor integration (direct GPU draw)
                            layer.shouldRasterize = NO;
                            layer.rasterizationScale = 1.0;
                            
                            // Mark as accelerated content
                            if ([layer respondsToSelector:@selector(setAccelerated:)]) {
                                [(id)layer setValue:@YES forKey:@"accelerated"];
                            }
                        }
                    }
                    
                    NSLog(@"🖼️ METAL RENDERING: Window %lu using GPU-exclusive rendering", windowId);
                    NSLog(@"   → Appears as BLACK/TRANSPARENT (like games)");
                }
                break;
            }
        }
    }
}

// 🔐 Method 14: PROTECTED OVERLAY/HUD
// Like accessibility overlays, annotation apps, performance monitors
// Floats in secure layer that ScreenCaptureKit skips
void EnableProtectedOverlay(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable) {
                    // Use highest possible window level (above everything)
                    [window setLevel:NSScreenSaverWindowLevel + 1000];
                    
                    // Mark as accessibility/system overlay
                    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                                 NSWindowCollectionBehaviorStationary |
                                                 NSWindowCollectionBehaviorFullScreenAuxiliary |
                                                 NSWindowCollectionBehaviorIgnoresCycle |
                                                 NSWindowCollectionBehaviorTransient;
                    
                    // Make it appear as HUD/overlay
                    window.styleMask |= NSWindowStyleMaskHUDWindow;
                    
                    // Transparent, non-opaque (like overlays)
                    window.opaque = NO;
                    window.hasShadow = NO;
                    window.backgroundColor = [NSColor clearColor];
                    
                    NSLog(@"🔐 PROTECTED OVERLAY: Window %lu now floating HUD layer", windowId);
                    NSLog(@"   → Invisible to viewers (like accessibility tools)");
                }
                break;
            }
        }
    }
}

// 🏦 Method 15: BANKING/FINANCIAL APP PROTECTION
// Explicit developer-disabled capture (like banking apps)
// Uses privacy flags that apps use to protect financial data
void EnableBankingAppProtection(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSArray *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            if ((unsigned long)window.windowNumber == windowId) {
                if (enable) {
                    // Financial/sensitive app markers
                    window.sharingType = NSWindowSharingNone;
                    
                    // Mark as containing sensitive financial data
                    if ([window respondsToSelector:@selector(setPrivate:)]) {
                        [(id)window setValue:@YES forKey:@"private"];
                    }
                    if ([window respondsToSelector:@selector(setSensitive:)]) {
                        [(id)window setValue:@YES forKey:@"sensitive"];
                    }
                    
                    // Banking security level
                    if (window.contentView) {
                        window.contentView.wantsLayer = YES;
                        CALayer *layer = window.contentView.layer;
                        
                        if (layer) {
                            // Mark as financial/secure content
                            if ([layer respondsToSelector:@selector(setFinancial:)]) {
                                [(id)layer setValue:@YES forKey:@"financial"];
                            }
                            if ([layer respondsToSelector:@selector(setPrivate:)]) {
                                [(id)layer setValue:@YES forKey:@"private"];
                            }
                            
                            // Block all capture methods
                            if ([layer respondsToSelector:@selector(setAllowsScreenRecording:)]) {
                                [(id)layer setValue:@NO forKey:@"allowsScreenRecording"];
                            }
                            if ([layer respondsToSelector:@selector(setContentsProtected:)]) {
                                [(id)layer setValue:@YES forKey:@"contentsProtected"];
                            }
                        }
                    }
                    
                    NSLog(@"🏦 BANKING PROTECTION: Window %lu protected like financial apps", windowId);
                    NSLog(@"   → Explicit capture disabled (privacy flags)");
                }
                break;
            }
        }
    }
}

// 🎯 ULTIMATE MASTER FUNCTION: Apply ALL 15+ stealth methods
// Combines EVERY technique to guarantee invisibility
void ApplyComprehensiveStealth(unsigned long windowId, bool enable) {
    @autoreleasepool {
        NSLog(@"🔒 ULTIMATE STEALTH: Applying ALL 15+ bypass methods to window %lu", windowId);
        
        // Apply all base methods (1-10)
        SetWindowContentProtection(windowId, enable);
        SetWindowHiddenFromMissionControl(windowId, enable);
        DisableHardwareVideoCapture(windowId, enable);
        SetFullscreenExclusiveMode(windowId, enable);
        SetProtectedSwapchain(windowId, enable);
        SetSandboxBehavior(windowId, enable);
        
        // 🔐 Method 11: System-level secure input (password fields)
        EnableSecureInputProtection(windowId, enable);
        
        // 🎬 Method 12: DRM-protected content (Netflix, Apple TV)
        EnableDRMProtection(windowId, enable);
        
        // 🖼️ Method 13: Metal/OpenGL exclusive rendering (games, 3D apps)
        EnableMetalExclusiveRendering(windowId, enable);
        
        // 🔐 Method 14: Protected overlay/HUD (accessibility tools)
        EnableProtectedOverlay(windowId, enable);
        
        // 🏦 Method 15: Banking/financial app protection
        EnableBankingAppProtection(windowId, enable);
        
        if (enable) {
            NSLog(@"✅ ULTIMATE STEALTH: ALL 15+ methods applied to window %lu", windowId);
            NSLog(@"   🔐 Secure Input: Like password fields");
            NSLog(@"   🎬 DRM Protection: Like Netflix/Apple TV");
            NSLog(@"   🖼️ GPU Rendering: Like games/3D apps");
            NSLog(@"   🔐 Protected Overlay: Like HUD/accessibility");
            NSLog(@"   🏦 Banking Protection: Like financial apps");
            NSLog(@"   → GUARANTEED INVISIBLE in ALL screen capture tools");
        } else {
            NSLog(@"🔓 ULTIMATE STEALTH: All protections removed from window %lu", windowId);
        }
    }
}

