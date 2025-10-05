// run-applescript is ESM; load it via dynamic import from CommonJS
async function loadRunApplescript() {
    const mod = await import('run-applescript');
    return mod.default || mod;
}

// Try common macOS browsers in priority order and return active tab URL
async function getActiveUrl() {
    const runApplescript = await loadRunApplescript();
    const scripts = [
        {
            name: 'Google Chrome',
            script: `tell application "Google Chrome" to get URL of active tab of front window`
        },
        {
            name: 'Brave Browser',
            script: `tell application "Brave Browser" to get URL of active tab of front window`
        },
        {
            name: 'Microsoft Edge',
            script: `tell application "Microsoft Edge" to get URL of active tab of front window`
        },
        {
            name: 'Safari',
            script: `tell application "Safari" to get URL of current tab of front window`
        }
    ];

    for (const entry of scripts) {
        try {
            console.log(`Trying ${entry.name}...`);
            const result = await runApplescript(entry.script);
            const url = String(result || '').trim();
            console.log(`${entry.name} result:`, url);
            if (url && /^(https?:)\/\//i.test(url)) {
                console.log(`Found URL from ${entry.name}:`, url);
                return url;
            }
        } catch (err) {
            console.log(`${entry.name} failed:`, err.message);
        }
    }
    
    // Try a more robust approach for Safari
    try {
        console.log('Trying Safari fallback...');
        const safariScript = `
            tell application "Safari"
                if (count of windows) > 0 then
                    set frontWindow to front window
                    if (count of tabs of frontWindow) > 0 then
                        set currentTab to current tab of frontWindow
                        return URL of currentTab
                    end if
                end if
            end tell
        `;
        const result = await runApplescript(safariScript);
        const url = String(result || '').trim();
        if (url && /^(https?:)\/\//i.test(url)) {
            console.log(`Found URL from Safari fallback:`, url);
            return url;
        }
    } catch (err) {
        console.log('Safari fallback failed:', err.message);
    }
    
    console.log('No browser URL found');
    return null;
}

module.exports = { getActiveUrl };
module.exports.default = getActiveUrl;
