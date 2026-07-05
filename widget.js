/*
 * Locale — embeddable enquiry widget
 * ------------------------------------------------------------------
 * Paste this on a client's own website:
 *
 *   <script src="https://locale-os.vercel.app/widget.js"
 *           data-owner="<their Locale user id>"
 *           data-business="<their business name>"
 *           data-email="<where they want enquiries sent>"></script>
 *
 * It renders a small "Get in touch" enquiry form wherever the script tag sits
 * on the page, inside a Shadow DOM so it can never clash with the host
 * site's own CSS. On submit it posts straight to /api/capture-lead, which:
 *   1. Stores the lead in Supabase, tagged with this business's owner_id
 *      (so it shows up automatically in their Locale Job Tracker)
 *   2. Sends the visitor an instant "thanks, we got it" email
 *   3. Notifies the business owner so they can follow up while it's warm
 *
 * This file is plain, dependency-free JS on purpose — it has to run safely
 * on someone else's website, so it stays small and self-contained.
 */
(function () {
  var thisScript = document.currentScript;
  if (!thisScript) return; // can't safely locate ourselves — bail quietly

  var ownerId = thisScript.getAttribute('data-owner') || '';
  var businessName = thisScript.getAttribute('data-business') || 'us';
  var ownerEmail = thisScript.getAttribute('data-email') || '';
  var apiBase = (function () {
    try { return new URL(thisScript.src).origin; } catch (e) { return 'https://locale-os.vercel.app'; }
  })();

  if (!ownerId) {
    console.warn('Locale widget: missing data-owner attribute — enquiries would not be linked to a business. Not rendering.');
    return;
  }

  // Host element + Shadow DOM, so the host site's CSS can never break this
  // widget's layout (and this widget's CSS can never leak out either).
  var host = document.createElement('div');
  thisScript.parentNode.insertBefore(host, thisScript.nextSibling);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var css =
    ':host{all:initial}' +
    '.lw{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
    'max-width:420px;border:1px solid #e4e0d6;border-radius:14px;padding:22px 24px;background:#fffcf7;box-sizing:border-box}' +
    '.lw *{box-sizing:border-box}' +
    '.lw-title{font-size:17px;font-weight:700;color:#1f2326;margin:0 0 4px}' +
    '.lw-sub{font-size:13px;color:#6d6a63;margin:0 0 16px;line-height:1.5}' +
    '.lw-field{margin-bottom:12px}' +
    '.lw-field label{display:block;font-size:12.5px;font-weight:600;color:#4a4740;margin-bottom:5px}' +
    '.lw input,.lw textarea{width:100%;padding:9px 11px;border:1px solid #ded6c8;border-radius:8px;font-size:14px;' +
    'font-family:inherit;color:#1f2326;background:#fff}' +
    '.lw input:focus,.lw textarea:focus{outline:2px solid #2e7d59;outline-offset:1px}' +
    '.lw textarea{resize:vertical;min-height:70px}' +
    '.lw-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
    '.lw-btn{width:100%;background:#1f2326;color:#f7f4ef;border:none;border-radius:999px;padding:11px 16px;' +
    'font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}' +
    '.lw-btn:hover{filter:brightness(1.15)}' +
    '.lw-btn:disabled{opacity:0.6;cursor:default}' +
    '.lw-msg{font-size:13px;line-height:1.5;margin-top:10px}' +
    '.lw-msg.err{color:#c0392b}' +
    '.lw-success{text-align:center;padding:10px 0}' +
    '.lw-success-ic{font-size:28px;margin-bottom:8px}' +
    '.lw-success-title{font-size:15.5px;font-weight:700;color:#1f2326;margin-bottom:4px}' +
    '.lw-success-body{font-size:13px;color:#6d6a63;line-height:1.5}' +
    '.lw-foot{font-size:10.5px;color:#a8a49a;text-align:center;margin-top:14px}' +
    '.lw-foot a{color:#a8a49a}';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  root.appendChild(styleEl);

  var wrap = document.createElement('div');
  wrap.className = 'lw';
  wrap.innerHTML =
    '<div class="lw-title">Get in touch with ' + escapeHtml(businessName) + '</div>' +
    '<div class="lw-sub">Send an enquiry and we\'ll get back to you personally, usually the same day.</div>' +
    '<form id="lwForm">' +
      '<div class="lw-field"><label>Name</label><input id="lwName" required></div>' +
      '<div class="lw-field"><label>Phone</label><input id="lwPhone" type="tel"></div>' +
      '<div class="lw-field"><label>Email</label><input id="lwEmail" type="email"></div>' +
      '<div class="lw-field"><label>What do you need?</label><textarea id="lwMsg"></textarea></div>' +
      '<input class="lw-hp" id="lwHp" tabindex="-1" autocomplete="off">' +
      '<button class="lw-btn" type="submit">Send enquiry</button>' +
      '<div class="lw-msg" id="lwMsgOut"></div>' +
    '</form>' +
    '<div class="lw-foot">Powered by <a href="https://golocale.com.au" target="_blank" rel="noopener">Locale</a></div>';
  root.appendChild(wrap);

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var form = root.getElementById ? root.getElementById('lwForm') : root.querySelector('#lwForm');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var get = function (id) { return (root.getElementById ? root.getElementById(id) : root.querySelector('#' + id)); };
    var honeypot = get('lwHp').value;
    var msgOut = get('lwMsgOut');
    var btn = form.querySelector('.lw-btn');

    var name = get('lwName').value.trim();
    var phone = get('lwPhone').value.trim();
    var email = get('lwEmail').value.trim();
    var message = get('lwMsg').value.trim();

    msgOut.className = 'lw-msg';
    msgOut.textContent = '';

    if (!name) { msgOut.className = 'lw-msg err'; msgOut.textContent = 'Please pop in your name.'; return; }
    if (!email && !phone) { msgOut.className = 'lw-msg err'; msgOut.textContent = 'Please add an email or phone number so we can reply.'; return; }

    // Silent bot trap: a real visitor never fills this hidden field. Pretend
    // success without sending anything, so bots don't learn to work around it.
    if (honeypot) {
      showSuccess();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';

    fetch(apiBase + '/api/capture-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: businessName,
        businessOwnerEmail: ownerEmail,
        ownerId: ownerId,
        lead: { name: name, phone: phone, email: email, message: message }
      })
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('bad response')); })
      .then(function () { showSuccess(); })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Send enquiry';
        msgOut.className = 'lw-msg err';
        msgOut.textContent = "That didn't quite go through — mind trying again in a moment?";
      });

    function showSuccess() {
      wrap.innerHTML =
        '<div class="lw-success">' +
          '<div class="lw-success-ic">✓</div>' +
          '<div class="lw-success-title">Thanks — got it!</div>' +
          '<div class="lw-success-body">' + escapeHtml(businessName) + ' has been notified and will be in touch soon.</div>' +
        '</div>' +
        '<div class="lw-foot">Powered by <a href="https://golocale.com.au" target="_blank" rel="noopener">Locale</a></div>';
    }
  });
})();
