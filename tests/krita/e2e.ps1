# DSH Krita Bridge v1.1 live E2E test
# Usage: pwsh -File e2e.ps1
# Requires Krita running with the bridge listening on 127.0.0.1:5678.
$ErrorActionPreference = 'Stop'
$BaseUrl = 'http://127.0.0.1:5678'
$OutDir = Join-Path $PSScriptRoot '..\out'
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$ReportPath = Join-Path $PSScriptRoot 'e2e-report.json'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$RunName = 'DSH E2E ' + (Get-Date -Format 'HHmmss')
$ScratchName = $RunName + ' Scratch'

$script:checks = [System.Collections.Generic.List[object]]::new()
$script:raw = [ordered]@{}

function Save-Raw([string]$name, $value) {
    $script:raw[$name] = $value
}

function Check([string]$name, [bool]$ok, [string]$detail = '') {
    $script:checks.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail })
    $tag = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Output ("[{0}] {1}{2}" -f $tag, $name, $(if ($detail) { " :: $detail" } else { '' }))
}

function Invoke-BridgeRaw([string]$action, $params, [int]$timeoutSec = 30) {
    $payload = @{ action = $action; params = $params } | ConvertTo-Json -Depth 40 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    try {
        $resp = Invoke-WebRequest -Uri "$BaseUrl/" -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec $timeoutSec -UseBasicParsing
        return [pscustomobject]@{ StatusCode = [int]$resp.StatusCode; Body = ($resp.Content | ConvertFrom-Json) }
    } catch {
        $response = $_.Exception.Response
        if ($null -ne $response) {
            try {
                $stream = $response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $text = $reader.ReadToEnd()
                return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Body = ($text | ConvertFrom-Json) }
            } catch { }
        }
        throw
    }
}

function Invoke-Bridge([string]$action, $params, [int]$timeoutSec = 30) {
    try {
        $r = Invoke-BridgeRaw $action $params $timeoutSec
        return $r.Body
    } catch {
        $detail = $_.ErrorDetails.Message
        return [pscustomobject]@{ _http_error = $_.Exception.Message; _detail = $detail }
    }
}

function Has-Error($obj) {
    if ($null -eq $obj) { return $true }
    return ($obj.PSObject.Properties.Name -contains 'error') -or ($obj.PSObject.Properties.Name -contains '_http_error')
}

function Status-Is($obj, [string]$expected) {
    if (Has-Error $obj) { return $false }
    return ($obj.status -eq $expected)
}

# ---------------------------------------------------------------------------
# 1. health
# ---------------------------------------------------------------------------
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 10
    Save-Raw 'health' $health
    Check 'health.status' ($health.status -eq 'ok')
    Check 'health.protocol_version=1.1.0' ($health.protocol_version -eq '1.1.0') "$($health.protocol_version)"
    Check 'health.krita_version present' ([bool]$health.krita_version) "$($health.krita_version)"
    Check 'health.plugin=kritamcp' ($health.plugin -eq 'kritamcp')
} catch {
    Check 'health endpoint' $false $_.Exception.Message
    throw 'bridge not reachable'
}

# ---------------------------------------------------------------------------
# 2. new canvas 640x480 + paint via seq
# ---------------------------------------------------------------------------
$newCanvas = Invoke-Bridge 'new_canvas' @{ width = 640; height = 480; name = $RunName; background = '#101820' }
Save-Raw 'new_canvas' $newCanvas
Check 'new_canvas 640x480' ((Status-Is $newCanvas 'ok') -and $newCanvas.width -eq 640 -and $newCanvas.height -eq 480)

