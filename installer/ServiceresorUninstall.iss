#define AppName "Serviceresor Live Tracking"
#define AppShortName "Serviceresor"

[Setup]
AppId={{B41A7D92-6C3E-4F0A-8E2B-9D5C1F7A3E60}
AppName={#AppName}
AppVersion=1.1.0
AppPublisher=Serviceresor
DefaultDirName={autopf}\ServiceresorUninstall
CreateAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=yes
DisableReadyPage=yes
Uninstallable=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=Output
OutputBaseFilename={#AppShortName}Uninstall
SetupIconFile=app.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "uninstall-cleanup.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\uninstall-cleanup.ps1"" -AppFolder ""{param:DIR|}"""; StatusMsg: "Tar bort Serviceresor..."; Flags: waituntilterminated

[Code]
function InitializeSetup(): Boolean;
begin
  Result := MsgBox('Detta tar bort Serviceresor-tjänsten från datorn:' + #13#10 +
    '- schemalagda uppgifter' + #13#10 +
    '- pågående processer' + #13#10 +
    '- autostart och tray-app' + #13#10 +
    '- installerade mappar i %LOCALAPPDATA%' + #13#10#13#10 +
    'Skicka med /DIR="sökväg" för att även radera appmappen.' + #13#10#13#10 +
    'Fortsätta?', mbConfirmation, MB_YESNO) = IDYES;
end;
