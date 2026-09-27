$ErrorActionPreference = 'Stop'
$root = 'c:\Users\vishn\Downloads.96bd4edb-86af-4b4b-878c-a589606559d8\Downloads\Hackathons-main\Hackathons-main\Sravya-Dumpala-sravyadumpala2095-gmail.com'
Set-Location $root
$f = Get-ChildItem -Recurse -File .\server,.\web -Include *.js,*.jsx

Write-Output '=== ROLE NAME LITERALS ==='
$f | Select-String -Pattern "'(owner|admin|viewer|operator|auditor)'" | ForEach-Object {
  $p = $_.Path.Replace($root + '\','')
  '{0}:{1}: {2}' -f $p, $_.LineNumber, $_.Line.Trim()
}

Write-Output ''
Write-Output '=== FRONTEND AUTHZ LOGIC (isAllowed / effect / allow|deny) ==='
Get-ChildItem -Recurse -File .\web -Include *.js,*.jsx | Select-String -Pattern 'function isAllowed|function whyLocked|effect|\ballow\b|\bdeny\b' | ForEach-Object {
  $p = $_.Path.Replace($root + '\','')
  '{0}:{1}: {2}' -f $p, $_.LineNumber, $_.Line.Trim()
}

Write-Output ''
Write-Output '=== THEME / MATRIX IMPORTS ==='
$f | Select-String -Pattern 'import .*\.(json|seed)|THEMES|theme' | ForEach-Object {
  $p = $_.Path.Replace($root + '\','')
  '{0}:{1}: {2}' -f $p, $_.LineNumber, $_.Line.Trim()
}
