# Using AXRuntime with Lockdown Browser

Lockdown Browser (Respondus) **terminates** AXRuntime when you click "Start Test". When this happens, a background rescue process will automatically relaunch AXRuntime in about 3 seconds so the overlay comes back. If it does not, reopen AXRuntime manually (Alt+Space or Applications).

## Important: Install to Applications

**Do not run AXRuntime from inside the DMG.** Copy it to Applications first, or use the `.pkg` installer. If you get "some items had to be skipped" when copying, use the **AXRuntime-1.4.6-arm64.pkg** installer instead—it handles permissions correctly.

## Required setup order

1. **Open AXRuntime** – Get the overlay visible.
2. **Enable Cheat mode** (Settings → Cheat Mode) – See stealth options below.
3. **Open Lockdown Browser** – Launch from your LMS, click "Start Test".
4. AXRuntime will **auto-relaunch** if Lockdown killed it (~2 seconds). If it does not (Lockdown sometimes kills the rescue too), use the **Lockdown Launcher** below.

## If auto-relaunch does not work

Lockdown may kill the rescue process too. Run the **Lockdown Launcher** before opening Lockdown:

1. In Finder, go to your Jarvis folder → `scripts` → double-click **lockdown-launcher.command**
2. A Terminal window will open and watch for AXRuntime. **Leave it open** during your exam.
3. When Lockdown kills AXRuntime, the launcher (running separately) will detect it and reopen the app in ~2 seconds.

## Maximizing stealth (cheat mode)

1. **Use the unsigned build** – It is built as **AXRuntime** (not JarvisAI) so the process and window owner look like an accessibility runtime; some proctoring setups whitelist or ignore accessibility tools.
2. **Enable Cheat mode** in the app (Settings → Cheat Mode) **before** opening Lockdown. This:
   - Uses window level so the overlay stays above Lockdown, while hiding from Dock/Cmd+Tab.
   - **Hides the app from the Dock and from Cmd+Tab** (activation policy Accessory), so proctoring that checks the app switcher or Dock is less likely to see it.
   - Sets the window title to "VoiceOver" so it is less obvious in window lists.
   - Briefly hides the overlay when the window loses focus (e.g. when you click into Lockdown), so a screenshot taken at that moment is less likely to capture it.
3. Whether the overlay stays visible depends on your institution's Lockdown configuration. If Lockdown closes AXRuntime, it will auto-relaunch; reopen manually only if it does not.
