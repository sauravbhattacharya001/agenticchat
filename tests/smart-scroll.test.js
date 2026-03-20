/**
 * @jest-environment jsdom
 */

const { describe, it, expect, beforeEach } = require('@jest/globals');

describe('SmartScroll', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="blackbox" style="position:relative">
        <div id="chat-output" style="height:300px;overflow:auto"></div>
      </div>
    `;
    // Reset module state by re-evaluating (SmartScroll is an IIFE)
    jest.resetModules();
  });

  it('should create FAB element on init', () => {
    require('../app.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const fab = document.getElementById('smart-scroll-fab');
    expect(fab).not.toBeNull();
    expect(fab.getAttribute('role')).toBe('button');
  });

  it('should have badge initially hidden', () => {
    require('../app.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const badge = document.getElementById('smart-scroll-badge');
    expect(badge).not.toBeNull();
    expect(badge.style.display).toBe('');
  });

  it('should expose scrollToBottom function', () => {
    require('../app.js');
    expect(typeof SmartScroll.scrollToBottom).toBe('function');
  });

  it('should expose onNewMessage function', () => {
    require('../app.js');
    expect(typeof SmartScroll.onNewMessage).toBe('function');
  });

  it('should expose savePosition and restorePosition', () => {
    require('../app.js');
    expect(typeof SmartScroll.savePosition).toBe('function');
    expect(typeof SmartScroll.restorePosition).toBe('function');
  });
});
