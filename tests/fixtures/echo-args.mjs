#!/usr/bin/env node
// Prints the arguments it received as JSON so a test can assert that the exact
// argument vector survived the spawn layer, including empty-string arguments.
process.stdout.write(JSON.stringify(process.argv.slice(2)));
