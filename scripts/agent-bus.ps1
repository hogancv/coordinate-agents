[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet('init', 'send', 'wait', 'complete', 'state', 'status')]
    [string]$Command,

    [string]$Root,
    [ValidateSet('codex', 'antigravity')][string]$Role,
    [ValidateSet('codex', 'antigravity')][string]$From,
    [ValidateSet('codex', 'antigravity')][string]$To,
    [string]$Type,
    [string]$Subject,
    [string]$Body,
    [string]$BodyFile,
    [string]$RelatedCommit,
    [string]$MessagePath,
    [ValidateSet('IDLE', 'CLARIFYING', 'SPEC_READY', 'IMPLEMENTING', 'WAITING', 'REVIEWING', 'CHANGES_REQUESTED', 'APPROVED', 'RELEASING', 'STOPPED', 'ERROR')]
    [string]$State,
    [string]$Details,
    [int]$TimeoutMinutes = 120,
    [int]$PollSeconds = 5
)

$ErrorActionPreference = 'Stop'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Resolve-RepoRoot {
    param([string]$Candidate)
    if ($Candidate) {
        return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Candidate).Path)
    }
    $gitRoot = (& git rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $gitRoot) {
        throw 'No Git repository found. Pass -Root with a path inside a Git repository.'
    }
    return [System.IO.Path]::GetFullPath($gitRoot.Trim())
}

function Require-Value {
    param([string]$Name, [object]$Value)
    if ($null -eq $Value -or ([string]$Value).Length -eq 0) {
        throw "-$Name is required for command '$Command'."
    }
}

function Write-AtomicText {
    param([string]$Destination, [string]$Content, [string]$TempDirectory)
    [System.IO.Directory]::CreateDirectory($TempDirectory) | Out-Null
    $temp = Join-Path $TempDirectory ('.tmp-' + [guid]::NewGuid().ToString('N'))
    [System.IO.File]::WriteAllText($temp, $Content, $Utf8)
    Move-Item -LiteralPath $temp -Destination $Destination -Force -ErrorAction Stop
}

function Initialize-Bus {
    param([string]$RepoRoot)
    $bus = Join-Path $RepoRoot '.agent-bus'
    $directories = @(
        'inbox\codex\new', 'inbox\codex\processing', 'inbox\codex\processed',
        'inbox\antigravity\new', 'inbox\antigravity\processing', 'inbox\antigravity\processed',
        'specs', 'reviews', 'evidence', 'releases', 'state', 'logs', 'tmp'
    )
    foreach ($relative in $directories) {
        [System.IO.Directory]::CreateDirectory((Join-Path $bus $relative)) | Out-Null
    }

    $gitDir = (& git -C $RepoRoot rev-parse --git-dir 2>$null)
    if ($LASTEXITCODE -eq 0 -and $gitDir) {
        if (-not [System.IO.Path]::IsPathRooted($gitDir)) {
            $gitDir = Join-Path $RepoRoot $gitDir
        }
        $exclude = Join-Path ([System.IO.Path]::GetFullPath($gitDir)) 'info\exclude'
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $exclude)) | Out-Null
        if (-not (Test-Path -LiteralPath $exclude)) {
            [System.IO.File]::WriteAllText($exclude, ".agent-bus/`r`n", $Utf8)
        } else {
            $existing = [System.IO.File]::ReadAllText($exclude)
            if ($existing -notmatch '(?m)^\.agent-bus/\r?$') {
                [System.IO.File]::AppendAllText($exclude, "`r`n.agent-bus/`r`n", $Utf8)
            }
        }
    }
    return $bus
}

$Repo = Resolve-RepoRoot $Root
$Bus = Initialize-Bus $Repo

