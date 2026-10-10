; Inno Setup script for the Windows installer (built by .github/workflows/release.yml).
; Per-user install: no admin rights, no UAC prompt.
#ifndef AppVersion
  #define AppVersion "dev"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\DW2003"
#endif

[Setup]
AppId={{6F1D2B47-2003-4D57-9B1E-D1A2003C0DE5}
AppName=Digimon World 2003 (browser recreation)
AppVersion={#AppVersion}
AppPublisher=dw2003-play-code
AppPublisherURL=https://github.com/dorijantomic/dw2003-play-code
DefaultDirName={localappdata}\Programs\DW2003
DefaultGroupName=Digimon World 2003
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=DW2003-Setup-windows-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=Digimon World 2003 (browser recreation)

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Digimon World 2003"; Filename: "{app}\runtime\python\python.exe"; Parameters: """{app}\app\launcher\dw2003.py"""; WorkingDir: "{app}"; Comment: "Play Digimon World 2003"
Name: "{userdesktop}\Digimon World 2003"; Filename: "{app}\runtime\python\python.exe"; Parameters: """{app}\app\launcher\dw2003.py"""; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Run]
Filename: "{app}\runtime\python\python.exe"; Parameters: """{app}\app\launcher\dw2003.py"""; WorkingDir: "{app}"; Description: "Start Digimon World 2003 now"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
; The game built from your disc (~6 GB). Browser save data is not stored here.
Type: filesandordirs; Name: "{localappdata}\DW2003"
Type: filesandordirs; Name: "{app}"
