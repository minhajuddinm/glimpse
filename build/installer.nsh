; electron-builder keeps a full copy of the installer in %LOCALAPPDATA%\glimpse-updater for
; auto-update. Glimpse does not auto-update yet, so drop it: it is ~300 MB on the Windows drive.
!macro customInstall
  SetShellVarContext current
  RMDir /r "$LOCALAPPDATA\glimpse-updater"
!macroend
