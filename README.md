*A collaborative project by roylin1003 and Claude.*

# reel-input

**Short alphanumeric input for mobile web — without the soft keyboard.**
Slot-machine reels (`wheel`) or airport split-flap cards (`flap`). Flick a reel, let go, it coasts and snaps to the nearest character. On desktop: ↑↓ / mouse wheel / just type.

Zero dependencies. One global, `ReelInput`. Built-in synthesized sounds (no audio files).

Born in the high-score name entry of **[Gem-Drop-Arcade](https://gem-drop-arcade.roynexus.com)** — part of the [Protonia](https://roynexus.com) game lab.

## Why not just `<input>`?

For 1–8 characters (a name, a code, a PIN) the soft keyboard costs more than it gives: it squashes the viewport, IMEs bypass `maxlength`, and iOS often leaves the page shifted after the keyboard closes. Arcade high-score tables solved this decades ago with one dial per letter.

Not for long text — sentences, addresses and search boxes belong to the keyboard.

## Use

```html
<link rel="stylesheet" href="reel-input.css">
<div id="name"></div>
<script src="reel-input.js"></script>
<script>
  const ri = ReelInput.create(document.getElementById('name'), {
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?.-*',
    length: 3,
    mode: 'wheel',            // or 'flap'
    value: 'AAA',
    onConfirm: v => save(v),  // Enter / Space
  });
  // ri.value, ri.set(i, 'R'), ri.focus(i), ri.destroy()
</script>
```

Open `demo.html` to see both modes side by side.

Options: `keyboard` (default `true`), `onChange(value, i)`, `sound` (`'auto'`, a function `(kind, i) => {}`, or `null`). Volume: `ReelInput.sounds.volume`. Theme with the `--reel-*` CSS variables listed at the top of `reel-input.css`.

### Two things the host page must do

1. **Yield your own global `keydown`** while the reels are on screen (`if (nameEntryOpen) return;`). The module listens in the capture phase and stops propagation, but capture/bubble order on the same target differs between engines — don't rely on it.
2. **Call `ri.destroy()`** when the reels leave the screen, or the old listener will grab the next reel's keys.

## Notes

Design notes (analytic inertia, reading the *goal* instead of the drawn position, shortest-path typing, flap timing) are in the header comment of `reel-input.js`, in Traditional Chinese.

## About this project

Directed by Yen-Ting R. Lin. The code was written mostly by AI (Anthropic Claude) under his direction, then tested and reviewed by hand.

## License

Code: [MIT](LICENSE). See [CREDITS](CREDITS.md) for third-party resources.
