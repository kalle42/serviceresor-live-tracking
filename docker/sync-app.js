#!/usr/bin/env node
// Kopierar de fungerande appfilerna från repo-roten till docker/app så att
// Docker-versionen blir en självständig kopia utan att röra Windows-versionen.
//
// Kör: node docker/sync-app.js
//
// admin-server.js kopieras bara om kopian saknas: den är anpassad för Docker
// (se docker/README.md) och får inte skrivas över av en synkning.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DOCKER_DIR = __dirname;
const ROOT = path.resolve(DOCKER_DIR, '..');
const APP_DIR = path.join(DOCKER_DIR, 'app');

// Filer som behövs av appen i behållaren och som inte ändrats för Linux.
const COPIES = [
    'tracking-service.js',
    'local-env.js',
    'package.json',
    'package-lock.json',
    'users.example.json',
    '.env.example.json',
    'session-map/app.js',
    'session-map/index.html',
    'session-map/styles.css',
    'session-map/.herenow/data.json',
    'admin-dashboard/app.js',
    'admin-dashboard/index.html',
    'admin-dashboard/settings.html',
    'admin-dashboard/users.html',
    'admin-dashboard/styles.css',
    'tools/sha256sum'
];

// Här ligger publish.sh i Windows-versionen (bundlad med installationsprogrammet).
const SPECIAL_COPIES = [
    { from: 'installer/here-now/scripts/publish.sh', to: 'here-now/scripts/publish.sh' }
];

// Kopieras bara om målet saknas: ändrad kopia som förvald version.
const ADAPTED = ['admin-server.js'];

function copyOne(from, to) {
    const target = path.join(APP_DIR, to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, from), target);
    return target;
}

function checkSyntax(file) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`Syntaxfel i ${file}:\n${result.stderr}`);
    }
}

fs.mkdirSync(APP_DIR, { recursive: true });

let copied = 0;
for (const relative of [...COPIES, ...SPECIAL_COPIES.map((entry) => entry.from)]) {
    const to = SPECIAL_COPIES.find((entry) => entry.from === relative)?.to || relative;
    copyOne(relative, to);
    copied += 1;
    console.log(`Kopierad: ${relative} -> app/${to}`);
}

for (const relative of ADAPTED) {
    const target = path.join(APP_DIR, relative);
    if (fs.existsSync(target)) {
        console.log(`Behållen (anpassad): app/${relative}`);
    } else {
        copyOne(relative, relative);
        copied += 1;
        console.log(`Kopierad (första gången, anpassa nu): app/${relative}`);
    }
}

// Säkerställ att ingen kopierad fil förstörts av radslut eller teckenkodning.
for (const file of fs.readdirSync(APP_DIR)) {
    if (file.endsWith('.js')) checkSyntax(path.join(APP_DIR, file));
}
checkSyntax(path.join(APP_DIR, 'session-map', 'app.js'));
checkSyntax(path.join(APP_DIR, 'admin-dashboard', 'app.js'));

console.log(`\nKlart: ${copied} fil(er) synkroniserade till docker/app.`);
