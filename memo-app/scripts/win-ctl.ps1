# Test helper: enumerate / move / resize the app's windows and read the real cursor position.
# ASCII only (PS 5.1 reads .ps1 as ANSI without BOM).
param(
    [string]$Action = 'list',
    [int]$Hwnd = 0,
    [int]$X = 0,
    [int]$Y = 0,
    [int]$W = 0,
    [int]$H = 0,
    [string]$Proc = 'electron',
    [int]$X2 = 0,
    [int]$Y2 = 0
)
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class NTWin {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
'@
if (-not ('NTWin' -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }

function Get-AppWindows {
    $list = New-Object System.Collections.ArrayList
    $cb = [NTWin+EnumProc] {
        param($h, $l)
        if ([NTWin]::IsWindowVisible($h)) {
            $sb = New-Object System.Text.StringBuilder 512
            [void][NTWin]::GetWindowTextW($h, $sb, 512)
            $title = $sb.ToString()
            if ($title) {
                $pid2 = 0
                [void][NTWin]::GetWindowThreadProcessId($h, [ref]$pid2)
                $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
                if ($p -and $p.ProcessName -eq $Proc) {
                    $r = New-Object NTWin+RECT
                    [void][NTWin]::GetWindowRect($h, [ref]$r)
                    [void]$list.Add([pscustomobject]@{
                            Hwnd = [int64]$h; Title = $title
                            X = $r.Left; Y = $r.Top; W = $r.Right - $r.Left; H = $r.Bottom - $r.Top
                            PID = $pid2
                        })
                }
            }
        }
        return $true
    }
    [void][NTWin]::EnumWindows($cb, [IntPtr]::Zero)
    return $list
}

switch ($Action) {
    'list' { Get-AppWindows | Format-Table -AutoSize }
    'json' { Get-AppWindows | ConvertTo-Json -Compress }
    'move' {
        $ok = [NTWin]::MoveWindow([IntPtr]$Hwnd, $X, $Y, $W, $H, $true)
        "move hwnd=$Hwnd -> $X,$Y ${W}x${H} : $ok"
    }
    'foreground' { "fg: " + [NTWin]::SetForegroundWindow([IntPtr]$Hwnd) }
    'cursor' {
        $p = New-Object NTWin+POINT
        [void][NTWin]::GetCursorPos([ref]$p)
        "$($p.X),$($p.Y)"
    }
    'setcursor' {
        $ok = [NTWin]::SetCursorPos($X, $Y)
        Start-Sleep -Milliseconds 60
        $p = New-Object NTWin+POINT
        [void][NTWin]::GetCursorPos([ref]$p)
        "setcursor($X,$Y)=$ok now=$($p.X),$($p.Y)"
    }
    'click' {
        # real mouse click at screen coords (SetCursorPos + real button), like a human
        [void][NTWin]::SetCursorPos($X, $Y)
        Start-Sleep -Milliseconds 180
        [NTWin]::mouse_event([NTWin]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 80
        [NTWin]::mouse_event([NTWin]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 120
        "clicked $X,$Y"
    }
    'drag' {
        # drag with a REAL mouse button: SetCursorPos(sx,sy) -> LEFTDOWN -> move in steps -> LEFTUP
        [void][NTWin]::SetCursorPos($X, $Y)
        Start-Sleep -Milliseconds 150
        [NTWin]::mouse_event([NTWin]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 200
        $steps = 12
        for ($i = 1; $i -le $steps; $i++) {
            $nx = [int]($X + ($X2 - $X) * $i / $steps)
            $ny = [int]($Y + ($Y2 - $Y) * $i / $steps)
            [void][NTWin]::SetCursorPos($nx, $ny)
            Start-Sleep -Milliseconds 35
        }
        Start-Sleep -Milliseconds 200
        [NTWin]::mouse_event([NTWin]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 250
        "dragged $X,$Y -> $X2,$Y2"
    }
    default { "unknown action $Action" }
}
