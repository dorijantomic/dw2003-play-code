## v0.1.4 (2026-11-10)

### New

- **Over 200 extra quests.** Open the quest list with **F3** or the new **Quests** row in the pause menu. Quests unlock as you play. Some start when you walk onto a spot, and some end with a choice.
- **Options** page in the pause menu. Change battle speed (x1 to x3), how often fights happen, map detail (Original, Low, Medium, High), the picture filter, music and sound volume, and each weather and light effect.
- **Glossary** page in the pause menu: the Digimon and the items, with pictures.
- **Weather, light and water** on the field maps: rain, snow, storms, day and night, fog, moving grass, water with reflections, and matching sound. All of it can be turned off in Options.
- **More Digimon to raise.** The 135 Digimon that only appeared as enemies can now be learned as forms.
- **Playing with friends** (F4). One player hosts, friends join over Hamachi, Radmin VPN, Tailscale or the same network. You see each other walk, chat, send emotes, trade, and fight each other or together. Everyone uses their own disc and save.
- **Digimon World 2 extras (optional).** If you also own a Digimon World 2 disc, the Extras page of the setup builds its Digimon models and battle animations on your PC.

### Fixed

- Hit chance, critical hits and item drops in battle follow the original game.
- A partner's own numbers are used on every screen (menu, battle, gym), including after Digivolve, Form and Switch.
- Worn gear adds to element resistance the way the original does. The gear set bonus is no longer lost after Form or Switch.
- Battle status effects show the same everywhere, including the "cannot flee" and "cannot digivolve" locks.
- The card limit is the same on every screen and in saves.
- Screen fades take the same time on every screen. The folder-selection fade can no longer hang.
- Names are written to the save the same way from every screen.
- A Blast ends the same way in every fight. In online fights an enemy can no longer take a counter stance when it should not.
- The money you can hold is capped in the shop, as in the original.
- A fight that teaches a new form says so, and the results screen announces it.
- Big HD Remaster maps load in pieces, so they use far less memory.
- Fixes for enemy-only Digimon that you play.

### Known issues

- The Mac download is not in this release yet.

---

## Download

| Computer | File |
| --- | --- |
| Windows 10/11 | `DW2003-Setup-windows-x64.exe` |
| Linux (x64) | `DW2003-linux-x64.tar.gz` |

Start the app, then choose your own PAL **Digimon World 2003** disc image
(SLES-03936, `.bin`/`.iso`) on the page that opens. No game data is included.

### Seeing a security warning?

These downloads are not code-signed (signing needs a paid Microsoft/Apple
certificate), so the first launch asks you to confirm:

- **Windows** — *"Windows protected your PC"*: click **More info**, then **Run anyway**.
- **macOS** — *"Digimon World 2003" Not Opened*: click **Done**, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
- **Linux** — no warning.

You only need to do this once. Details: [README → Seeing a security warning?](https://github.com/dorijantomic/dw2003-play-code#seeing-a-security-warning)


### HD Remaster models (credit and licences)

The HD Remaster downloads these AI upscaling models (attached to this release as `.onnx` files, with
`MODEL-LICENSES.txt`). They are not part of the game's source code.

- **4x-FatePlus-lite** by kim2091, CC BY-NC-SA 4.0 (non-commercial; this ONNX file is an adapted copy under the same licence). https://openmodeldb.info/models/4x-FatePlus-lite
- **RealESRGAN_x4plus_anime_6B** by Xintao Wang et al., BSD 3-Clause. https://github.com/xinntao/Real-ESRGAN

The installer also carries `uv` by Astral (Apache-2.0 or MIT), which installs the upscaler's small ONNX Runtime package set.
