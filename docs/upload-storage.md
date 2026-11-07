# Upload storage on Proxmox and Synology

Urban Explorer stores photos and videos in `/app/uploads`. Docker must bind this
directory to a mounted NAS directory; a directory named `/mnt/...` alone does
not establish an NFS connection.

## Current installation

The NFS connection was restored on 7 November 2026 in the FjordHub LXC (1000).
The old NAS address in `/etc/fstab` was replaced with the current address:

```fstab
192.168.1.165:/volume1/UrbanExplorer /mnt/urban-explorer nfs vers=3,resvport,_netdev,nofail 0 0
```

Urban Explorer's Docker bind mount is:

```text
/mnt/urban-explorer/uploads -> /app/uploads (read/write)
```

For a Compose installation, select the same location with:

```dotenv
UPLOADS_HOST_DIR=/mnt/urban-explorer/uploads
```

The Synology NFS export must allow the LXC's address. This installation mounts
the share inside the LXC, rather than on the Proxmox host.

## Verification and recovery

Run these checks inside the LXC:

```sh
findmnt -T /mnt/urban-explorer/uploads
docker exec urban-explorer df -T /app/uploads
```

Both must identify the Synology share as `nfs`, rather than the LXC's local
`ext4` filesystem. Also verify read/write access as the application's user.

If the mount is absent, stop the app before mounting the share and inspect the
local directory for uploads that need preserving. Mounting NFS hides any local
files beneath that mount point; it does not move them to the NAS. Start the app
after the mount succeeds so Docker binds the correct filesystem.

At recovery, the local upload directory was empty. The NAS upload directory
contained approximately 2.5 MB. A temporary write/read-access check passed and
the app responded after restart. No existing media was modified or deleted.
The previous fstab was saved as `/etc/fstab.before-urban-nfs-20261107`.

The entry is persistent, but `nofail` allows startup without a reachable NAS.
Recheck the filesystem after a reboot or NAS outage. This repository documents
the host configuration; pulling application code does not apply `/etc/fstab`
changes automatically.
