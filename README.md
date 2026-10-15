# BB plugins

Custom plugins for [BB](https://getbb.app). Each plugin lives in `plugins/` with
its own dependencies, build, tests, and license.

## Install a plugin

Install [Files](plugins/files-editor), a workspace editor with Monaco, Pierre
Trees, project search, and conflict diffs. Forked from
[AbdElrahman Telb’s Files plugin](https://github.com/abdoutelb/bb-plugin-files-editor),
with its MIT license and attribution preserved.

```sh
bb plugin install git:https://github.com/brock6g/bb-plugins.git@main --plugin files-editor
```

Requires BB 0.45.0 or newer with plugin SDK 0.6.15 or newer. The command tracks
`main`; run `bb plugin update files-editor` to update it. If you already have a
Files plugin from another source, follow the
[replacement instructions](plugins/files-editor#install) to preserve its settings.

## Work on a plugin

Clone this repository, then run commands from the plugin's directory:

```sh
git clone https://github.com/brock6g/bb-plugins.git
cd bb-plugins/plugins/files-editor
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run build
bb plugin install "path:$PWD"
```

After editing, rebuild and run `bb plugin reload files-editor`. Each plugin's
README covers its features, settings, and development requirements.

## Add another plugin

Create `plugins/<name>/` with its own `package.json`, README, license, and Bun
lockfile. Add its name and relative directory to [`.bb/plugins.json`](.bb/plugins.json).
BB uses that collection manifest to resolve `--plugin <name>`.

Keep credentials, local databases, dependency directories, and scratch files out
of the repository. Commit generated assets only when the plugin needs them to
install from Git, as Files does with `dist/monaco/`.

## Credits and licenses

Files is based on [AbdElrahman Telb's original Files plugin](https://github.com/abdoutelb/bb-plugin-files-editor).
Its MIT license and attribution are preserved in the plugin directory. Check
each plugin's license before reusing its code.
