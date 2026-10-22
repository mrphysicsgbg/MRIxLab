"""Optional browser checks. Install Playwright + Chromium; serve the repo first."""
import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright


def run(url, screenshot):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1440, "height": 1100}, device_scale_factor=1)
        errors = []
        requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))
        page.goto(url)
        page.wait_for_function("!document.getElementById('simulation-controls').disabled")
        assert page.locator("#slice-value").inner_text() == "50 / 89"
        assert page.locator("#parameters input").count() == 2
        assert page.locator("#mri-image").evaluate("c => [c.width, c.height]") == [90, 108]
        # The ROI editor must not change the other panels' column geometry.
        for width in [768, 1280, 1700, 1920, 2300]:
            page.set_viewport_size({'width': width, 'height': 1100})
            for equations, diagram in [(False, False), (True, False), (False, True), (True, True)]:
                page.locator('#show-equations').set_checked(equations)
                page.locator('#show-diagram').set_checked(diagram)
                selectors = ['main', '#lab', '.control-panels', '.viewer', '#image-stage']
                selectors += ['#equations-panel'] if equations else []
                selectors += ['#diagram-panel'] if diagram else []
                before = {selector: page.locator(selector).bounding_box() for selector in selectors}
                page.locator('#define-rois').check()
                for selector, original_box in before.items():
                    current_box = page.locator(selector).bounding_box()
                    assert abs(current_box['width'] - original_box['width']) < 1, f'ROI toggle resized {selector} at {width}px'
                    assert abs(current_box['x'] - original_box['x']) < 1, f'ROI toggle moved {selector} at {width}px'
                assert abs(page.locator('#image-stage').bounding_box()['height'] - before['#image-stage']['height']) < 1
                page.locator('#define-rois').uncheck()
        page.set_viewport_size({'width': 1440, 'height': 1100})
        page.locator('#show-equations').uncheck()
        page.locator('#show-diagram').uncheck()

        def image():
            return page.locator("#mri-image").evaluate("c => c.toDataURL()")

        def wait_window():
            page.wait_for_function("!document.getElementById('status').textContent.includes('Updating global window')")
            assert 'Global window could not' not in page.locator('#status').inner_text()

        def slide(selector, value):
            page.locator(selector).evaluate("(el, v) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})); }", value)
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            wait_window()

        wait_window()
        network_count = len(requests)
        original = image()
        page.locator('#dark-mode').check()
        assert page.locator('html').get_attribute('data-theme') == 'dark'
        assert image() == original, 'Theme changes must not alter signal or noise'
        page.locator('#show-equations').check()
        assert page.locator('#equations-panel').is_visible()
        assert page.locator('#equation-sequence').inner_text() == 'Spin Echo'
        page.wait_for_selector('#signal-equation mjx-container svg')
        page.wait_for_selector('#display-equation mjx-container svg')
        assert page.locator('[data-mml-node="merror"]').count() == 0
        assert page.locator('#signal-equation mjx-container').count() == 1
        assert page.locator('#signal-equation mjx-assistive-mml').evaluate("el => getComputedStyle(el).position") == 'absolute'
        assert page.locator('#signal-equation mjx-assistive-mml').evaluate("el => getComputedStyle(el).clip") != 'auto'
        network_count = len(requests)
        page.locator('#show-diagram').check()
        assert page.locator('#diagram-panel').is_visible()
        assert page.locator('#diagram-number').inner_text() == '05'
        assert page.locator('#sequence-diagram .diagram-rf').count() == 3
        page.locator('#show-equations').uncheck()
        assert page.locator('#diagram-number').inner_text() == '04'
        page.locator('#show-equations').check()
        page.wait_for_selector('#signal-equation mjx-container svg')
        page.set_viewport_size({'width': 1920, 'height': 1100})
        equations_box = page.locator('#equations-panel').bounding_box()
        diagram_box = page.locator('#diagram-panel').bounding_box()
        assert diagram_box['x'] >= equations_box['x'] + equations_box['width'] - 1
        assert abs(diagram_box['y'] - equations_box['y']) < 1
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.set_viewport_size({'width': 1440, 'height': 1100})
        equations_box = page.locator('#equations-panel').bounding_box()
        diagram_box = page.locator('#diagram-panel').bounding_box()
        assert diagram_box['y'] >= equations_box['y'] + equations_box['height'] - 1
        page.locator('#mri-image').hover(position={'x': 1, 'y': 1})
        assert 'Row 0 · Column 0 · Slice 50' == page.locator('#pixel-position').inner_text()
        assert page.locator('#pixel-signal').inner_text() != '—'
        page.locator('#sequence').hover()
        assert page.locator('#pixel-signal').inner_text() == '—'
        page.locator('#image-stage').hover()
        page.mouse.wheel(0, 40)
        page.wait_for_function("document.querySelector('#slice').value === '51'")
        assert page.locator('#slice-value').inner_text() == '51 / 89'
        page.mouse.wheel(0, -40)
        page.wait_for_function("document.querySelector('#slice').value === '50'")
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(resolve))")
        original = image()
        page.locator('#noise-free').check()
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(resolve))")
        assert image() != original
        page.locator('#mri-image').hover(position={'x': 1, 'y': 1})
        assert float(page.locator('#pixel-noise').inner_text()) == 0
        page.locator('#noise-free').uncheck()
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(resolve))")
        assert image() == original, 'Noise-free switch must preserve the current realization'
        slide("#parameter-TR", 4)
        assert 'TR = 4.000 s' in page.locator('#sequence-diagram').text_content()
        assert image() != original
        page.locator("#reset").click()
        page.wait_for_function("document.querySelector('#parameter-TR').value === '1'")
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(resolve))")
        wait_window()
        assert image() == original, "Noise must stay fixed"
        for sequence, extra in [("IR", "TI"), ("GRE", "FA")]:
            page.select_option("#sequence", sequence)
            assert page.locator('#equation-sequence').inner_text() == ('Inversion Recovery' if sequence == 'IR' else 'Gradient Echo')
            page.wait_for_selector('#signal-equation mjx-container svg')
            assert page.locator('[data-mml-node="merror"]').count() == 0
            assert page.locator("#parameters input").count() == 3
            assert page.locator(f"#parameter-{extra}").count() == 1
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(resolve))")
            wait_window()
            before = image()
            slide(f"#parameter-{extra}", 1.2 if sequence == "IR" else 30)
            assert image() != before
            assert page.locator('#diagram-sequence').inner_text() == ('Inversion Recovery' if sequence == 'IR' else 'Gradient Echo')
            if sequence == 'GRE':
                assert page.locator('#sequence-diagram .diagram-rf').count() == 2
                assert '30°' in page.locator('#sequence-diagram').text_content()
            else:
                assert page.locator('#parameter-TR').get_attribute('min') == '0.3'
                assert float(page.locator('#parameter-TI').get_attribute('max')) < 0.9
                slide('#parameter-TR', 5)
                assert page.locator('#parameter-TI').get_attribute('max') == '4.5'
                slide('#parameter-TI', 4.5)
                slide('#parameter-TR', 0)
                tr = float(page.locator('#parameter-TR').input_value())
                te = float(page.locator('#parameter-TE').input_value())
                ti = float(page.locator('#parameter-TI').input_value())
                assert tr == 0.3
                assert 0 <= ti < tr - te
                assert ti == float(page.locator('#parameter-TI').get_attribute('max'))
                slide('#parameter-TE', 0.2)
                ti = float(page.locator('#parameter-TI').input_value())
                assert ti < tr - 0.2
                assert ti == float(page.locator('#parameter-TI').get_attribute('max'))
                assert page.locator('#parameter-TI').locator('..').locator('output').inner_text() == f'{ti:.3f} s'
                assert f'TI = {ti:.3f} s' in page.locator('#sequence-diagram').text_content()
                page.locator('#reset').click()
                assert page.locator('#parameter-TI').input_value() == '0'
                assert float(page.locator('#parameter-TI').get_attribute('max')) < 0.9
        slide("#parameter-TR", 0)
        slide("#parameter-FA", 0)
        assert "undefined" in page.locator("#status").inner_text()
        page.select_option("#sequence", "SE")
        for index in [0, 17, 50, 89]:
            slide("#slice", index)
            assert page.locator("#slice-value").inner_text() == f"{index} / 89"
        slide("#slice", 50)
        assert image() != original, 'Returning to the same slice must generate fresh noise'
        same_slice = image()
        slide('#slice', 50)
        assert image() == same_slice, 'An unchanged slice must retain its noise'
        assert len(requests) == network_count, "Interactions must not fetch data"
        assert not errors, errors
        page.locator('#show-diagram').uncheck()
        page.locator('#define-rois').check()
        assert not page.locator('#show-diagram').is_checked()
        assert not page.locator('#diagram-panel').is_visible()
        page.locator('#show-diagram').check()
        assert page.locator('#roi-panel').is_visible()
        assert page.locator('#roi-drawing-overlay').is_visible()
        assert page.locator('#roi-drawing-overlay').get_attribute('hidden') is None
        assert page.locator('#sequence-diagram').get_attribute('viewBox') == '0 0 900 430'
        for slot in range(3):
            page.locator(f'#roi-draw-{slot}').click()
            box = page.locator('#mri-image').bounding_box()
            left = box['x'] + box['width'] * (0.25 + slot * 0.16)
            top = box['y'] + box['height'] * 0.4
            size = box['width'] * 0.08
            page.mouse.move(left, top)
            page.mouse.down()
            for x, y in [(left + size, top), (left + size, top + size), (left, top + size), (left, top)]:
                page.mouse.move(x, y, steps=6)
            page.mouse.up()
            assert 'pixels' in page.locator(f'#roi-value-{slot}').inner_text()
        assert page.locator('#sequence-diagram .roi-signal-curve').count() == 3
        assert page.locator('#sequence-diagram .roi-image-sample').count() == 3
        page.locator('#roi-name-0').fill('White matter')
        assert 'White matter' in page.locator('#sequence-diagram').text_content()
        page.locator('#define-rois').uncheck()
        assert page.locator('#roi-overlay').is_visible()
        assert page.locator('#roi-overlay polygon').count() == 3
        assert page.locator('#sequence-diagram .roi-signal-curve').count() == 3
        old_sample = page.locator('#sequence-diagram .roi-chart-current').get_attribute('x1')
        slide('#parameter-TE', 0.02)
        new_sample = page.locator('#sequence-diagram .roi-chart-current').get_attribute('x1')
        assert old_sample != new_sample
        assert page.locator('#sequence-diagram .roi-image-sample').evaluate_all('(dots, x) => dots.every(dot => dot.getAttribute("cx") === x)', new_sample)
        slide('#slice', 17)
        assert page.locator('#sequence-diagram .roi-signal-curve').count() == 0
        slide('#slice', 50)
        assert page.locator('#sequence-diagram .roi-signal-curve').count() == 3
        assert page.locator('#roi-overlay polygon').count() == 3
        page.locator('#define-rois').check()
        page.locator('#roi-draw-0').click()
        page.keyboard.press('Escape')
        assert page.locator('#sequence-diagram .roi-signal-curve').count() == 3
        page.set_viewport_size({'width': 2300, 'height': 1100})
        image_box = page.locator('.viewer').bounding_box()
        roi_box = page.locator('#roi-panel').bounding_box()
        assert roi_box['x'] < image_box['x']
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.set_viewport_size({'width': 1440, 'height': 1100})
        assert len(requests) == network_count, 'ROI drawing and tracing use only loaded data'
        # Profile the real engine and renderer together, using existing buffers.
        milliseconds = page.evaluate("""async () => {
          const {loadPhantom} = await import('./js/phantom.js');
          const {sequences} = await import('./js/sequences.js');
          const {createRenderer} = await import('./js/renderer.js');
          const p = await loadPhantom();
          const signal = new Float32Array(p.width * p.height);
          const renderer = createRenderer(document.createElement('canvas'), p.width, p.height);
          const start = performance.now();
          for (let i = 0; i < 200; i++) {
            sequences.GRE.simulate(p.getSlice(50), {TR: 1, TE: .1, FA: 30}, signal);
            renderer.render(signal, false, 1);
          }
          return (performance.now() - start) / 200;
        }""")
        if screenshot:
            page.screenshot(path=str(screenshot), full_page=True)
        page.locator('#dark-mode').uncheck()
        for width in [320, 390, 620, 621, 850]:
            page.set_viewport_size({"width": width, "height": 844})
            page.wait_for_function("(phone) => document.querySelector('.controls').parentElement.classList.contains('viewer-content') === phone", arg=width <= 620)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow at {width}px"
            if width <= 620:
                assert page.locator('html').get_attribute('data-theme') == 'dark'
                assert not page.locator('.settings').is_visible()
                assert not page.locator('.pixel-inspector').is_visible()
                for selector in ['#mobile-roi-panel', '#mobile-diagram-panel', '#mobile-equations-panel']:
                    if page.locator(selector).evaluate('el => el.open'):
                        page.locator(selector + ' > summary').click()
                        page.wait_for_function("document.querySelector('#lab').dataset.expandedPanels === String(['#mobile-diagram-panel', '#mobile-equations-panel'].filter(id => document.querySelector(id).open).length)")
                full_image = page.locator('#image-stage').bounding_box()
                page.locator('#mobile-equations-panel > summary').click()
                page.wait_for_function("!document.querySelector('#equations-panel').hidden")
                assert page.locator('#image-stage').bounding_box()['height'] < full_image['height']
                page.locator('#mobile-equations-panel > summary').click()
                page.locator('#mobile-diagram-panel > summary').click()
                page.wait_for_function("!document.querySelector('#diagram-panel').hidden")
                small_image = page.locator('#image-stage').bounding_box()
                page.locator('#mobile-roi-panel > summary').click()
                page.wait_for_function("!document.querySelector('#roi-panel').hidden && document.querySelector('#diagram-panel').hidden")
                image_box = page.locator('#image-stage').bounding_box()
                roi_box = page.locator('#mobile-roi-dock').bounding_box()
                assert image_box['height'] > small_image['height'], 'ROI editing must restore drawing space'
                assert image_box['y'] + image_box['height'] <= roi_box['y']
                assert roi_box['y'] + roi_box['height'] <= 845
                assert not page.locator('#sequence').is_visible()
                assert page.locator('#roi-panel').evaluate("el => el.parentElement.id === 'mobile-roi-dock'")
                assert page.locator('#mri-image').is_visible()
                page.locator('#mobile-roi-panel > summary').click()
                page.wait_for_function("document.querySelector('#roi-panel').hidden")
                assert page.locator('#sequence').is_visible()
                for sequence in ['SE', 'IR', 'GRE']:
                    page.select_option('#sequence', sequence)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    assert page.locator('.controls').bounding_box()['y'] + page.locator('.controls').bounding_box()['height'] <= 845
                page.select_option('#sequence', 'SE')
                page.locator('#mobile-noise-free').click()
                assert page.locator('#mobile-noise-free').get_attribute('aria-pressed') == 'true'
                page.locator('#mobile-noise-free').click()
            else:
                assert page.locator('html').get_attribute('data-theme') == 'light', 'Desktop theme preference is retained'
                assert page.locator('.settings').is_visible()
                assert page.locator('.pixel-inspector').is_visible()
                assert page.locator('#roi-panel').evaluate("el => el.parentElement.classList.contains('control-panels')")
        page.set_viewport_size({"width": 390, "height": 844})
        if screenshot:
            page.screenshot(path=str(screenshot.with_name("mobile-" + screenshot.name)), full_page=True)
        # Failed asset requests produce a useful message; retry recovers.
        page.route("**/data/phantom.bin", lambda route: route.fulfill(status=503, body="Unavailable"))
        page.reload()
        page.wait_for_selector("#retry", state="visible")
        assert page.locator('html').get_attribute('data-theme') == 'dark', 'Theme preference persists'
        assert page.locator("#simulation-controls").is_disabled()
        page.unroute("**/data/phantom.bin")
        page.locator("#retry").click()
        page.wait_for_function("!document.getElementById('simulation-controls').disabled")
        assert not errors, errors
        print(f"PASS: sequences, sliders, slice boundaries, noise lifecycle, theme persistence, equations, voxel hover, three ROI drawings/names/slice persistence, temporal sample markers, responsive layouts, load failure/retry. Mean GRE simulation + rendering: {milliseconds:.2f} ms.")
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000/")
    parser.add_argument("--screenshot", type=Path)
    args = parser.parse_args()
    run(args.url, args.screenshot)
