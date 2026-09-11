# Serviceresor Live Tracking

This project reads configured Serviceresor trips once per day and creates a separate, encrypted map session for each trip. A tracking URL is sent by SMS shortly before departure and the temporary map is deleted automatically after 60 minutes.

## Requirements

- Windows 10 or later
- Node.js LTS
- Google Chrome
- Git for Windows and `jq`
- A here.now API key
- A 46elks account with SMS enabled

## Local setup

```powershell
npm install
npx skills add heredotnow/skill --skill here-now -g
Copy-Item .\users.example.json .\users.local.json
```

Edit `users.local.json` with the users' Serviceresor credentials and SMS recipients. Keep this file private. It is ignored by Git.

Set the 46elks credentials for the Windows user that runs the scheduled task:

```powershell
[Environment]::SetEnvironmentVariable('ELKS_API_USERNAME', 'YOUR_USERNAME', 'User')
[Environment]::SetEnvironmentVariable('ELKS_API_PASSWORD', 'YOUR_PASSWORD', 'User')
```

Set `HERENOW_API_KEY` as a user environment variable or store it in `%USERPROFILE%\\.herenow\\credentials`.

The publisher path is machine-specific. Set these variables on each computer:

```powershell
[Environment]::SetEnvironmentVariable('HERENOW_PUBLISH_SCRIPT', 'C:\path\to\publish.sh', 'User')
[Environment]::SetEnvironmentVariable('GIT_BASH_PATH', 'C:\Program Files\Git\bin\bash.exe', 'User')
```

## Schedule

Run `.\install-scheduled-task.ps1` once from PowerShell. It registers `Serviceresor daily planner` for 01:00. The task must run as the configured Windows user and have access to the user environment variables.

The planner reads all trips under `Idag`, creates one task per user and trip, and starts each tracker ten minutes before departure. Tracking ends 90 minutes after departure or when the 60-minute session URL lifetime expires, whichever comes first.

## Security

Never commit `users.local.json`, `.herenow/`, logs, screenshots, API keys, or SMS credentials. Rotate any credentials that have been exposed in chat, terminals, logs, or version control.
