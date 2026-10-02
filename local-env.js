const fs = require('fs');
const path = require('path');

function loadLocalEnvironment(rootDirectory) {
    const file = path.join(rootDirectory, '.env.local.json');
    if (!fs.existsSync(file)) return;

    const values = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'string' && value && !process.env[name]) {
            process.env[name] = value;
        }
    }
}

module.exports = { loadLocalEnvironment };
