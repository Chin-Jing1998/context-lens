!include "WinVer.nsh"
!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Context Lens requires Windows 10 or later (64-bit)."
    Quit
  ${EndIf}
!macroend
