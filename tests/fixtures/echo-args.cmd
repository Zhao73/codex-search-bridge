@ECHO off
REM Mirrors the shape of an npm-generated Windows shim, which is how `claude`
REM resolves on Windows. Argument forwarding through %* is the step that can
REM silently drop an empty-string argument, so the test exercises it directly.
node "%~dp0echo-args.mjs" %*
