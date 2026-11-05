; Up to 1.0.14 the app was called "Retocker Absolute" and was installed into its own folder.
; Remove that old copy quietly before installing, so there is one program, not two side by side.
; The settings and the Groq key stay: both versions keep them in the same place (com.retocker.absolute),
; and a silent uninstall does not delete them. The old uninstaller closes the old program itself.
; It also deletes the old autostart entry, so when autostart was on it is turned on again under the new name.
!macro NSIS_HOOK_PREINSTALL
  Push $R9
  Push $R8
  ReadRegStr $R9 HKCU "Software\Retocker\Retocker Absolute" ""
  ${If} $R9 != ""
  ${AndIf} ${FileExists} "$R9\uninstall.exe"
    ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Retocker Absolute"
    ExecWait '"$R9\uninstall.exe" /S _?=$R9'
    Delete "$R9\uninstall.exe"
    RMDir "$R9"
    DeleteRegKey HKCU "Software\Retocker\Retocker Absolute"
    ${If} $R8 != ""
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Retocker Voice" '"$INSTDIR\${MAINBINARYNAME}.exe" --autostart'
    ${EndIf}
  ${EndIf}
  Pop $R8
  Pop $R9
!macroend
