// What to look at on the graph page, and what must hold at every step.
//
//   node scripts/shoot-page.mjs --scenario tests/browser/household-shots.mjs --out build/shots
//
// A step that does not hold throws: the pictures are for the eye, the numbers
// are for the record.
//
//   HH_FACES=1   show the faces of tests/browser/qa-faces/*.jpg instead of the
//                silhouettes (pictures that are not for the repository)
import assert from 'node:assert/strict';
import { join } from 'node:path';

const BENCH = '/tests/browser/household.html';

/** The window the desktop app opens, the smallest it can be, and a maximised one. */
export const SIZES = { default: [1100, 721], min: [820, 521], large: [1984, 1030] };

/**
 * Nothing may make the document itself scroll: the page is the window.
 *
 * Compared with what is left once the scrollbars have taken their share: a
 * page with a scrollbar of 15 pixels still reports the whole width.
 */
async function fitsTheWindow(page) {
  const size = await page.evaluate(() => {
    const root = document.scrollingElement;
    return { scroll: [root.scrollWidth, root.scrollHeight], view: [root.clientWidth, root.clientHeight] };
  });
  assert.ok(size.scroll[0] <= size.view[0], `the page scrolls sideways: ${size.scroll[0]} > ${size.view[0]}`);
  assert.ok(size.scroll[1] <= size.view[1], `the page scrolls down: ${size.scroll[1]} > ${size.view[1]}`);
}

/** Every person drawn on the canvas is whole on the screen. */
async function everyoneIsOnScreen(page) {
  const outside = await page.evaluate(() =>
    [...document.querySelectorAll('[data-person]')]
      .map((element) => ({ name: element.dataset.name, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width === 0
        || box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight)
      .map(({ name }) => name),
  );
  assert.deepEqual(outside, [], 'these people are cut off by the edge of the window');
}

/** No two people are drawn on top of each other. */
async function nobodyOverlaps(page) {
  const overlapped = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-person]')].map((element) => ({
      name: element.dataset.name,
      box: element.getBoundingClientRect(),
    }));
    const found = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i].box;
        const b = boxes[j].box;
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) {
          found.push([boxes[i].name, boxes[j].name]);
        }
      }
    }
    return found;
  });
  assert.deepEqual(overlapped, [], 'these people are drawn on top of each other');
}

/** The picture is big enough to read, and not pushed into a corner. */
async function pictureIsWellPlaced(page) {
  const room = await page.evaluate(() => {
    const canvas = document.querySelector('[data-role="canvas"]').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('[data-person]')].map((element) => element.getBoundingClientRect());
    const left = Math.min(...boxes.map((box) => box.left));
    const right = Math.max(...boxes.map((box) => box.right));
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    return {
      side: [Math.round(left - canvas.left), Math.round(canvas.right - right)],
      upright: [Math.round(top - canvas.top), Math.round(canvas.bottom - bottom)],
      width: Math.round(right - left),
      canvas: Math.round(canvas.width),
    };
  });
  // Centred, give or take.
  assert.ok(Math.abs(room.side[0] - room.side[1]) <= 4, `the picture is off to one side: ${room.side}`);
  assert.ok(Math.abs(room.upright[0] - room.upright[1]) <= 20, `the picture is off to the top or bottom: ${room.upright}`);
  // Not a postage stamp in the middle of a sheet: a family of eleven fills a good part of the width.
  assert.ok(room.width >= room.canvas * 0.5, `the picture is only ${room.width} of ${room.canvas} wide`);
}

/**
 * Everybody is drawn with the face the library keeps for them.
 *
 * The library sends a face as the bare JPEG; the page turns it into the address
 * of a picture. One it cannot show falls back to the outline, which is how a
 * face that was sent wrong shows up here.
 */
async function everyoneHasAFace(page) {
  const bare = await page.evaluate(() =>
    [...document.querySelectorAll('[data-person]')]
      .filter((element) => !element.querySelector('image') || element.querySelector('[data-role="silhouette"]'))
      .map((element) => element.dataset.name),
  );
  assert.deepEqual(bare, [], 'these people are drawn without the face the library keeps for them');
  const addresses = await page.evaluate(() =>
    [...document.querySelectorAll('[data-person] image')].map((element) => element.getAttribute('href').slice(0, 30)),
  );
  assert.ok(addresses.length > 0 && addresses.every((address) => address.startsWith('data:image/jpeg;base64,')), `the faces are not pictures: ${addresses[0]}`);
}

async function state(page) {
  return page.evaluate(() => {
    const name = document.querySelector('[data-role="person-name"]');
    return {
      panel: name ? name.textContent.trim() : null,
      picker: Boolean(document.querySelector('[data-role="picker"]')),
      start: Boolean(document.querySelector('[data-role="root-picker"]')),
      dialog: document.querySelector('.modal-dialog')?.getAttribute('aria-label') ?? null,
      people: document.querySelectorAll('[data-person]').length,
    };
  });
}

