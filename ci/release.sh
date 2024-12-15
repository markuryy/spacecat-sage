#!/usr/bin/env bash

# Get version from package.json
VERSION="v$(jq -r .version package.json)"

# Get the last commit message
LAST_MSG=$(git log -1 --pretty=%B)

# Stage all changes
git add .

# If last commit was a version commit, amend it. Otherwise create new commit
if [[ $LAST_MSG =~ ^build:\ release\ v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+)?$ ]]; then
    git commit --amend --no-edit
else
    git commit -m "build: release $VERSION"
fi

# Clean up old tag if it exists
git tag -d $VERSION 2>/dev/null || true
git push origin :refs/tags/$VERSION 2>/dev/null || true

# Create and push new tag
git tag -a $VERSION -m "build: release $VERSION"
git push origin main --force # Need force since we might amend
git push origin $VERSION