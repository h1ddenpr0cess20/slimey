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

  /* The persona asks the model not to use markdown, because everything it
     writes gets said out loud. It uses some anyway, and a caption that shows
     the asterisks reads as a bug. */
  describe('the markdown the model was told not to use', () => {
    it('renders bold, emphasis and code as elements', () => {
      hud.appendCaption('A **big** _wobbly_ `slime`!');
      const caption = page.$('#caption');

      assert.equal(caption.querySelector('strong').textContent, 'big');
      assert.equal(caption.querySelector('em').textContent, 'wobbly');
      assert.equal(caption.querySelector('code').textContent, 'slime');
      assert.equal(caption.textContent, 'A big wobbly slime!');
    });

    it('nests one inside another', () => {
      hud.appendCaption('**very _very_ slimy**');
      assert.equal(page.$('#caption').querySelector('strong em').textContent, 'very');
    });

    it('formats a span whose halves arrive in different chunks', () => {
      // Deltas break wherever the model's tokens break, which is routinely
      // between a delimiter and its partner.
      hud.appendCaption('I am a **sli');
      assert.equal(page.$('#caption').querySelector('strong'), null);

      hud.appendCaption('me**!');
      assert.equal(page.$('#caption').querySelector('strong').textContent, 'slime');
      assert.equal(page.$('#caption').textContent, 'I am a slime!');
    });

    it('leaves ordinary prose punctuation alone', () => {
      hud.appendCaption('level_up_time costs 3 * 4 gold');
      const caption = page.$('#caption');

      assert.equal(caption.querySelector('em'), null);
      assert.equal(caption.textContent, 'level_up_time costs 3 * 4 gold');
    });

    it('keeps the line breaks the model sent', () => {
      // Rendered as breaks by `white-space: pre-wrap`; the job here is that
      // they survive into the DOM rather than being collapsed on the way in.
      hud.appendCaption('One thing.\n\nAnother thing.');
      assert.equal(page.$('#caption').textContent, 'One thing.\n\nAnother thing.');
    });

    it('still never produces markup, inside a span or out', () => {
      hud.appendCaption('**<img src=x onerror=alert(1)>** and `<b>bold</b>`');
      const caption = page.$('#caption');

      assert.equal(caption.querySelector('img'), null);
      assert.equal(caption.querySelector('b'), null);
      assert.equal(caption.querySelector('code').textContent, '<b>bold</b>');
    });

    it('starts each turn from an empty transcript', () => {
      hud.appendCaption('**first**');
      hud.clearCaption();
      hud.appendCaption('second');
      assert.equal(page.$('#caption').textContent, 'second');
    });
  });
});
