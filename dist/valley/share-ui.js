// share-ui.js — SNSシェア4点セットと権利・出典モーダル（view層）。外部依存・外部通信なし。
// X・LINE・端末の共有シート（navigator.share）・リンクコピー＋Instagram/YouTube注記。
// 共有欄は常にDOM上に1つだけ据え付け（共有ダイアログと結果画面で同じ要素を移動して再利用する）。

const INTENT = {
  x: (text, url) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  line: (text, url) => `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`,
};

export function shareUrl() {
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  return canonical || location.href;
}

export function shareText() {
  const declared = document.querySelector('meta[name="share:text"]')?.content?.trim();
  if (declared) return declared;
  return (document.title || '').split('|')[0].trim() || document.title || '残火の鎌倉 — 隠れ谷の灯';
}

async function copyText(text, trigger, isCurrent = () => true) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!isCurrent()) return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    trigger.parentElement.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    trigger.focus({ preventScroll: true });
    return ok;
  }
}

function makeButton(label, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `share__button ${cls}`.trim();
  b.textContent = label;
  return b;
}

function makeLink(label, href, cls = '') {
  const a = document.createElement('a');
  a.className = `share__button ${cls}`.trim();
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  return a;
}

function buildShareWidget() {
  const url = shareUrl();
  const text = shareText();

  const box = document.createElement('section');
  box.className = 'share';
  box.setAttribute('aria-labelledby', 'share-label');

  const label = document.createElement('h2');
  label.className = 'share__label';
  label.id = 'share-label';
  label.textContent = 'このアプリを共有する';
  box.append(label);

  const row = document.createElement('div');
  row.className = 'share__row';

  const copyBtn = makeButton('リンクをコピー');
  const said = document.createElement('span');
  said.className = 'share__said';
  said.setAttribute('role', 'status');
  said.setAttribute('aria-live', 'polite');

  const manual = document.createElement('input');
  manual.className = 'share__manual';
  manual.readOnly = true;
  manual.value = url;
  manual.hidden = true;
  manual.setAttribute('aria-label', '手動でコピーするリンク');

  let resetTimer;
  let operation = 0;

  if (navigator.share) {
    const native = makeButton('共有…', 'share__button--primary');
    native.addEventListener('click', async () => {
      const mine = ++operation;
      clearTimeout(resetTimer);
      said.textContent = '';
      delete copyBtn.dataset.done;
      manual.hidden = true;
      try {
        await navigator.share({ title: text, text, url });
      } catch (err) {
        if (mine !== operation) return;
        if (err?.name !== 'AbortError') {
          said.textContent = '共有できませんでした。「リンクをコピー」をお試しください。';
        }
      }
    });
    row.append(native);
  }

  row.append(
    makeLink('Xで投稿', INTENT.x(text, url)),
    makeLink('LINEで送る', INTENT.line(text, url)),
    copyBtn,
  );

  copyBtn.addEventListener('click', async () => {
    const mine = ++operation;
    const ok = await copyText(url, copyBtn, () => mine === operation);
    if (mine !== operation) return;
    clearTimeout(resetTimer);
    manual.hidden = ok;
    if (!ok) {
      manual.focus();
      manual.select();
    }
    said.textContent = ok ? 'コピーしました' : 'コピーできませんでした。URLを選んでコピーしてください';
    copyBtn.dataset.done = String(ok);
    if (ok) {
      resetTimer = setTimeout(() => {
        said.textContent = '';
        delete copyBtn.dataset.done;
      }, 4000);
    }
  });

  const note = document.createElement('p');
  note.className = 'share__note';
  note.textContent = navigator.share
    ? 'InstagramとYouTubeはWebから直接投稿できない仕組みなので、「共有…」かコピーしたリンクから貼ってください。'
    : 'InstagramとYouTubeはWebから直接投稿できない仕組みなので、リンクをコピーして貼ってください。';

  box.append(row, said, manual, note);
  return box;
}

export function initShareAndCredits() {
  const widget = buildShareWidget();
  const shareDialog = document.getElementById('share-dialog');
  const shareHost = document.getElementById('share-dialog-body');
  const resultHost = document.getElementById('result-share');
  const btnShare = document.getElementById('btn-share');
  const btnShareClose = document.getElementById('share-close');

  const mountTo = target => {
    if (target && widget.parentElement !== target) target.replaceChildren(widget);
  };

  if (shareHost) mountTo(shareHost);

  if (btnShare && shareDialog) {
    btnShare.addEventListener('click', () => {
      mountTo(shareHost);
      if (!shareDialog.open) shareDialog.showModal();
    });
  }
  if (btnShareClose && shareDialog) {
    btnShareClose.addEventListener('click', () => shareDialog.close());
  }
  if (shareDialog) {
    shareDialog.addEventListener('click', e => {
      if (e.target === shareDialog) shareDialog.close();
    });
  }

  const creditsDialog = document.getElementById('credits-dialog');
  const btnCredits = document.getElementById('btn-credits');
  const btnCreditsClose = document.getElementById('credits-close');
  if (btnCredits && creditsDialog) {
    btnCredits.addEventListener('click', () => {
      if (!creditsDialog.open) creditsDialog.showModal();
    });
  }
  if (btnCreditsClose && creditsDialog) {
    btnCreditsClose.addEventListener('click', () => creditsDialog.close());
  }
  if (creditsDialog) {
    creditsDialog.addEventListener('click', e => {
      if (e.target === creditsDialog) creditsDialog.close();
    });
  }

  return {
    mountToResult() {
      mountTo(resultHost);
    },
    mountToDialog() {
      mountTo(shareHost);
    },
  };
}
