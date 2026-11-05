; Before 1.0.15 the app was called "Retocker Absolute" and was installed into its own folder.
; Remove that old copy quietly before installing, so there is one program, not two side by side.
; The settings and the Groq key stay: both versions keep them in the same place (com.retocker.absolute),
; and a silent uninstall does not delete them. The old uninstaller closes the old program itself.
!macro NSIS_HOOK_PREINSTALL
  Push $R9
  ReadRegStr $R9 HKCU "Software\Retocker\Retocker Absolute" ""
  ${If} $R9 != ""
  ${AndIf} ${FileExists} "$R9\uninstall.exe"
    ExecWait '"$R9\uninstall.exe" /S _?=$R9'
    Delete "$R9\uninstall.exe"
    RMDir "$R9"
  ${EndIf}
  Pop $R9
!macroend
