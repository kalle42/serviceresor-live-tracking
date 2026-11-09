#define AppName "Serviceresor Live Tracking"
#define AppShortName "Serviceresor"
#define AppVersion "1.3.0"
#define AppPublisher "Serviceresor"
#define ProjectRoot ".."

[Setup]
AppId={{7C4F2A61-2E9D-4B3A-9F5C-1D6E8B0A2C47}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\{#AppShortName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=Output
OutputBaseFilename={#AppShortName}Setup
SetupIconFile=app.ico
UninstallDisplayIcon={app}\app.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
Uninstallable=yes

[Languages]
Name: "swedish"; MessagesFile: "compiler:Languages\Swedish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#ProjectRoot}\tracking-service.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\admin-server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\local-env.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\.env.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\users.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\run-*.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\find-node.ps1"; DestDir: "{app}"; Flags: ignoreversion
; Uppgiftsåtgärder startas via denna för att inte visa något konsolfönster.
Source: "{#ProjectRoot}\run-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\install-*.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\setup-*.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\uninstall-app.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\admin-dashboard\*"; DestDir: "{app}\admin-dashboard"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ProjectRoot}\session-map\*"; DestDir: "{app}\session-map"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".herenow\*"
; Site Data-manifestet måste ingå, annars saknar kartan sin positionskollektion.
Source: "{#ProjectRoot}\session-map\.herenow\data.json"; DestDir: "{app}\session-map\.herenow"; Flags: ignoreversion
Source: "{#ProjectRoot}\live-map\*"; DestDir: "{app}\live-map"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#ProjectRoot}\tools\*"; DestDir: "{app}\tools"; Flags: ignoreversion recursesubdirs createallsubdirs
; here.now-skillen följer med, så publiceringen inte beror på vad som råkar vara
; installerat på maskinen. jq.exe hämtas vid bygget och ingår i paketet.
Source: "{#ProjectRoot}\installer\here-now\*"; DestDir: "{app}\here-now"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ProjectRoot}\tray\*"; DestDir: "{app}\tray"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "bin\*,obj\*"
Source: "{#ProjectRoot}\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "app.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Serviceresor Driftcentral"; Filename: "http://127.0.0.1:8787"; IconFilename: "{app}\app.ico"; Comment: "Öppna den lokala adminpanelen"
Name: "{autoprograms}\Avinstallera Serviceresor"; Filename: "{uninstallexe}"

[Run]
Filename: "http://127.0.0.1:8787"; Description: "Öppna adminpanelen"; Flags: postinstall shellexec nowait skipifsilent unchecked

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-app.ps1"""; Flags: runhidden; RunOnceId: "CleanupApp"

[UninstallDelete]
Type: files; Name: "{app}\.env.local.json"
Type: files; Name: "{app}\users.local.json"
Type: files; Name: "{app}\todays-trips.json"
Type: files; Name: "{app}\*.log"
Type: filesandordirs; Name: "{app}\session-runtime"
Type: filesandordirs; Name: "{localappdata}\Serviceresor"

[Code]
var
  AdminPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  AdminPage := CreateInputQueryPage(wpSelectDir,
    'Adminlösenord', 'Lösenord till adminpanelen',
    'Ange det lösenord som ska användas för adminpanelen på http://127.0.0.1:8787.' + #13#10#13#10 +
    'Minst 12 tecken. Det sparas lokalt för Windows-användaren.');
  AdminPage.Add('Lösenord:', True);
  AdminPage.Add('Upprepa lösenordet:', True);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Pw: String;
begin
  Result := True;
  if CurPageID <> AdminPage.ID then
    Exit;
  Pw := AdminPage.Values[0];
  if Pw <> AdminPage.Values[1] then
  begin
    MsgBox('Lösenorden matchar inte. Försök igen.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if Length(Pw) < 12 then
  begin
    MsgBox('Lösenordet måste ha minst 12 tecken.', mbError, MB_OK);
    Result := False;
  end;
end;

function RunCheck(const Exe, Args: string): Boolean;
var
  Code: Integer;
begin
  Result := Exec(Exe, Args, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

function HasNode(): Boolean;
begin
  Result := FileExists('C:\Program Files\nodejs\node.exe');
end;

function HasGit(): Boolean;
begin
  Result := FileExists('C:\Program Files\Git\bin\git.exe')
    or FileExists('C:\Program Files (x86)\Git\bin\git.exe')
    or RunCheck('git.exe', '--version');
end;

function HasDotnet(): Boolean;
begin
  Result := FileExists('C:\Program Files\dotnet\dotnet.exe')
    or RunCheck('dotnet.exe', '--version');
end;

function HasChrome(): Boolean;
begin
  Result := FileExists('C:\Program Files\Google\Chrome\Application\chrome.exe')
    or FileExists('C:\Program Files (x86)\Google\Chrome\Application\chrome.exe');
end;

function WingetPath(): string;
begin
  if RunCheck('winget.exe', '--version') then
    Result := 'winget.exe'
  else if FileExists(ExpandConstant('{localappdata}\Microsoft\WindowsApps\winget.exe')) then
    Result := ExpandConstant('{localappdata}\Microsoft\WindowsApps\winget.exe')
  else
    Result := '';
end;

function RunWinget(const Winget, Id: string): Boolean;
var
  Code: Integer;
begin
  Result := Exec(Winget,
    'install -e --id ' + Id + ' --silent --accept-package-agreements --accept-source-agreements',
    '', SW_SHOWNORMAL, ewWaitUntilTerminated, Code) and (Code = 0);
end;

function MissingList(): string;
begin
  Result := '';
  if not HasNode() then Result := Result + '- Node.js LTS' + #13#10;
  if not HasGit() then Result := Result + '- Git for Windows' + #13#10;
  if not HasDotnet() then Result := Result + '- .NET 8 SDK' + #13#10;
  if not HasChrome() then Result := Result + '- Google Chrome' + #13#10;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Winget, Missing: string;
begin
  Result := '';
  Missing := MissingList();
  if Missing = '' then Exit;

  Winget := WingetPath();
  if Winget = '' then
  begin
    if MsgBox('Följande förutsättningar saknas:' + #13#10#13#10 + Missing + #13#10 +
      'winget hittades inte, så de kan inte installeras automatiskt.' + #13#10 +
      'Installera dem manuellt och kör installationsprogrammet igen.' + #13#10#13#10 +
      'Vill du fortsätta ändå?', mbConfirmation, MB_YESNO) = IDNO then
      Result := 'Installationen avbröts av användaren.';
    Exit;
  end;

  if MsgBox('Följande förutsättningar saknas:' + #13#10#13#10 + Missing + #13#10 +
    'Installera dem automatiskt med winget nu?' + #13#10 +
    '(Datorn måste vara uppkopplad mot internet.)', mbConfirmation, MB_YESNO) = IDNO then
    Exit;

  if not HasNode() then RunWinget(Winget, 'OpenJS.NodeJS.LTS');
  if not HasGit() then RunWinget(Winget, 'Git.Git');
  if not HasDotnet() then RunWinget(Winget, 'Microsoft.DotNet.SDK.8');
  if not HasChrome() then RunWinget(Winget, 'Google.Chrome');
  // jq installeras inte längre via winget: here-now\bin\jq.exe följer med paketet
  // och används av publish.sh, som letar efter just den sökvägen.

  if not FileExists('C:\Program Files\nodejs\node.exe') then
    if MsgBox('Node.js verkar fortfarande saknas i C:\Program Files\nodejs.' + #13#10 +
      'Installera Node.js LTS manuellt och kör installationsprogrammet igen.' + #13#10#13#10 +
      'Vill du fortsätta ändå?', mbConfirmation, MB_YESNO) = IDNO then
      Result := 'Installationen avbröts: Node.js saknas i C:\Program Files\nodejs.';
end;

function RunSetupApp(): Integer;
var
  Cmd, Pw, PwFile, EscapedPwFile: string;
  Code: Integer;
begin
  // Lösenordet lämnas via en tillfällig fil som läses in i samma PowerShell-
  // process: det hamnar aldrig på kommandoraden (där det vore synligt för
  // andra processer) och tål alla specialtecken. /ADMINPASSWORD="..." kan
  // användas vid tysta installationer.
  Pw := ExpandConstant('{param:AdminPassword|}');
  if Pw = '' then
    Pw := AdminPage.Values[0];
  PwFile := ExpandConstant('{tmp}\admin-password.txt');
  Cmd := '-NoProfile -ExecutionPolicy Bypass -Command "$env:Path=' +
    '[Environment]::GetEnvironmentVariable(''Path'',''Machine'')+'';''+' +
    '[Environment]::GetEnvironmentVariable(''Path'',''User''); ';
  if Pw <> '' then
  begin
    SaveStringToFile(PwFile, Pw, False);
    EscapedPwFile := PwFile;
    StringChangeEx(EscapedPwFile, '''', '''''', True);
    Cmd := Cmd + '$env:ADMIN_DASHBOARD_PASSWORD=(Get-Content -Raw ''' + EscapedPwFile + '''); ';
  end;
  Cmd := Cmd + '& ''' + ExpandConstant('{app}\setup-app.ps1') + '''"';
  if not Exec('powershell.exe', Cmd, ExpandConstant('{app}'), SW_SHOWNORMAL, ewWaitUntilTerminated, Code) then
    Code := -1;
  DeleteFile(PwFile);
  Result := Code;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    if RunSetupApp() <> 0 then
      MsgBox('Kunde inte slutföra konfigurationen (setup-app.ps1).' + #13#10 +
        'Kontrollera att förutsättningarna är installerade och kör installationsprogrammet igen.',
        mbError, MB_OK);
end;
