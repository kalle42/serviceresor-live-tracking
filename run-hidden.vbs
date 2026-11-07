' Runs a command line with no visible window (window style 0) and waits
' for it, so the scheduled task reflects the real run state.
' Usage: wscript.exe run-hidden.vbs "<full command line>"
If WScript.Arguments.Count < 1 Then WScript.Quit 1
CreateObject("WScript.Shell").Run WScript.Arguments(0), 0, True
