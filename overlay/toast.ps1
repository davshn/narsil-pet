# Shows a Windows notification: $env:NARSIL_TITLE over $env:NARSIL_TEXT,
# both read from the environment and XML-escaped. With $env:NARSIL_LINK (a
# Claude Code conversation link) a click on it opens that conversation.
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$title = [Security.SecurityElement]::Escape($env:NARSIL_TITLE)
$body = [Security.SecurityElement]::Escape($env:NARSIL_TEXT)
$launch = ''
if ($env:NARSIL_LINK -match '^claude://code/continue\?session=local_[A-Za-z0-9-]{1,64}&source=desktop_action$') {
  $launch = " activationType='protocol' launch='$([Security.SecurityElement]::Escape($env:NARSIL_LINK))'"
}
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast$launch><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual></toast>")
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