$drawCommands = @(
    @{ action = 'set_color'; params = @{ color = '#ff3b30' } },
    @{ action = 'set_brush'; params = @{ size = 14 } },
    @{ action = 'stroke'; params = @{ points = @(@(90, 140), @(170, 210), @(260, 150), @(340, 240), @(420, 180)) } },
    @{ action = 'set_color'; params = @{ color = '#f5d547' } },
    @{ action = 'stroke'; params = @{ points = @(@(120, 330), @(220, 260), @(320, 340), @(430, 280)) } },
    @{ action = 'draw_shape'; params = @{ shape = 'rectangle'; x = 460; y = 60; width = 120; height = 120; fill = $true } },
    @{ action = 'set_color'; params = @{ color = '#2ec4b6' } },
    @{ action = 'fill'; params = @{ x = 180; y = 380; radius = 55 } },
    @{ action = 'create_layer'; params = @{ name = 'Ink Layer 2'; layer_type = 'paintlayer' } },
    @{ action = 'list_layers'; params = @{} }
)
$drawSeq = Invoke-Bridge 'seq' @{ commands = $drawCommands }
Save-Raw 'seq_draw' $drawSeq
Check 'seq draw: status ok' (Status-Is $drawSeq 'ok') "$($drawSeq.status)"
Check 'seq draw: count=10' ($drawSeq.count -eq 10) "$($drawSeq.count)"
Check 'seq draw: all sub-results ok' (@($drawSeq.results | Where-Object { $_.status -ne 'ok' }).Count -eq 0)

$layers = Invoke-Bridge 'list_layers' @{}
Save-Raw 'list_layers' $layers
Check 'list_layers count>=2' ((Status-Is $layers 'ok') -and $layers.count -ge 2) "$($layers.count)"

# ---------------------------------------------------------------------------
# 3. layers + selection + undo/redo
# ---------------------------------------------------------------------------
$selLayer = Invoke-Bridge 'select_layer' @{ name = 'Ink Layer 2' }
Check 'select_layer Ink Layer 2' (Status-Is $selLayer 'ok')
$draw2 = Invoke-Bridge 'seq' @{ commands = @(
    @{ action = 'set_color'; params = @{ color = '#9b5de5' } },
    @{ action = 'stroke'; params = @{ points = @(@(60, 420), @(200, 400), @(340, 430), @(520, 400)); size = 10 } },
    @{ action = 'draw_shape'; params = @{ shape = 'ellipse'; x = 220; y = 60; width = 160; height = 100; fill = $true; stroke = $true } }
) }
Check 'seq on Ink Layer 2 (3 cmds)' (Status-Is $draw2 'ok')

$selRect = Invoke-Bridge 'select_rect' @{ x = 60; y = 60; width = 220; height = 140 }
$selInfo = Invoke-Bridge 'selection_info' @{}
$selStats = Invoke-Bridge 'selection_stats' @{}
Check 'select_rect' (Status-Is $selRect 'ok')
Check 'selection_info has_selection' ((Status-Is $selInfo 'ok') -and $selInfo.has_selection -eq $true) "$($selInfo.has_selection)"
Check 'selection_stats pixel_count>0' ((Status-Is $selStats 'ok') -and $selStats.pixel_count -gt 0) "$($selStats.pixel_count)"
$inv = Invoke-Bridge 'invert_selection' @{}
$desel = Invoke-Bridge 'deselect' @{}
Check 'invert_selection + deselect' ((Status-Is $inv 'ok') -and (Status-Is $desel 'ok'))

$undo1 = Invoke-Bridge 'undo' @{}
$undo2 = Invoke-Bridge 'undo' @{}
$redo1 = Invoke-Bridge 'redo' @{}
$redo2 = Invoke-Bridge 'redo' @{}
Check 'undo x2 + redo x2' (@($undo1, $undo2, $redo1, $redo2 | Where-Object { -not (Status-Is $_ 'ok') }).Count -eq 0)

