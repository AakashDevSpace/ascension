# Ascension

NEET practice: past papers, Allen mock tests, practice, formulas and a Review tab. Runs in any browser and installs as an app (PWA). Progress is kept in a private GitHub repository.

## How it fits together

| Repository | Visibility | Holds |
|---|---|---|
| `ascension` (this one) | Public | The app, served by GitHub Pages at `https://aakashdevspace.github.io/ascension/` |
| `ascension-data` | **Private** | One file, `progress.json.gz`: your whole profile. Every save is a commit, so earlier days can be restored from its history. |

```
index.html             the app
ghstore.js             saves progress to ascension-data through the GitHub API
sw.js                  service worker: opens instantly and offline; pictures and PDFs kept after first view
manifest.webmanifest   app name, colours and icons for installing
icons/                 app icons (192, 512, maskable, Apple)
papers/                NEET question and solution pictures, mock.js (Allen mock tests)
formulas/              formula sheets (PDF) and the formula practice bank
.nojekyll              serve files as they are
```

## One-time setup

1. **Create the two repositories** on github.com → New repository:
   - `ascension`: **Public**, empty (no README).
   - `ascension-data`: **Private**, empty.
2. **Push the app** from this folder:
   ```
   git remote add origin https://github.com/AakashDevSpace/ascension.git
   git push -u origin main
   ```
3. **Turn on Pages**: `ascension` → Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save. The site is live in a minute or two.
4. **Create the access token**: github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token:
   - Repository access: *Only select repositories* → `ascension-data`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Expiration: up to a year (set a reminder to renew it).
5. **Connect**: open the site → Settings → *GitHub storage* → paste the token → Connect. Your current progress is uploaded.

## Another browser or device

Open the site → on the setup screen choose **Load from GitHub** → paste the token → enter your unlock password. Install it from the browser menu (*Install app* / *Add to Home Screen*) if you like.

## Updating the app

Copy the new files into this folder, change `VERSION` in `sw.js`, commit and push. Installed copies pick up the new version the next time they open.

## Safety

- The token can read and write `ascension-data` only. Anyone who has it can change your progress, nothing else. Revoke it on GitHub at any time and make a new one.
- If GitHub is unreachable, progress keeps saving on the device and uploads when the connection is back.
