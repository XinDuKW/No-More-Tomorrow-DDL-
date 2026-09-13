# Build app icons: assets/icon.png (256), assets/tray.png (32), build/icon.ico (multi-size BMP entries).
# Pure System.Drawing - no third-party dependency. ASCII only on purpose (PS 5.1 reads .ps1 as ANSI without a BOM).
param(
    [string]$AssetsDir = (Join-Path $PSScriptRoot '..\assets'),
    [string]$BuildDir  = (Join-Path $PSScriptRoot '..\build')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $AssetsDir, $BuildDir | Out-Null

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($r -le 0) { $r = 0.01 }
    $d = $r * 2
    if ($d -gt $w) { $d = $w }
    if ($d -gt $h) { $d = $h }
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 256.0

    # blue rounded square = the sticky note
    $pad = 6 * $s
    $inner = $size - 2 * $pad
    $bg = New-RoundedPath $pad $pad $inner $inner (54 * $s)
    $bgRect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $bgRect,
        [System.Drawing.Color]::FromArgb(255, 88, 176, 255),
        [System.Drawing.Color]::FromArgb(255, 11, 96, 200),
        45.0)
    $g.FillPath($brush, $bg)
    $brush.Dispose()

    # top gloss
    $half = $inner * 0.46
    $gloss = New-RoundedPath $pad $pad $inner $half (50 * $s)
    $glossRect = New-Object System.Drawing.RectangleF(0, 0, $size, ($size * 0.55))
    $gb = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $glossRect,
        [System.Drawing.Color]::FromArgb(70, 255, 255, 255),
        [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
        90.0)
    $g.FillPath($gb, $gloss)
    $gb.Dispose()

    # three white checklist bars
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 255, 255, 255))
    $bars = @(
        @(66, 74, 124, 22),
        @(66, 117, 124, 22),
        @(66, 160, 74, 22)
    )
    foreach ($b in $bars) {
        $path = New-RoundedPath ($b[0] * $s) ($b[1] * $s) ($b[2] * $s) ($b[3] * $s) (11 * $s)
        $g.FillPath($white, $path)
        $path.Dispose()
    }
    $white.Dispose()
    $g.Dispose()
    return $bmp
}

# ---- PNG ----
$iconPath = Join-Path $AssetsDir 'icon.png'
$b256 = New-IconBitmap 256
$b256.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
$b256.Dispose()

$trayPath = Join-Path $AssetsDir 'tray.png'
$b32 = New-IconBitmap 32
$b32.Save($trayPath, [System.Drawing.Imaging.ImageFormat]::Png)
$b32.Dispose()

# ---- multi-size ICO (classic BMP entries: best compatibility) ----
function Get-IcoEntryBytes([System.Drawing.Bitmap]$bmp) {
    $w = $bmp.Width; $h = $bmp.Height
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    # BITMAPINFOHEADER
    $bw.Write([uint32]40)
    $bw.Write([int32]$w)
    $bw.Write([int32]($h * 2))
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]0)
    $bw.Write([uint32]($w * $h * 4))
    $bw.Write([int32]0)
    $bw.Write([int32]0)
    $bw.Write([uint32]0)
    $bw.Write([uint32]0)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $buf = New-Object byte[] ($stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
    $bmp.UnlockBits($data)
    for ($y = $h - 1; $y -ge 0; $y--) {
        $bw.Write($buf, $y * $stride, $w * 4)
    }
    # AND mask (all zero; alpha channel does the work)
    $maskRow = [int]([math]::Floor(($w + 31) / 32) * 4)
    $zero = New-Object byte[] $maskRow
    for ($y = 0; $y -lt $h; $y++) { $bw.Write($zero, 0, $maskRow) }
    $bw.Flush()
    $bytes = $ms.ToArray()
    $bw.Dispose()
    $ms.Dispose()
    return ,$bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$entries = @()
foreach ($s in $sizes) {
    $b = New-IconBitmap $s
    $entries += [pscustomobject]@{ Size = $s; Bytes = (Get-IcoEntryBytes $b) }
    $b.Dispose()
}

$icoPath = Join-Path $BuildDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$w = New-Object System.IO.BinaryWriter($fs)
$w.Write([uint16]0)
$w.Write([uint16]1)
$w.Write([uint16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
    if ($e.Size -ge 256) { $dim = 0 } else { $dim = $e.Size }
    $w.Write([byte]$dim)
    $w.Write([byte]$dim)
    $w.Write([byte]0)
    $w.Write([byte]0)
    $w.Write([uint16]1)
    $w.Write([uint16]32)
    $w.Write([uint32]$e.Bytes.Length)
    $w.Write([uint32]$offset)
    $offset += $e.Bytes.Length
}
foreach ($e in $entries) { $w.Write([byte[]]$e.Bytes) }
$w.Flush()
$w.Dispose()
$fs.Dispose()

Get-Item $iconPath, $trayPath, $icoPath | ForEach-Object { "{0}  {1} bytes" -f $_.FullName, $_.Length }