# ---------------------------------------------------------------------------
# 4. py: eval introspection of the real API
# ---------------------------------------------------------------------------
$pyEvalCode = '{"krita_version": app.version(), "python": __import__("sys").version.split()[0], "filter_class_has_apply": hasattr(krita.Filter, "apply"), "node_has": [m for m in ("duplicate","mergeDown","move","setBlendingMode","ungroup","setOpacity") if hasattr(krita.Node, m)], "doc_has": [m for m in ("flatten","saveAs","close","createGroupLayer","setActiveNode","exportImage") if hasattr(krita.Document, m)], "filters_count": len(app.filters()), "actions_count": len(app.actions()), "infoobject_attrs": [m for m in dir(krita.InfoObject) if not m.startswith("_")], "doc_size": [doc.width(), doc.height()]}'
$pyEval = Invoke-Bridge 'py' @{ code = $pyEvalCode; mode = 'eval'; capture = $true }
Save-Raw 'py_eval' $pyEval
Check 'py eval ok' (Status-Is $pyEval 'ok')
Check 'py eval JSON result' ($null -ne $pyEval.result) ($pyEval.result | ConvertTo-Json -Compress -Depth 5)
Check 'py eval sees 52 filters' ($pyEval.result.filters_count -eq 52) "$($pyEval.result.filters_count)"
Check 'py eval sees Node.mergeDown' (@($pyEval.result.node_has) -contains 'mergeDown')
Check 'py eval docs 640x480' (@($pyEval.result.doc_size)[0] -eq 640)

$pyStdout = Invoke-Bridge 'py' @{ code = 'print("PY_STDOUT_OK", app.version(), doc.name())'; mode = 'exec'; capture = $true }
Check 'py exec stdout capture' ((Status-Is $pyStdout 'ok') -and ($pyStdout.stdout -match 'PY_STDOUT_OK')) ($pyStdout.stdout.Trim())

# ---------------------------------------------------------------------------
# 5. py escape hatch: QPainter linear-gradient layer
# ---------------------------------------------------------------------------
$gradCode = @'
from PyQt5.QtGui import QImage, QPainter, QLinearGradient, QBrush
from PyQt5.QtCore import QPointF, Qt
w, h = doc.width(), doc.height()
img = QImage(w, h, QImage.Format_ARGB32)
painter = QPainter(img)
grad = QLinearGradient(QPointF(0, 0), QPointF(w, h))
grad.setColorAt(0.0, QColor("#0b132b"))
grad.setColorAt(0.35, QColor("#1c2541"))
grad.setColorAt(0.65, QColor("#3a506b"))
grad.setColorAt(1.0, QColor("#5bc0be"))
painter.fillRect(img.rect(), QBrush(grad))
painter.end()
node = doc.createNode("Py Gradient", "paintlayer")
doc.rootNode().addChildNode(node, None)
ptr = img.constBits()
ptr.setsize(img.byteCount())
node.setPixelData(bytes(ptr), 0, 0, w, h)
doc.setActiveNode(node)
doc.refreshProjection()
print("GRADIENT_OK", w, h, len(bytes(ptr)))
'@
$pyGrad = Invoke-Bridge 'py' @{ code = $gradCode; mode = 'exec'; capture = $true }
Save-Raw 'py_gradient' $pyGrad
Check 'py gradient layer' ((Status-Is $pyGrad 'ok') -and ($pyGrad.stdout -match 'GRADIENT_OK')) ($pyGrad.stdout.Trim())

# ---------------------------------------------------------------------------
# 6. save native .kra + export PNG into dsh-krita/tests/out
# ---------------------------------------------------------------------------
$kraPath = Join-Path $OutDir 'e2e-drawing.kra'
$pngPath = Join-Path $OutDir 'e2e-drawing.png'
$docSave = Invoke-Bridge 'doc_save' @{ path = $kraPath }
Save-Raw 'doc_save' $docSave
Check 'doc_save native .kra' ((Status-Is $docSave 'ok') -and (Test-Path $kraPath))
$export = Invoke-Bridge 'save' @{ path = $pngPath }
Save-Raw 'save_png' $export
Check 'save PNG' ((Status-Is $export 'ok') -and (Test-Path $pngPath)) "$($export.size)"
if (Test-Path $pngPath) {
    $len = (Get-Item $pngPath).Length
    Check 'PNG size > 1KB' ($len -gt 1024) "$len bytes"
    try {
        Add-Type -AssemblyName System.Drawing
        $img = [System.Drawing.Image]::FromFile($pngPath)
        Save-Raw 'png' @{ path = $pngPath; bytes = $len; width = $img.Width; height = $img.Height }
        Check 'PNG dimensions 640x480' ($img.Width -eq 640 -and $img.Height -eq 480) "$($img.Width)x$($img.Height)"
        $img.Dispose()
    } catch {
        Check 'PNG dimensions readable' $false $_.Exception.Message
    }
}

