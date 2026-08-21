' Isekai in the year of our lord 825
' Double-click this file to play. The command window stays hidden after the first install.

Option Explicit
Dim sh, fso, dir, bat, windowStyle, wait
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
bat = dir & "\Isekai.bat"
sh.CurrentDirectory = dir

If Not fso.FileExists(bat) Then
  MsgBox "Isekai.bat is missing. Keep this file next to Isekai.bat.", 16, "Isekai in the year of our lord 825"
  WScript.Quit 1
End If

If Not fso.FolderExists(dir & "\node_modules") Then
  windowStyle = 1
  wait = True
Else
  windowStyle = 0
  wait = False
End If

sh.Run """" & bat & """", windowStyle, wait
