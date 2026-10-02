const { spawn } = require('child_process');

const children = [
    spawn(process.execPath, ['admin-server.js'], { stdio: 'inherit', env: process.env }),
    spawn(process.execPath, ['linux-daemon.js'], { stdio: 'inherit', env: process.env })
];

let stopping = false;
function stop(signal = 'SIGTERM', exitCode = 0) {
    if (stopping) return;
    stopping = true;
    children.forEach((child) => {
        if (!child.killed) child.kill(signal);
    });
    setTimeout(() => process.exit(exitCode), 5000).unref();
}

children.forEach((child) => child.on('exit', (code, signal) => {
    if (!stopping) {
        console.error(`Containerprocess avslutades: kod ${code}, signal ${signal || 'ingen'}.`);
        stop('SIGTERM', code || 1);
    }
}));

process.on('SIGTERM', () => stop('SIGTERM', 0));
process.on('SIGINT', () => stop('SIGINT', 0));