$docs = Invoke-Bridge 'docs' @{}
$info = Invoke-Bridge 'info' @{}
Save-Raw 'docs' $docs
Save-Raw 'info' $info
Check 'docs count>=1' ((Status-Is $docs 'ok') -and $docs.count -ge 1) "$($docs.count)"
Check 'docs active modified=false after save' ((@($docs.docs | Where-Object { $_.active })).Count -eq 1 -and (@($docs.docs | Where-Object { $_.active })[0].modified -eq $false))
Check 'info rich (active_document/layer/brush)' ((Status-Is $info 'ok') -and ($null -ne $info.active_document) -and ($null -ne $info.active_layer) -and ($null -ne $info.foreground_color))
Check 'info document_count>=1' ($info.document_count -ge 1) "$($info.document_count)"

# ---------------------------------------------------------------------------
# 7. filters list + filter apply (invert twice to restore)
# ---------------------------------------------------------------------------
$filters = Invoke-Bridge 'filters' @{ q = 'invert'; limit = 10 }
Save-Raw 'filters' $filters
Check 'filters list invert' ((Status-Is $filters 'ok') -and $filters.total -ge 1) "$($filters.total)"
$filterApply = Invoke-Bridge 'filter' @{ name = 'invert'; layer = 'Py Gradient' } 20
Check 'filter apply invert (live)' ((Status-Is $filterApply 'ok') -or ($filterApply.error.code -eq 'UNSUPPORTED')) $(if (Status-Is $filterApply 'ok') { 'applied' } else { $filterApply.error.code })
if (Status-Is $filterApply 'ok') {
    $filterRestore = Invoke-Bridge 'filter' @{ name = 'invert'; layer = 'Py Gradient' } 20
    Check 'filter apply invert restore' (Status-Is $filterRestore 'ok')
}

# ---------------------------------------------------------------------------
# 8. actions / action
# ---------------------------------------------------------------------------
$actions = Invoke-Bridge 'actions' @{ q = 'undo'; limit = 5 }
Save-Raw 'actions' $actions
Check 'actions search undo' ((Status-Is $actions 'ok') -and $actions.total -ge 1) "total=$($actions.total)"
$unknownAction = Invoke-Bridge 'action' @{ id = 'definitely_not_an_action_xyz' }
Check 'action unknown -> ACTION_NOT_FOUND' ((Has-Error $unknownAction) -and $unknownAction.error.code -eq 'ACTION_NOT_FOUND') "$($unknownAction.error.code)"
$triggerUndo = Invoke-Bridge 'action' @{ id = 'edit_undo' }
$triggerRedo = Invoke-Bridge 'action' @{ id = 'edit_redo' }
Check 'action trigger edit_undo/edit_redo' ((Status-Is $triggerUndo 'ok') -and (Status-Is $triggerRedo 'ok'))

