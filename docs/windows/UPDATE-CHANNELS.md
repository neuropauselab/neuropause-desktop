# UPDATE-CHANNELS

The release-channel model for NeuroPause updates, and how users move between
channels. All of this is **existing** code (`updateChannels.ts`, tested); this
document describes it.

## The channels (verified in updateChannels.ts)

| Channel | electron-updater feed | allowPrerelease | Who it's for |
| --- | --- | --- | --- |
| **stable** | `latest.yml` | false | General users — only 1.0-style stable releases. |
| **beta** | `beta.yml` | true | Early adopters — receives `-beta`/`-rc` prereleases. |
| **internal** | `internal.yml` | true | Team/dogfood — internal builds. |

"Release Candidate" in the brief maps to the **beta** channel: `-rc` tags are
prereleases, and the beta channel has `allowPrerelease=true`, so RC builds are
delivered through beta. (A distinct `rc` channel could be added later as a
one-line entry in the channel map, but is not present today — stated honestly.)

## How channel selection works (existing IPC)

- The current channel is read from a persisted preference at startup
  (`appUpdater.readChannelPref()`), defaulting to **stable**.
- The renderer changes it via the existing IPC channel **`update:setChannel`**,
  surfaced by `UpdatesPanel.tsx`.
- Changing channel updates `autoUpdater.channel` and `allowPrerelease`
  immediately; the next check reads the newly selected feed.

## How a user moves between channels

1. Open **Operations → Updates** (the `UpdatesPanel`).
2. Choose a channel (stable / beta / internal).
3. The preference persists; the next "Check for updates" queries that channel's
   feed from the GitHub Release set.

Moving **stable → beta** exposes prereleases (the user will see `-rc`/`-beta`
versions). Moving **beta → stable** means the user stays on their current version
until a stable release is ≥ it (because `allowDowngrade=false` — a channel switch
never rolls a user *back*).

## Mapping to the release/tag scheme

- Tag `v1.0.0-rc.7` → prerelease → appears on **beta**/**internal** feeds.
- Tag `v1.0.0` (no prerelease suffix) → stable → appears on **stable** feed
  (`latest.yml`).

The CI workflow already marks `-rc`/`-beta` tags as GitHub **prereleases**
(verified in windows-release.yml), which is exactly what keeps them off the
stable channel until you cut a final release.

## Publisher config

The app reads updates from the GitHub provider (`electron-builder.yml` `publish`,
set this phase): owner `dishantdobariya91-debug`, repo `neuropause-desktop`,
`channel: beta`. The `channel` here sets the *default* feed the build tracks;
per-user channel selection (above) overrides it at runtime.
