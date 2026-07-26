import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createHud } from '../../src/client/ui/hud.js';
import { loadPage } from '../helpers/dom.js';

describe('createHud', () => {
  let page;
  let hud;

  beforeEach(async () => {
    page = await loadPage();
    hud = createHud(page.document);
  });

  afterEach(() => page.close());

  it('finds every element it needs in the shipped markup', () => {
    // Renaming an id in index.html should fail here, not silently at runtime.
    for (const sel of ['#status', '#caption', '#you']) {
      assert.ok(page.$(sel), `${sel} is missing from index.html`);
    }
  });

  it('drives the status chip through both text and the state attribute', () => {
    hud.setState('speaking');
    assert.equal(page.$('#status').textContent, 'speaking');
    assert.equal(page.$('#status').dataset.state, 'speaking');
  });

  it('accepts the synthetic connecting state the CSS also styles', () => {
    hud.setState('connecting');
    assert.equal(page.$('#status').dataset.state, 'connecting');
  });

  it('shows and hides the line of what the person said', () => {
    hud.showUser('what are you?');
    assert.equal(page.$('#you').textContent, 'what are you?');
    assert.ok(page.$('#you').classList.contains('visible'));

    hud.hideUser();
    assert.ok(!page.$('#you').classList.contains('visible'));
    // The text stays put so it fades rather than snapping to empty.
    assert.equal(page.$('#you').textContent, 'what are you?');
  });

  it('appends caption chunks in order rather than replacing', () => {
    hud.appendCaption('Bloop! ');
    hud.appendCaption('I am a slime.');
    assert.equal(page.$('#caption').textContent, 'Bloop! I am a slime.');
    assert.ok(page.$('#caption').classList.contains('visible'));
  });

  it('renders text as text, never as markup', () => {
    hud.appendCaption('<img src=x onerror=alert(1)>');
    assert.equal(page.$('#caption').querySelector('img'), null);
    assert.equal(page.$('#caption').textContent, '<img src=x onerror=alert(1)>');
  });

  it('clears the caption and its error state together', () => {
    hud.showError('the call dropped');
    hud.clearCaption();
    const caption = page.$('#caption');
    assert.equal(caption.textContent, '');
    assert.ok(!caption.classList.contains('visible'));
    assert.ok(!caption.classList.contains('error'));
  });

  it('marks an error and drops the mark when normal text resumes', () => {
    hud.showError('the call dropped');
    assert.ok(page.$('#caption').classList.contains('error'));

    // A new turn's transcript must not inherit the red.
    hud.appendCaption('Bloop!');
    assert.ok(!page.$('#caption').classList.contains('error'));
  });

  it('replaces the previous error rather than appending to it', () => {
    hud.showError('first');
    hud.showError('second');
    assert.equal(page.$('#caption').textContent, 'second');
  });
});
