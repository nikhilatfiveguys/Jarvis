// Add this to your main.js to enable file logging
// This will write all errors to a log file you can read

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Create logs directory
const logsDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const logFile = path.join(logsDir, `jarvis-${Date.now()}.log`);

// Override console.log, console.error, etc.
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = function(...args) {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : a).join(' ');
    fs.appendFileSync(logFile, `[LOG] ${new Date().toISOString()} - ${message}\n`);
    originalLog.apply(console, args);
};

console.error = function(...args) {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : a).join(' ');
    fs.appendFileSync(logFile, `[ERROR] ${new Date().toISOString()} - ${message}\n`);
    originalError.apply(console, args);
};

console.warn = function(...args) {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : a).join(' ');
    fs.appendFileSync(logFile, `[WARN] ${new Date().toISOString()} - ${message}\n`);
    originalWarn.apply(console, args);
};

console.log(`📝 Logging to: ${logFile}`);

module.exports = { logFile };


