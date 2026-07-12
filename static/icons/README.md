# Urban Explorer Icon Pack

This ZIP contains an icon/app-icon pack for **Urban Explorer** based on the selected compass design.

## Included

- `master/` – 1024x1024 master icon, both transparent-corner and solid versions
- `web/` – favicon, Apple touch icon, Android Chrome icons, web manifest and browserconfig
- `pwa/` – PWA icons and maskable icons
- `ios/AppIcon.appiconset/` – Xcode-ready iOS app icon set with `Contents.json`
- `android/` – Android legacy launcher icon folders
- `windows/` – Windows tile icons
- `transparent_png/` – transparent-corner PNG exports in many sizes
- `solid_png/` – opaque PNG exports in many sizes
- `favicon.ico` – multi-size ICO file

## Notes

- For iOS/App Store, use the files in `ios/AppIcon.appiconset/`. These are opaque because iOS app icons should not use transparency.
- For websites, copy files from `web/` into your public/static folder.
- For PWA, copy files from `pwa/` and use the included `site.webmanifest`.
- The Google/MapTiler implementation is not part of this ZIP; this is only the icon pack.
