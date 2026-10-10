param(
  [Parameter(Mandatory = $true)][string]$WebSocketUrl,
  [Parameter(Mandatory = $true)][string]$Expression,
  [string]$OutputImage
)

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ws.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$request = @{
  id = 1
  method = "Runtime.evaluate"
  params = @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
} | ConvertTo-Json -Depth 8 -Compress
$bytes = [Text.Encoding]::UTF8.GetBytes($request)
$ws.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text,
  $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$buffer = New-Object byte[] 65536
$stream = [IO.MemoryStream]::new()
do {
  $result = $ws.ReceiveAsync([ArraySegment[byte]]::new($buffer),
    [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  $stream.Write($buffer, 0, $result.Count)
} while (!$result.EndOfMessage)
$response = [Text.Encoding]::UTF8.GetString($stream.ToArray())
if ($OutputImage) {
  $value = ($response | ConvertFrom-Json).result.result.value
  $payload = $value.Substring($value.IndexOf(",") + 1)
  [IO.File]::WriteAllBytes($OutputImage, [Convert]::FromBase64String($payload))
  "wrote $OutputImage"
} else {
  $response
}
$ws.Dispose()
