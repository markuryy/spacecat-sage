#define MyAppName "spacecat sage"
#define MyAppVersion "0.0.0"  ; Will be replaced during build

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={pf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputBaseFilename=spacecat_sage_installer
SetupIconFile=src-pyloid\icons\icon.ico

[Files]
Source: "dist\spacecat sage\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\spacecat sage.exe"