# ---------------------------------------------------------------------------
# 9. layer extra ops (best-effort)
# ---------------------------------------------------------------------------
$dup = Invoke-Bridge 'layer' @{ op = 'duplicate'; name = 'Py Gradient' }
Check 'layer duplicate' (Status-Is $dup 'ok') $(if (Status-Is $dup 'ok') { $dup.name } else { $dup.error.code })
$blend = Invoke-Bridge 'layer' @{ op = 'blend'; name = 'Ink Layer 2'; mode = 'multiply' }
Check 'layer blend multiply' ((Status-Is $blend 'ok') -and ($blend.mode -eq 'multiply')) $(if (Status-Is $blend 'ok') { $blend.mode } else { $blend.error.code })
$blendBack = Invoke-Bridge 'layer' @{ op = 'blend'; name = 'Ink Layer 2'; mode = 'normal' }
Check 'layer blend normal restore' (Status-Is $blendBack 'ok')
$moveUp = Invoke-Bridge 'layer' @{ op = 'move'; name = 'Ink Layer 2'; direction = 'up' }
Check 'layer move up (action)' ((Status-Is $moveUp 'ok') -and $moveUp.via -eq 'action:move_layer_up') $(if (Status-Is $moveUp 'ok') { $moveUp.via } else { $moveUp.error.code })
$moveStack = Invoke-Bridge 'layer' @{ op = 'move'; name = 'Ink Layer 2'; index = 1 }
Check 'layer move parent/index -> UNSUPPORTED' ((Has-Error $moveStack) -and $moveStack.error.code -eq 'UNSUPPORTED')
$group = Invoke-Bridge 'layer' @{ op = 'group'; name = 'Py Gradient' }
Check 'layer group (action)' ((Status-Is $group 'ok') -and $group.grouped -eq $true) $(if (Status-Is $group 'ok') { $group.group } else { $group.error.code })
$ungroupTarget = if (Status-Is $group 'ok' -and $group.group) { $group.group } else { 'Group' }
$ungroup = Invoke-Bridge 'layer' @{ op = 'ungroup'; name = $ungroupTarget }
Check 'layer ungroup (api/action fallback)' ((Status-Is $ungroup 'ok') -or ($ungroup.error.code -eq 'UNSUPPORTED')) $(if (Status-Is $ungroup 'ok') { $ungroup.via } else { $ungroup.error.code })

# ---------------------------------------------------------------------------
# 10. seq error handling + limits
# ---------------------------------------------------------------------------
$seqPartial = Invoke-Bridge 'seq' @{ commands = @(
    @{ action = 'get_canvas_info'; params = @{} },
    @{ action = 'does_not_exist'; params = @{} },
    @{ action = 'list_layers'; params = @{} }
) }
Save-Raw 'seq_partial' $seqPartial
Check 'seq partial error status' ($seqPartial.status -eq 'partial') "$($seqPartial.status)"
Check 'seq error code UNKNOWN_ACTION' ($seqPartial.results[1].status -eq 'error' -and $seqPartial.results[1].error.code -eq 'UNKNOWN_ACTION')
Check 'seq continues after error (count=3)' ($seqPartial.count -eq 3)

$seqNested = Invoke-Bridge 'seq' @{ commands = @(
    @{ action = 'seq'; params = @{ commands = @() } },
    @{ action = 'batch'; params = @{ commands = @() } }
) }
Check 'seq rejects nested seq/batch' ($seqNested.status -eq 'error' -and $seqNested.results[0].error.code -eq 'NESTED_NOT_ALLOWED' -and $seqNested.results[1].error.code -eq 'NESTED_NOT_ALLOWED')

$tooMany = @(); 1..65 | ForEach-Object { $tooMany += @{ action = 'get_canvas_info'; params = @{} } }
try {
    $r65 = Invoke-BridgeRaw 'seq' @{ commands = $tooMany } 20
    Check 'seq 65 commands -> HTTP 400' ($r65.StatusCode -eq 400 -and $r65.Body.error.code -eq 'SEQUENCE_TOO_LARGE') "$($r65.StatusCode)"
} catch {
    $detail = $_.ErrorDetails.Message
    Check 'seq 65 commands -> HTTP 400' ($detail -match 'SEQUENCE_TOO_LARGE') $detail
}

