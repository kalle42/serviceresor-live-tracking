const fs = require('fs');
const os = require('os');
const path = require('path');

function loadLocalEnvironment(rootDirectory) {
    const file = path.join(rootDirectory, '.env.local.json');
    if (!fs.existsSync(file)) return;

    const values = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'string' && value && !process.env[name]) {
            process.env[name] = value;
        }
    }
}

// Skillen installeras på olika ställen beroende på klient (opencode, Claude Code,
// npx). Sökvägen ska inte behöva konfigureras för hand, så leta på samma ställen
// som setup-app.ps1 gjorde och ta den första som finns.
// Ordningen spelar roll: den medföljande kopian kommer först. Installationsprogrammet
// lägger den i appmappen, så en maskin utan here.now-skillen fungerar ändå, och
// versionen som testats följer med i stället för att bero på vad som råkar finnas.
function publishScriptCandidates() {
    const bundled = path.join(__dirname, 'here-now', 'scripts', 'publish.sh');
    return [
        bundled,
        path.join(os.homedir(), '.agents', 'skills', 'here-now', 'scripts', 'publish.sh'),
        path.join(os.homedir(), '.claude', 'skills', 'here-now', 'scripts', 'publish.sh'),
        path.join(os.homedir(), '.config', 'opencode', 'skills', 'here-now', 'scripts', 'publish.sh')
    ];
}

function resolvePublishScript() {
    // Den medföljande kopian går före allt annat. En gammal sökväg i .env.local.json
    // ska inte kunna peka på en skill som uppdaterats eller tagits bort.
    const candidates = publishScriptCandidates();
    if (process.env.HERENOW_PUBLISH_SCRIPT) candidates.push(process.env.HERENOW_PUBLISH_SCRIPT);
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
        throw new Error(
            'publish.sh hittades inte. Installera here.now-skillen: ' +
            'npx --yes skills add heredotnow/skill --skill here-now -g'
        );
    }
    return found;
}

// Git Bash installeras på olika ställen beroende på 64/32-bitarsversion och
// installationsval. publish.sh kräver bash, så leta upp den i stället för att
// kräva en konfigurerad sökväg.
const GIT_BASH_CANDIDATES = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.ProgramW6432 || '', 'Git', 'bin', 'bash.exe')
].filter(Boolean);

function resolveGitBash() {
    const configured = process.env.GIT_BASH_PATH;
    if (configured && fs.existsSync(configured)) return configured;
    const found = GIT_BASH_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    if (!found) {
        throw new Error('Git Bash hittades inte. Installera Git for Windows: https://git-scm.com/download/win');
    }
    return found;
}

// Chrome installeras antingen maskinbrett eller per användare, och 32-bitarsversionen
// har en egen sökväg. puppeteer-core har ingen egen webbläsare, så en felaktig
// sökväg får varje resa att fallera. Leta i alla kända lägen.
function chromeCandidates() {
    return [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.ProgramW6432 || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter((candidate) => candidate && !candidate.startsWith('\\'));
}

function resolveChrome() {
    const configured = process.env.CHROME_PATH;
    if (configured && fs.existsSync(configured)) return configured;
    const found = chromeCandidates().find((candidate) => fs.existsSync(candidate));
    if (!found) {
        throw new Error('Google Chrome hittades inte. Installera Chrome: https://www.google.com/chrome/');
    }
    return found;
}

module.exports = { loadLocalEnvironment, resolvePublishScript, resolveGitBash, resolveChrome };
