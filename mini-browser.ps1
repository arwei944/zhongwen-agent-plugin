Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Mini Browser"
$form.Size = New-Object System.Drawing.Size(1200, 800)
$form.StartPosition = "CenterScreen"

$toolstrip = New-Object System.Windows.Forms.ToolStrip
$toolstrip.BackColor = [System.Drawing.Color]::FromArgb(240, 240, 240)

$btnBack = New-Object System.Windows.Forms.ToolStripButton
$btnBack.Text = "<"
$btnBack.DisplayStyle = [System.Windows.Forms.ToolStripItemDisplayStyle]::Text

$btnForward = New-Object System.Windows.Forms.ToolStripButton
$btnForward.Text = ">"
$btnForward.DisplayStyle = [System.Windows.Forms.ToolStripItemDisplayStyle]::Text

$btnRefresh = New-Object System.Windows.Forms.ToolStripButton
$btnRefresh.Text = "R"
$btnRefresh.DisplayStyle = [System.Windows.Forms.ToolStripItemDisplayStyle]::Text

$txtUrl = New-Object System.Windows.Forms.ToolStripTextBox
$txtUrl.Size = New-Object System.Drawing.Size(600, 25)
$txtUrl.Text = "https://www.google.com"

$btnGo = New-Object System.Windows.Forms.ToolStripButton
$btnGo.Text = "Go"
$btnGo.DisplayStyle = [System.Windows.Forms.ToolStripItemDisplayStyle]::Text

[void]$toolstrip.Items.Add($btnBack)
[void]$toolstrip.Items.Add($btnForward)
[void]$toolstrip.Items.Add($btnRefresh)
[void]$toolstrip.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$toolstrip.Items.Add($txtUrl)
[void]$toolstrip.Items.Add($btnGo)

$web = New-Object System.Windows.Forms.WebBrowser
$web.Dock = "Fill"
$web.ScriptErrorsSuppressed = $true

$statusStrip = New-Object System.Windows.Forms.StatusStrip
$statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusLabel.Text = "Ready"
[void]$statusStrip.Items.Add($statusLabel)

$form.Controls.Add($web)
$form.Controls.Add($toolstrip)
$form.Controls.Add($statusStrip)

$web.add_Navigating({
    $txtUrl.Text = $_.Url.ToString()
    $statusLabel.Text = "Loading..."
})

$web.add_DocumentCompleted({
    $txtUrl.Text = $web.Url.ToString()
    $form.Text = "Mini Browser - " + $web.DocumentTitle
    $statusLabel.Text = "Done"
})

$btnGo.add_Click({
    $url = $txtUrl.Text.Trim()
    if ($url -notmatch "^https?://") { $url = "https://$url" }
    $web.Navigate($url)
})

$txtUrl.add_KeyDown({
    if ($args[1].KeyCode -eq "Enter") { $btnGo.PerformClick() }
})

$btnBack.add_Click({ $web.GoBack() })
$btnForward.add_Click({ $web.GoForward() })
$btnRefresh.add_Click({ $web.Refresh() })

$web.Navigate("https://www.google.com")
$form.ShowDialog()
