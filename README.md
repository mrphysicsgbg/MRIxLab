<p align="center">
  <a href="https://mrphysicsgbg.github.io/MRIxLab/">
    <img src="assets/MRIxLab-emblem.jpg" width="100%" alt="MRI xLab">
  </a>
</p>

# MRIxLab

An interactive contrast exploration lab deployed as a static web app. Vanilla ES modules and Canvas with a locally bundled MathJax renderer for LaTeX equations; no application backend, build step, Python runtime, or WebAssembly.

## Run

Serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Python in this example only serves files; it is not part of the application. Opening `index.html` through `file://` is unsupported because browsers restrict module and data fetching. Deploy the directory as-is to any static host, including under a subpath. Serve JavaScript with its normal MIME type and include `data/phantom.bin` and `data/phantom.json`.

## Publish on GitHub Pages

This app can be served directly from the repository; no build step is needed.
The `.nojekyll` file tells GitHub Pages to serve the static files without Jekyll.

1. Commit and push the Pages files from this directory:

   ```sh
   git add .nojekyll README.md
   git commit -m "Prepare GitHub Pages publishing"
   git push origin main
   ```

2. Open [the repository's Pages settings](https://github.com/mrphysicsgbg/MRIxLab/settings/pages).
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Choose **main** and **/(root)**, then click **Save**.
5. Wait for the Pages deployment to finish in the repository's **Actions** tab.
6. Open [MRIxLab](https://mrphysicsgbg.github.io/MRIxLab/).

Future pushes to `main` update the site automatically. All assets, including the
phantom and MathJax, use relative URLs compatible with the `/MRIxLab/` path.
If Pages settings are unavailable, check your repository permissions and GitHub
plan; public repositories support Pages on GitHub Free.
See [GitHub's publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Browser icon and shared-link previews

The browser and mobile home-screen icons are resized versions of `assets/MRIxLab-icon.jpg`. The static Open Graph and Twitter metadata in `index.html` use the original JPEG as the shared-link image, including in Teams. The image URL is absolute and points to `https://mrphysicsgbg.github.io/MRIxLab/assets/MRIxLab-icon.jpg`.

Publish `index.html` and the `assets` directory together. Share the public GitHub Pages URL; Teams cannot retrieve a local `localhost` page. Preview services may cache older results, so previously shared links may take time to show the new image. If the public hosting address changes, update the canonical, Open Graph, and Twitter URLs in `index.html`.

## Behavior

Choose Spin Echo, Inversion Recovery or Gradient Echo. Controls and defaults are generated from `js/sequences.js`. Sequence changes restore that sequence's defaults; reset restores parameters and retains your slice. The slice selector covers zero-based indices 0–89, starting at 50.

The desktop left column contains Sequence & parameters, followed by Regions & contrast when enabled. This compact column stays visible while the page scrolls. Each parameter slider spans the panel width on its own row, and the sequence and ROI panels fit together without a separate sidebar scrollbar. Shorter desktop viewports omit the explanatory sequence and slice paragraphs to retain space for the controls. The object dropdown sits beside the Simulation object & image title and currently offers Digital brain phantom. Add converted datasets to the `simulationObjects` catalog in `js/phantom.js` to offer more objects; the selector and loading path use that catalog automatically. Loaded objects are retained in memory for reuse, and slice limits follow the selected object's dimensions.

On phone-sized viewports (620 px wide or less), panels 01 and 02 combine into one primary panel in dark mode. The image stays visible at the top, and compact pulse-sequence controls stay at the bottom. Sequence diagram, Signal equations and Define ROIs share one row of expandable links in the middle, replacing the display switches. Expanded contents appear beneath this row; the links remain visible while contents scroll. Opening equations or the diagram reduces the image height; panel contents scroll independently. Opening Define ROIs closes the diagram and replaces the bottom pulse-sequence controls with ROI controls, retaining a larger image for drawing. Closing Define ROIs restores the pulse-sequence controls; saved ROI outlines stay visible on the image and their mean signal curves stay visible in the diagram until the regions are deleted. Voxel hover measurements are hidden. The mobile slice selector is hidden while saved ROIs exist and returns when all ROIs are deleted. Noise free uses a button in the controls. Resizing to a wider viewport restores the desktop layout, display switches and saved theme preference, while retaining simulation settings.

Scroll over the image to navigate slices: down advances, up goes back. Mouse wheels and trackpads are supported; small trackpad deltas accumulate before advancing. Scrolling updates the slice slider, readout, image and voxel measurements together, and regenerates noise. Navigation stops at the volume boundaries. Scrolling outside the image scrolls the page normally; browser zoom gestures are preserved.

The Dark mode switch changes the interface theme and remembers the preference when browser storage is available. Show signal equations opens a third panel with the active sequence equation, symbol definitions and display calculation. On smaller screens this panel moves below the simulator. Hover over the image to inspect zero-based row/column/slice coordinates, signed raw signal, noisy magnitude, noise, displayed grayscale (0–255), proton density and the original T1/T2/T2* map values in seconds. These values follow the actual canvas pixel, including when the image is scaled.

Noise free, below Slice position, displays the magnitude of the raw signal without added noise. The hover noise value becomes zero and the display equation updates accordingly. Switching it off restores the current slice's noise realization; slice changes continue to regenerate that realization even while noise is disabled.

Define ROIs places Regions & contrast below Sequence & parameters in the far-left column and enables freehand drawing. The Object dropdown stays above the image; voxel values and image details sit below it. Press and trace on the image, then release to close the region. There are three slots per object and slice, with editable names and Draw/Redraw/Delete controls. Escape or Cancel drawing discards an unfinished trace and retains existing regions. Regions are saved in memory per slice for this session; revisiting a slice restores its masks. ROI boundaries stay aligned when the image is resized and remain visible when the ROI editor is collapsed. Only drawing controls depend on whether that editor is expanded. Wheel navigation is paused during an active trace.

ROI plots appear in an enlarged signal track within the sequence diagram and remain available when Define ROIs is collapsed. Changing TR, TE, TI, flip angle or Noise free updates the saved curves without reopening the ROI editor. They continue to follow slice changes; slices without defined regions use the standard signal illustration. Define ROIs does not open the sequence diagram automatically; open Sequence diagram separately to view the ROI plots. SE and GRE show mean `abs(S(t) + noise)` against time after excitation, using `t` in place of TE, with the vertical axis labeled Transversal magnetization (Mxy). IR uses two vertically stacked graphs: Longitudinal magnetization above and Transversal magnetization below, each spanning the full time window, with compact plot heights and vertical axis labels instead of plot headings. A dotted vertical line marks the 90° excitation pulse at TI across the sequence tracks and both plots. Both use the same time axis starting at inversion (t = 0) and amplitude scale, including negative values. Each graph overlays solid mean magnitudes with dotted signed means in the same ROI colors. Longitudinal curves exclude receiver noise; transverse curves include the current voxel noise after excitation and remain exactly zero before excitation. Image sampling is at `TI + TE`; hollow dots show magnitude means and filled dots show signed means. Each ROI legend shows separate solid/hollow and dotted/filled samples. The image remains a single magnitude image.

Before IR excitation, the plot shows longitudinal recovery `Mz(t) = rho * [1 - (2 - exp(-(TR - TI)/T1)) * exp(-t/T1)]`. This finite-TR initial condition assumes recovery from the preceding excitation before inversion, and joins the reference IR equation at TI. This is longitudinal magnetization, not measured transverse signal. At the fixed 90° excitation, longitudinal magnetization drops instantaneously to zero, then follows `Mz(t) = rho * [1 - exp(-(t - TI)/T1)]` toward thermal equilibrium. Transverse magnetization stays zero before TI and jumps at excitation; after TI, the original image equation is evaluated with `TE = t - TI`. Both plots explicitly draw the instantaneous transfer at TI. The distinction follows the inversion/excitation timing in [qMRLab's inversion-recovery signal modeling](https://qmrlab.org/t1_book/01/ir_blog/IR_SignalModelling.html); the teaching curve extends the original simulator rather than changing its image equations. Nonphysical timing combinations remain available and carry the existing timing warning.

Plots explicitly sample the image time, and their magnitude means exactly match the image voxels before grayscale normalization. The time axis remains linear throughout the plot window (0–0.25 s for SE/GRE, 0–TI+0.25 s for IR); delays outside this window may be compressed. Changing acquisition parameters updates curves and sampling. Noise free omits noise; otherwise each voxel's current noise is fixed over the plotted time window. Magnitude is averaged per voxel, rather than taking the absolute value of the signed mean. Units are arbitrary signal units; undefined combinations create gaps. These plots illustrate longitudinal recovery and transverse decay rather than a Bloch simulation of gradient dephasing or echo formation. ROIs and curves are cached until their inputs change.

Sequence diagram opens a separate panel, numbered according to the visible panels before it. It shows simplified RF, slice-selection gradient, phase-encoding gradient, readout gradient and signal tracks. SE places its refocusing pulse at TE/2; IR begins with inversion at time zero, excitation at TI, refocusing at TI+TE/2 and echo at TI+TE. TR marks the next cycle. GRE uses the chosen flip angle, a reversed readout gradient and no RF refocusing pulse. Parameter changes update the SVG timeline live. Long delays have explicit axis breaks; pulse widths, gradient amplitudes and the default echo waveform are schematic. Define ROIs replaces that default signal with the expanded quantitative plot described above. Impossible timing combinations are explained without changing the reference signal equations.

On wide screens, the diagram sits to the right of the equations (or the image when equations are hidden). When there is insufficient width for readable panels, it moves below the viewer within the right-hand columns, leaving the sticky controls column clear. The layout can expand beyond the usual page width while the diagram is visible.

The schematic conventions follow [Stanford RAD229 sequence overview](https://web.stanford.edu/class/rad229/Notes/0b-Sequence-Overview.pdf). Diagram event definitions belong to the sequence configuration; `js/sequence-diagram.js` supplies the shared timeline mapping and SVG rendering.

The four Float32 maps load once (approximately 14 MB total). Slice extraction returns cached views, simulations reuse a signal buffer, and rendering reuses ImageData and magnitude buffers. Input changes coalesce into one render per animation frame. No network requests occur during simulation.

Signed raw signals follow the reference equations exactly, with zero relaxation times replaced by 1 during evaluation. Times retain the source's seconds convention. Gaussian noise with standard deviation 0.01 is generated at initialization and regenerated in-place each time the slice changes, including when returning to a previous slice. Parameter and sequence changes retain the current noise. Rendering displays `abs(signal + noise)` with minimum 0 and a dynamically updated maximum. GRE at TR=0 and FA=0 preserves the reference's undefined raw signal; the display renders nonfinite pixels black and explains the combination.

Source orientation is `phantom[rows, columns, slice]`; the binary uses `[slice, row, column]` with the first row at the top, matching Python `imshow`. The canvas preserves the 90 × 108 image aspect ratio inside a square black display.

## Development and validation

Node 18+ is sufficient for the included engine, phantom and renderer checks:

```sh
npm test
```

NumPy is needed only to regenerate assets and independently validate numerical agreement:

```sh
python3 -m pip install numpy
curl -L --fail -o /tmp/BrainStandardResolution.npz https://raw.githubusercontent.com/JonathanArvidsson/EEN200/main/numPhantom/BrainStandardResolution.npz
python3 tools/convert_phantom.py /tmp/BrainStandardResolution.npz
python3 tools/validate_numerics.py /tmp/BrainStandardResolution.npz
```

Validation checks every converted voxel and compares 52 full-slice JavaScript results against the original NumPy methods, including defaults, alternate parameters, volume boundaries, zero relaxation values and the GRE singularity. It uses the original source precision before conversion, allows Float32 error (`atol=2e-7`, `rtol=2e-5`) and compares raw signed signals without noise or normalization. The actual Python source is retained in `tools/reference/MRI_contrast.py`; validation extracts its numerical methods without importing GUI dependencies.

Modules: `app.js` owns state and controls; `sequences.js` defines parameters and signals; `phantom.js` loads and exposes slices; `renderer.js` owns noise and display normalization. A new sequence normally requires only a new definition in `sequences.js`.

Sequence equations are LaTeX strings in `sequences.js`. `math.js` loads the bundled MathJax 3.2.2 TeX-to-SVG renderer on demand when the equation panel opens. It also formats the magnitude and grayscale display equations. Include `js/vendor/mathjax/` when deploying; equation rendering requires no CDN or external fonts. The upstream Apache-2.0 license is included. Rapid sequence changes only display the newest requested equation.

Optional real-browser smoke checks (with the static server running):

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tools/browser_smoke.py --screenshot /tmp/mrixlab.png
python3 tools/browser_mobile_roi.py
```

Chromium also requires its standard OS libraries. The smoke script checks control changes, slice boundaries, the noise lifecycle, theme persistence, the equation panel, voxel hover, absence of network requests during interaction, responsive layout, and load failure/retry; it measures simulation plus Canvas rendering. The dedicated mobile ROI check serves local assets through browser request routing, so it needs no HTTP server. It verifies touch drawing, repeated editor collapse, persistent outlines and mean signal plots, parameter changes and deletion at 320, 390 and 620 px. This mobile check passed in Chromium; the full smoke suite was not rerun for that change. Numerical and Node checks passed; maximum observed absolute error against NumPy was `5.93e-8`.

## Source

Reference: [JonathanArvidsson/EEN200 MRI_contrast.py](https://github.com/JonathanArvidsson/EEN200/blob/main/MRI_contrast.py). Phantom: [BrainStandardResolution.npz](https://github.com/JonathanArvidsson/EEN200/blob/main/numPhantom/BrainStandardResolution.npz). The metadata records the source SHA-256 for reproducibility. These upstream materials are retained with their original provenance; consult upstream for redistribution terms.
