import { t } from 'i18next';
import { configWrite } from '../config.js';
import { confirmServer, defaultServers, normalizeServer, serverSelection } from '../utils/serviceServers.js';

export function editServer(key) {
  if (!Object.prototype.hasOwnProperty.call(defaultServers, key) || document.querySelector('.tt-server-editor')) return;
  const previousFocus = document.activeElement;
  const frame = document.createElement('iframe');
  frame.className = 'tt-server-editor';
  frame.title = t('settings.servers.' + key);
  document.body.appendChild(frame);
  // Keep typing and remote events inside the editor, away from player shortcuts.
  const doc = frame.contentDocument;
  const style = doc.createElement('style');
  const pageStyle = document.querySelector('style[nonce]');
  if (pageStyle) style.nonce = pageStyle.nonce;
  style.textContent = `
    body { margin:0; padding:2%; background:#161616; color:white; font:4.3vh sans-serif; }
    input { display:block; box-sizing:border-box; width:100%; margin:0.4em 0; font:inherit; }
    button { font:inherit; min-width:2.2em; margin:0.1em; }
    :focus { outline:0.13em solid #ff4545; }
  `;
  doc.head.appendChild(style);
  const label = doc.createElement('label');
  label.textContent = frame.title;
  const input = doc.createElement('input');
  input.type = 'text';
  input.placeholder = defaultServers[key];
  const selection = serverSelection(key);
  input.value = selection.value;
  label.appendChild(input);
  doc.body.appendChild(label);
  const error = doc.createElement('div');
  error.setAttribute('role', 'alert');
  if (selection.pending) error.textContent = t('settings.servers.pending');
  doc.body.appendChild(error);

  function close() {
    frame.remove();
    previousFocus?.focus();
  }

  async function save(value) {
    if (value === null) {
      error.textContent = t('settings.servers.invalid');
      input.focus();
      return;
    }
    if (!await confirmServer(key, value)) {
      const selection = serverSelection(key);
      input.value = selection.value;
      error.textContent = t(selection.pending ? 'settings.servers.pending' : 'settings.servers.unconfirmed');
      return;
    }
    if (!frame.parentNode) return;
    configWrite(key, value);
    close();
  }

  const rows = [[input]];
  function row(items, action) {
    const container = doc.createElement('div');
    const buttons = items.map(text => {
      const button = doc.createElement('button');
      button.textContent = text;
      button.onclick = () => action(button);
      container.appendChild(button);
      return button;
    });
    doc.body.appendChild(container);
    rows.push(buttons);
    return buttons;
  }

  const actions = [() => save(normalizeServer(input.value)), close, () => save('')];
  const commands = row(['save', 'cancel', 'reset'].map(name => t('settings.servers.' + name)),
    button => actions[commands.indexOf(button)]());
  function insert(button) {
    input.setRangeText(button.textContent, input.selectionStart, input.selectionEnd, 'end');
  }
  const protocols = row(['https://', 'http://', '⌫', 'Aa'], button => {
    if (button === protocols[2]) {
      const start = input.selectionStart;
      input.setRangeText('', start === input.selectionEnd ? Math.max(0, start - 1) : start, input.selectionEnd, 'end');
    } else if (button === protocols[3]) {
      for (const key of letters) {
        const char = key.textContent;
        key.textContent = char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
      }
    } else insert(button);
  });
  const letters = [];
  for (const chars of ['abcdefghij', 'klmnopqrst', 'uvwxyz', '0123456789', '.-/:_~%[]@', "!$&'()*+,;="]) {
    const buttons = row(chars.split(''), insert);
    if (/^[a-z]/.test(chars)) letters.push(...buttons);
  }

  doc.addEventListener('keydown', event => {
    const focused = doc.activeElement;
    const y = rows.findIndex(items => items.includes(focused));
    if (y < 0) return;
    const x = rows[y].indexOf(focused);
    switch (event.keyCode) {
      case 27:
      case 461:
      case 10009:
        close();
        break;
      case 38:
      case 40: {
        const next = rows[Math.max(0, Math.min(rows.length - 1, y + (event.keyCode === 38 ? -1 : 1)))];
        next[Math.min(x, next.length - 1)].focus();
        break;
      }
      case 37:
      case 39:
        if (focused === input) return;
        rows[y][Math.max(0, Math.min(rows[y].length - 1, x + (event.keyCode === 37 ? -1 : 1)))].focus();
        break;
      case 13:
        if (focused === input) protocols[0].focus();
        else focused.click();
        break;
      default:
        return;
    }
    event.preventDefault();
  });
  input.focus();
}
