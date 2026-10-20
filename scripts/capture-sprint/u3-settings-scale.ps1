param(
  [int]$Percent = 100,
  [switch]$QueryOnly,
  [string]$ScreenshotPath = ''
)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null

function Get-SettingsWindow {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($c in $children) {
    try { if ($c.Current.Name -eq 'Settings') { return $c } } catch {}
  }
  return $null
}

function Get-ScaleCombo($window) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'SystemSettings_Display_Scaling_ItemSizeOverride_ComboBox')
  $combo = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if (-not $combo) {
    $nameCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Scale')
    $combo = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCond)
  }
  return $combo
}

function Get-Selected($combo) {
  try {
    $sp = $combo.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
    $items = $sp.Current.GetSelection()
    if ($items -and $items.Count -gt 0) { return $items[0].Current.Name }
  } catch {}
  return $null
}

function Get-ScaleItems($window, $combo) {
  $items = @()
  $names = @{}
  $scopes = @($window, $combo)
  foreach ($scope in $scopes) {
    if (-not $scope) { continue }
    foreach ($type in @([System.Windows.Automation.ControlType]::ListItem, [System.Windows.Automation.ControlType]::MenuItem)) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)
      $found = $scope.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
      foreach ($item in $found) {
        try {
          $name = $item.Current.Name
          if ($name -match '^\\d+%' -and -not $names.ContainsKey($name)) { $names[$name] = $true; $items += $item }
        } catch {}
      }
    }
  }
  return $items
}

function Save-Screen($path) {
  try {
    Add-Type -AssemblyName System.Drawing | Out-Null
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose(); $bmp.Dispose()
  } catch {}
}

# Fresh Settings instance so the Display page is deterministic.
Get-Process SystemSettings -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
Start-Process 'ms-settings:display'
$settings = $null
$combo = $null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 400
  $settings = Get-SettingsWindow
  if ($settings) { $combo = Get-ScaleCombo $settings }
  if ($combo) { break }
}
if (-not $settings) { Write-Output '{"ok":false,"error":"settings-window-not-found"}'; exit 1 }
if (-not $combo) { Write-Output '{"ok":false,"error":"scale-combo-not-found"}'; exit 1 }
$before = Get-Selected $combo
if ($QueryOnly) {
  Write-Output ("{""ok"":true,""queryOnly"":true,""selected"":""" + $before + """}")
  exit 0
}

$pattern = '^' + $Percent + '%'
$scaleItems = @()
$target = $null
try { $settings.SetFocus(); Start-Sleep -Milliseconds 300 } catch {}
for ($attempt = 0; $attempt -lt 3 -and -not $target; $attempt++) {
  try {
    $expand = $combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    $expand.Expand()
  } catch { try { $combo.SetFocus() } catch {} }
  Start-Sleep -Milliseconds 1200
  $scaleItems = Get-ScaleItems $settings $combo
  if ($ScreenshotPath) { Save-Screen $ScreenshotPath }
  foreach ($item in $scaleItems) {
    try { if ($item.Current.Name -match $pattern) { $target = $item; break } } catch {}
  }
  if (-not $target) { try { $expand.Collapse(); Start-Sleep -Milliseconds 300 } catch {} }
}
$available = @()
foreach ($item in $scaleItems) { try { $available += $item.Current.Name } catch {} }
if (-not $target) {
  Write-Output ("{""ok"":false,""error"":""scale-item-not-found"",""requestedPercent"":" + $Percent + ",""before"":""" + $before + """,""availableScaleItems"":" + (ConvertTo-Json $available -Compress) + "}")
  try { $expand.Collapse() } catch {}
  exit 2
}
$selectedName = $target.Current.Name
try {
  $si = $target.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  $si.Select()
} catch {
  try { $target.SetFocus(); Start-Sleep -Milliseconds 200 } catch {}
  try { $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {}
}
Start-Sleep -Seconds 2
try { $expand.Collapse() } catch {}
Start-Sleep -Milliseconds 700
$after = Get-Selected $combo
Write-Output ("{""ok"":true,""requestedPercent"":" + $Percent + ",""before"":""" + $before + """,""targetItem"":""" + $selectedName + """,""after"":""" + $after + """,""availableScaleItems"":" + (ConvertTo-Json $available -Compress) + "}")