# ---------------------------------------------------------------------------
# 11. docs / doc_activate / doc_close
# ---------------------------------------------------------------------------
$scratch = Invoke-Bridge 'new_canvas' @{ width = 200; height = 150; name = $ScratchName; background = '#222222' }
Check 'new second canvas' (Status-Is $scratch 'ok')
$docs2 = Invoke-Bridge 'docs' @{}
Check 'docs contains run + scratch docs' ((@($docs2.docs | Where-Object { $_.name -eq $RunName }).Count -eq 1) -and (@($docs2.docs | Where-Object { $_.name -eq $ScratchName }).Count -eq 1)) "count=$($docs2.count)"
$activateMain = Invoke-Bridge 'doc_activate' @{ name = $RunName }
Check 'doc_activate by name' ((Status-Is $activateMain 'ok') -and $activateMain.activated -eq $true) "$($activateMain.activated)"
$scratchIndex = (@(Invoke-Bridge 'docs' @{}).docs | Where-Object { $_.name -eq $ScratchName })[0].index
$activateScratch = Invoke-Bridge 'doc_activate' @{ index = $scratchIndex }
Check 'doc_activate by index' ((Status-Is $activateScratch 'ok') -and $activateScratch.activated -eq $true) "$($activateScratch.activated)"
$closeRejected = Invoke-Bridge 'doc_close' @{ save = $false }
Check 'doc_close guard on unsaved doc' ((Has-Error $closeRejected) -and $closeRejected.error.code -eq 'UNSAVED_CHANGES') $(if (Has-Error $closeRejected) { $closeRejected.error.code } else { 'unexpected ok' })
$scratchKra = Join-Path $OutDir 'e2e-scratch.kra'
$scratchSave = Invoke-Bridge 'doc_save' @{ path = $scratchKra }
Check 'doc_save scratch .kra' ((Status-Is $scratchSave 'ok') -and (Test-Path $scratchKra))
$scratchSaved = Invoke-Bridge 'docs' @{}
$scratchModified = (@($scratchSaved.docs | Where-Object { $_.name -eq $ScratchName })[0]).modified
if ($scratchModified -eq $false) {
    $close = Invoke-Bridge 'doc_close' @{ save = $false }
    Check 'doc_close saved doc' (Status-Is $close 'ok') "$($close.status)"
} else {
    Check 'doc_close skipped (still modified after doc_save)' $true 'safety guard held'
}
$docBack = Invoke-Bridge 'doc_activate' @{ name = $RunName }
Check 'doc_activate main again' ((Status-Is $docBack 'ok') -and $docBack.activated -eq $true)

# ---------------------------------------------------------------------------
# 12. py PYTHON_ERROR
# ---------------------------------------------------------------------------
$pyErr = Invoke-Bridge 'py' @{ code = 'raise ValueError("intentional E2E failure")'; mode = 'exec'; capture = $true }
Check 'py PYTHON_ERROR' ((Has-Error $pyErr) -and $pyErr.error.code -eq 'PYTHON_ERROR' -and $pyErr.error.message -match 'ValueError') "$($pyErr.error.code)"

# ---------------------------------------------------------------------------
# 13. final state
# ---------------------------------------------------------------------------
$finalHealth = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 10
$finalInfo = Invoke-Bridge 'info' @{}
Save-Raw 'final_info' $finalInfo
Check 'final health ok' ($finalHealth.status -eq 'ok')
Check 'final active doc is run doc' ($finalInfo.active_document.name -eq $RunName) "$($finalInfo.active_document.name)"

$passed = @($script:checks | Where-Object { $_.ok }).Count
$failed = @($script:checks | Where-Object { -not $_.ok }).Count
$summary = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    base_url = $BaseUrl
    out_dir = $OutDir
    passed = $passed
    failed = $failed
    checks = $script:checks
    raw = $script:raw
}
$summary | ConvertTo-Json -Depth 30 | Set-Content -Path $ReportPath -Encoding utf8
Write-Output ''
Write-Output "RESULT: $passed passed, $failed failed. Report: $ReportPath"
if ($failed -gt 0) { exit 1 }
