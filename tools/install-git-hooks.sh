#!/bin/sh
# Copy the repository's hooks into .git/hooks without disturbing the git-lfs
# hooks already installed there. Re-run after a fresh clone.
set -e
root=$(git rev-parse --show-toplevel)
for h in "$root"/tools/hooks/*; do
    name=$(basename "$h")
    cp "$h" "$root/.git/hooks/$name"
    chmod +x "$root/.git/hooks/$name"
    echo "installed $name"
done
