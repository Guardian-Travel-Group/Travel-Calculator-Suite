Travel Calculator Suite installer package

Install on Windows:
1. Extract this folder.
2. Right-click Install-TravelCalculatorSuite.ps1 and choose Run with PowerShell.
   If script execution is restricted, open PowerShell and run:
   powershell -ExecutionPolicy Bypass -File .\Install-TravelCalculatorSuite.ps1
3. Launch Travel Calculator Suite from the Start Menu.

The installer places the HTA under:
%LOCALAPPDATA%\Travel Calculator Suite

The application uses Windows mshta.exe and is intended for Windows. The responsive update:
- switches the two-column layout to one column below 760px;
- scales base text between 13px and 18px as the window width changes;
- keeps inputs, buttons, panels, and long result text inside their containers.

Uninstall:
Run Uninstall-TravelCalculatorSuite.ps1 with PowerShell.
