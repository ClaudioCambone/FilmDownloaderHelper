param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('info', 'set', 'delete')]
  [string]$Action,

  [string]$WebhookUrl,
  [string]$SecretToken
)

$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) {
  throw ".env not found at $envFile"
}

$tokenLine = Get-Content $envFile | Where-Object { $_ -like 'BOT_TOKEN=*' } | Select-Object -First 1
if (-not $tokenLine) {
  throw "BOT_TOKEN not found in .env"
}

$botToken = $tokenLine.Substring(10).Trim()
$base = "https://api.telegram.org/bot$botToken"

switch ($Action) {
  'info' {
    $result = Invoke-RestMethod -Uri "$base/getWebhookInfo" -Method GET
    $result | ConvertTo-Json -Depth 8
    break
  }

  'set' {
    if (-not $WebhookUrl) {
      throw "WebhookUrl is required for Action=set"
    }

    $body = @{
      url = $WebhookUrl
      allowed_updates = '["message"]'
      drop_pending_updates = 'true'
    }

    if ($SecretToken) {
      $body.secret_token = $SecretToken
    }

    $result = Invoke-RestMethod -Uri "$base/setWebhook" -Method POST -Body $body
    $result | ConvertTo-Json -Depth 8
    break
  }

  'delete' {
    $result = Invoke-RestMethod -Uri "$base/deleteWebhook?drop_pending_updates=true" -Method POST
    $result | ConvertTo-Json -Depth 8
    break
  }
}
