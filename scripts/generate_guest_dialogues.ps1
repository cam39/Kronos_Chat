$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $base "..\static\data\guest_dialogues.json"
$dst = Join-Path $base "..\static\data\guest_dialogues_expanded.json"
$json = Get-Content $src -Raw | ConvertFrom-Json
$scenes = @()
if ($json.scenes) { $scenes += $json.scenes }
if ($json.templates) {
  foreach ($t in $json.templates) {
    $count = [int]$t.count
    if ($count -le 0) { continue }
    $prefix = [string]$t.prefix
    if (-not $prefix) { $prefix = "auto" }
    $node = if ($t.node) { $t.node } else { "auto" }
    $textTpl = [string]$t.text
    $varsObj = if ($t.vars) { $t.vars } else { @{} }
    $contLabel = if ($t.continue_label) { $t.continue_label } else { "Continuer" }
    $branchLabel = if ($t.branch_label) { $t.branch_label } else { "Explorer" }
    $exitLabel = if ($t.exit_label) { $t.exit_label } else { "Quitter" }
    $branchNext = if ($t.branch_next) { $t.branch_next } else { "resilience" }
    $end1 = if ($t.end1) { $t.end1 } else { "ending_observer" }
    $end2 = if ($t.end2) { $t.end2 } else { "ending_ghost" }
    for ($i = 1; $i -le $count; $i++) {
      $idv = "$prefix`_$i"
      if ($i -lt $count) { $nextId = "$prefix`_$($i+1)" } else { $nextId = $end1 }
      $txt = $textTpl -replace '\{i\}', $i
      $scene = [pscustomobject]@{
        id = $idv
        node = $node
        text = $txt
        vars = $varsObj
        choices = @(
          @{ id = "${idv}_cont"; label = $contLabel; next = $nextId },
          @{ id = "${idv}_branch"; label = $branchLabel; next = $branchNext },
          @{ id = "${idv}_exit"; label = $exitLabel; next = $end2 }
        )
      }
      $scenes += $scene
    }
  }
}
$out = [pscustomobject]@{ meta = $json.meta; scenes = $scenes }
$out | ConvertTo-Json -Depth 20 | Out-File -FilePath $dst -Encoding utf8
$sceneCount = $scenes.Count
$lineCount = (Get-Content $dst | Measure-Object -Line).Lines
Write-Output \"Scenes: $sceneCount\"
Write-Output \"Lines: $lineCount\"
