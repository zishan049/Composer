; ─────────────────────────────────────────────
; Composer – NSIS installer hooks
; ─────────────────────────────────────────────
; This file is referenced from tauri.conf.json → bundle.windows.nsis.installerHooks
; and supplies macros that Tauri's generated installer.nsi will !insertmacro into
; the appropriate sections.

; Hook: runs AFTER standard uninstall logic has finished.
; At this point $DeleteAppDataCheckboxState is 1 when the user ticked
; "Remove user data" in the uninstaller, and $UpdateMode is 1 during
; a silent update-uninstall (where we must NOT delete user data).
!macro NSIS_HOOK_POSTUNINSTALL
  ; Only delete user data when user opted-in and this is NOT an update
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; 1. Config directory:  %APPDATA%\Composer  (config.json, workspace/, storage/)
    SetShellVarContext current
    RMDir /r "$APPDATA\Composer"

    ; 2. Cache directory inside the install folder:  <install_dir>\Cache
    RMDir /r "$INSTDIR\Cache"

    ; 3. Canonical config.json next to the exe:  <install_dir>\config.json
    Delete "$INSTDIR\config.json"

    ; 4. Legacy storage directory next to the exe:  <install_dir>\storage
    RMDir /r "$INSTDIR\storage"

    ; 5. Clean up install directory if now empty (may already be removed by Tauri)
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