/** Whether the open list of people can be seen without looking for it. */
async function pickerIsIn_view(page) {
  const seen = await page.evaluate(() => {
    const picker = document.querySelector('[data-role="picker"]');
    if (!picker) return false;
    const box = picker.getBoundingClientRect();
    const side = document.querySelector('[data-role="side"]').getBoundingClientRect();
    return box.top >= side.top - 1 && box.top < side.bottom - 40;
  });
  assert.ok(seen, 'the list of people to add is out of sight');
}

export async function run(page, { out, base }) {
  const faces = process.env.HH_FACES ? 'faces=1&' : '';
  const bench = (query = '') => `${base}${BENCH}?${faces}${query}`;

  // ---- starting a graph ----
  await page.setViewport(...SIZES.default);
  await page.goto(bench('seed=none'));
  await page.shot(join(out, '01-pick-root.png'));
  assert.equal((await state(page)).start, true);
  await fitsTheWindow(page);

  await page.goto(bench('seed=none&personId=1002'));
  await page.shot(join(out, '02-opened-on-a-person.png'));
  assert.deepEqual(await state(page), { panel: '张小满', picker: false, start: false, dialog: null, people: 1 });

  // ---- the family ----
  await page.goto(bench());
  await page.shot(join(out, '03-family-1100.png'));
  assert.equal((await state(page)).panel, '张伟');
  await fitsTheWindow(page);
  await everyoneIsOnScreen(page);
  await nobodyOverlaps(page);
  await pictureIsWellPlaced(page);
  await everyoneHasAFace(page);

  await page.click('[data-person][data-name="张小满"]');
  await page.shot(join(out, '04-person-1100.png'));
  assert.equal((await state(page)).panel, '张小满');

  await page.click('[data-role="add-link"][data-group="parents"]');
  await page.shot(join(out, '05-add-parent.png'));
  assert.equal((await state(page)).picker, true);
  await page.type('[data-role="picker-search"]', '李');
  await page.shot(join(out, '06-add-parent-search.png'));
  // 李静 is a parent already, so the list does not offer her.
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-role="picker"] [data-pick-name="李静"]').length), 0);
  await page.click('[data-role="add-link"][data-group="parents"]');

  await page.click('[data-role="add-link"][data-group="social"]');
  await page.shot(join(out, '08-add-other.png'));
  await pickerIsIn_view(page);
  await page.click('[data-role="social-label"][data-social-label="teacher"]');
  await page.click('[data-role="picker"] [data-pick-name="刘敏"]');
  await page.shot(join(out, '09-after-adding.png'));
  assert.deepEqual(await state(page), { panel: '张小满', picker: false, start: false, dialog: null, people: 11 });

  await page.click('[data-role="close-person"]');
  await page.shot(join(out, '10-overview.png'));
  assert.equal((await state(page)).panel, null);

  // ---- moving the picture: dragging, the wheel, and clicking where nobody is ----
  await page.click('[data-person][data-name="张小满"]');
  const viewOf = () => page.evaluate(() => document.querySelector('[data-role="canvas"] svg > g').getAttribute('transform'));
  // A corner of the canvas where nobody is drawn.
  const corner = { x: 24, y: 70 };
  const still = await viewOf();
  await page.drag(corner, { x: corner.x + 80, y: corner.y + 40 });
  assert.notEqual(await viewOf(), still, 'dragging the canvas did not move the picture');
  await page.wheel(corner, -120);
  assert.notEqual(await viewOf(), still, 'the wheel did not zoom');
  await page.shot(join(out, '11-moved.png'));
  // The picture moved; the people on it are still where they are drawn.
  await page.click('[data-person][data-name="张小北"]');
  assert.equal((await state(page)).panel, '张小北', 'a person could not be picked after the picture was moved');
  await page.clickAt(12, 64);
  assert.equal((await state(page)).panel, null, 'a click on the empty canvas did not put the card away');
  await page.click('[data-role="zoom-fit"]');
  await everyoneIsOnScreen(page);
  await pictureIsWellPlaced(page);
  await everyoneHasAFace(page);

  // ---- the same, in the other windows ----
  await page.setViewport(...SIZES.min);
  await page.goto(bench());
  await page.shot(join(out, '11-family-820.png'));
  await fitsTheWindow(page);
  await everyoneIsOnScreen(page);
  await nobodyOverlaps(page);
  await page.click('[data-person][data-name="李静"]');
  await page.shot(join(out, '12-person-820.png'));
  await fitsTheWindow(page);
  await page.click('[data-role="add-link"][data-group="social"]');
  await page.shot(join(out, '13-add-other-820.png'));
  await fitsTheWindow(page);
  await pickerIsIn_view(page);

  await page.setViewport(...SIZES.large);
  await page.goto(bench());
  await page.shot(join(out, '14-family-1984.png'));
  await everyoneIsOnScreen(page);
  await pictureIsWellPlaced(page);
  await everyoneHasAFace(page);

  // ---- the dark theme ----
  await page.setViewport(...SIZES.default);
  await page.goto(bench('theme=dark'));
  await page.click('[data-person][data-name="张小满"]');
  await page.shot(join(out, '15-dark-person.png'));
  await page.goto(bench('theme=dark&seed=none'));
  await page.shot(join(out, '16-dark-pick-root.png'));
}