switch ($Command) {
    'init' {
        [pscustomobject]@{ success = $true; root = $Repo; bus = $Bus } | ConvertTo-Json -Compress
    }

    'send' {
        Require-Value 'From' $From
        Require-Value 'To' $To
        Require-Value 'Type' $Type
        Require-Value 'Subject' $Subject
        if ($BodyFile) {
            $resolvedBody = (Resolve-Path -LiteralPath $BodyFile).Path
            $messageBody = [System.IO.File]::ReadAllText($resolvedBody)
        } elseif ($null -ne $Body) {
            $messageBody = $Body
        } else {
            throw '-Body or -BodyFile is required for send.'
        }

        $now = (Get-Date).ToUniversalTime()
        $id = [guid]::NewGuid().ToString('N')
        $safeType = ($Type.ToUpperInvariant() -replace '[^A-Z0-9_-]', '_')
        $name = $now.ToString('yyyyMMdd-HHmmssfff') + '-' + $safeType + '-' + $id.Substring(0, 12) + '.md'
        $destination = Join-Path $Bus ("inbox\$To\new\$name")
        $yamlSubject = $Subject.Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
        $commitValue = if ($RelatedCommit) { $RelatedCommit } else { '' }
        $header = @(
            '---',
            ("id: {0}" -f $id),
            ("from: {0}" -f $From),
            ("to: {0}" -f $To),
            ("type: {0}" -f $safeType),
            ("created_at: {0}" -f $now.ToString('o')),
            ("related_commit: {0}" -f $commitValue),
            ('subject: "{0}"' -f $yamlSubject),
            '---',
            ''
        ) -join "`n"
        Write-AtomicText -Destination $destination -Content ($header + $messageBody + "`n") -TempDirectory (Join-Path $Bus 'tmp')
        [System.IO.Path]::GetFullPath($destination)
    }

    'wait' {
        Require-Value 'Role' $Role
        if ($TimeoutMinutes -lt 1) { throw '-TimeoutMinutes must be at least 1.' }
        if ($PollSeconds -lt 1) { throw '-PollSeconds must be at least 1.' }
        $newDir = Join-Path $Bus "inbox\$Role\new"
        $processingDir = Join-Path $Bus "inbox\$Role\processing"
        $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
        while ((Get-Date) -lt $deadline) {
            $candidate = Get-ChildItem -LiteralPath $newDir -File -Filter '*.md' |
                Sort-Object Name |
                Select-Object -First 1
            if ($candidate) {
                $claimed = Join-Path $processingDir $candidate.Name
                try {
                    Move-Item -LiteralPath $candidate.FullName -Destination $claimed -ErrorAction Stop
                    [System.IO.Path]::GetFullPath($claimed)
                    exit 0
                } catch [System.IO.IOException] {
                    Start-Sleep -Milliseconds 250
                    continue
                }
            }
            Start-Sleep -Seconds $PollSeconds
        }
        Write-Output 'TIMEOUT'
        exit 2
    }

    'complete' {
        Require-Value 'MessagePath' $MessagePath
        $resolved = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $MessagePath).Path)
        $allowed = [System.IO.Path]::GetFullPath((Join-Path $Bus 'inbox')) + [System.IO.Path]::DirectorySeparatorChar
        if (-not $resolved.StartsWith($allowed, [System.StringComparison]::OrdinalIgnoreCase) -or
            $resolved -notmatch '[\\/]processing[\\/]') {
            throw 'MessagePath must be a file in this bus processing directory.'
        }
        $processingDir = Split-Path -Parent $resolved
        $roleDir = Split-Path -Parent $processingDir
        $processedDir = Join-Path $roleDir 'processed'
        $destination = Join-Path $processedDir (Split-Path -Leaf $resolved)
        if (Test-Path -LiteralPath $destination) { throw "Processed message already exists: $destination" }
        Move-Item -LiteralPath $resolved -Destination $destination -ErrorAction Stop
        [System.IO.Path]::GetFullPath($destination)
    }

    'state' {
        Require-Value 'Role' $Role
        Require-Value 'State' $State
        $record = [ordered]@{
            agent = $Role
            state = $State
            details = $(if ($Details) { $Details } else { '' })
            related_commit = $(if ($RelatedCommit) { $RelatedCommit } else { '' })
            updated_at = (Get-Date).ToUniversalTime().ToString('o')
            process_id = $PID
            machine_name = $env:COMPUTERNAME
        }
        $destination = Join-Path $Bus "state\$Role.json"
        Write-AtomicText -Destination $destination -Content ($record | ConvertTo-Json) -TempDirectory (Join-Path $Bus 'tmp')
        [System.IO.Path]::GetFullPath($destination)
    }

    'status' {
        $states = @{}
        foreach ($agent in @('codex', 'antigravity')) {
            $statePath = Join-Path $Bus "state\$agent.json"
            $states[$agent] = if (Test-Path -LiteralPath $statePath) {
                [System.IO.File]::ReadAllText($statePath, $Utf8) | ConvertFrom-Json
            } else { $null }
        }
        $queues = @{}
        foreach ($agent in @('codex', 'antigravity')) {
            $queues[$agent] = [ordered]@{}
            foreach ($stage in @('new', 'processing', 'processed')) {
                $path = Join-Path $Bus "inbox\$agent\$stage"
                $queues[$agent][$stage] = @(Get-ChildItem -LiteralPath $path -File -Filter '*.md').Count
            }
        }
        [ordered]@{ root = $Repo; bus = $Bus; states = $states; queues = $queues } |
            ConvertTo-Json -Depth 6
    }
}
