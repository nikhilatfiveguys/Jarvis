import runApplescript from 'run-applescript';

// Try common macOS browsers in priority order and return active tab URL
export async function getActiveUrl(): Promise<string | null> {
    const scripts: Array<{ name: string; script: string }> = [
        {
            name: 'Google Chrome',
            script: `
                tell application "Google Chrome"
                    if (exists window 1) then
                        set theWin to window 1
                        if (exists active tab of theWin) then
                            return URL of active tab of theWin
                        end if
                    end if
                end tell
            `
        },
        {
            name: 'Brave Browser',
            script: `
                tell application "Brave Browser"
                    if (exists window 1) then
                        set theWin to window 1
                        if (exists active tab of theWin) then
                            return URL of active tab of theWin
                        end if
                    end if
                end tell
            `
        },
        {
            name: 'Microsoft Edge',
            script: `
                tell application "Microsoft Edge"
                    if (exists window 1) then
                        set theWin to window 1
                        if (exists active tab of theWin) then
                            return URL of active tab of theWin
                        end if
                    end if
                end tell
            `
        },
        {
            name: 'Safari',
            script: `
                tell application "Safari"
                    if (exists front window) then
                        try
                            return URL of current tab of front window
                        on error
                            if (exists document 1) then
                                return URL of document 1
                            end if
                        end try
                    end if
                end tell
            `
        }
    ];

    for (const entry of scripts) {
        try {
            const result = await runApplescript(entry.script);
            const url = String(result || '').trim();
            if (url && /^(https?:)\/\//i.test(url)) {
                return url;
            }
        } catch (_) {
            // Ignore and try next browser
        }
    }
    return null;
}

export default getActiveUrl;


