# Tetris

A guideline-style Tetris game that runs entirely in the browser. No dependencies, no build step — just vanilla HTML, CSS, and JavaScript.

**Play it now: [gregfrench.github.io/fable-tetris](https://gregfrench.github.io/fable-tetris/)**

## Play

Open `index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8123
# then visit http://localhost:8123
```

## Controls

| Key | Action |
| --- | --- |
| ← / → | Move (with DAS auto-repeat) |
| ↓ | Soft drop |
| Space | Hard drop |
| ↑ or X | Rotate clockwise |
| Z | Rotate counter-clockwise |
| C or Shift | Hold piece |
| P or Esc | Pause |
| R | Restart |
| M | Toggle sound |
| Enter | Start / play again |

## Features

- **SRS rotation** with full wall-kick tables (separate table for the I piece)
- **7-bag randomizer** with a 5-piece next queue and hold
- **Ghost piece**, lock delay with move resets (15 max), and DAS/ARR movement
- **T-spin detection** (3-corner rule, full and mini) with guideline scoring
- **Combos, back-to-back bonuses**, level progression every 10 lines, and gravity speed-up
- **Juice**: line-clear animations, particles, screen shake, danger-zone warning, floating action text
- **WebAudio** sound effects and the Korobeiniki theme, synthesized in code (no audio files)
- High score persisted in `localStorage`
