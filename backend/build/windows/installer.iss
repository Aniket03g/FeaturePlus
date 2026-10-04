; FeaturePlus installer, for Inno Setup 6.
;
; Build the executable first:
;     .\build\build-desktop.ps1
; then compile this:
;     & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" build\windows\installer.iss
;
; The result is build\dist\FeaturePlus-Setup-<version>.exe.

#define AppName "FeaturePlus"
#define AppVersion "0.1.0"
#define AppPublisher "FeaturePlus"
#define AppExeName "FeaturePlus.exe"

[Setup]
AppId={{7C4B2E19-3F58-4A6D-9B21-8E5A0D4C7F13}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
VersionInfoVersion={#AppVersion}

; Per-user by default, so installing needs no administrator prompt. The
; application writes only to the per-user data directory and binds a loopback
; port, so it has no reason to be installed for the whole machine.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes

OutputDir=..\dist
OutputBaseFilename=FeaturePlus-Setup-{#AppVersion}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#AppExeName}

Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

; The webview the window draws in is 64-bit only.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\bin\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

; The template catalogue ships beside the application and is read, never
; written — saved analyses and the database go to the per-user data directory
; instead, which is why only this one is installed here.
Source: "..\..\data\templates.json"; DestDir: "{app}\data"; Flags: ignoreversion
Source: "..\..\data\guidance.json"; DestDir: "{app}\data"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Start {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The logs are ours and go with the application. The database is the user's
; work and is deliberately left behind — uninstalling a planning tool should
; not silently destroy the plans.
Type: filesandordirs; Name: "{app}\logs"

[Code]
{
  WebView2 is what the window is drawn in. It ships with Windows 11 and with
  recent Windows 10, but not with every machine, and without it the app opens
  an empty frame — which looks like a broken application rather than a missing
  component. Check before installing and say so plainly.
}
function WebView2Installed(): Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;

  if not WebView2Installed() then
  begin
    if MsgBox(
      'FeaturePlus needs the Microsoft Edge WebView2 runtime, which is not installed on this computer.' + #13#10#13#10 +
      'Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and run this installer again.' + #13#10#13#10 +
      'Continue anyway?',
      mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
    end;
  end;
end;
