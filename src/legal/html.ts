const CONTACT_EMAIL =
  (process.env.LEGAL_CONTACT_EMAIL || process.env.ADMIN_EMAIL || 'kriovent.support@gmail.com').trim();

const APP_NAME = 'Expenso';
const PACKAGE_ID = 'com.kriovent.expenso';
const LAST_UPDATED = '4 August 2026';

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · ${APP_NAME}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.55;
      background: #0f1419;
      color: #e8eef4;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 28px 20px 64px; }
    h1 { font-size: 1.75rem; margin: 0 0 8px; letter-spacing: -0.02em; }
    h2 { font-size: 1.1rem; margin: 28px 0 10px; color: #9fd4ff; }
    p, li { color: #c5d0da; font-size: 0.98rem; }
    .meta { color: #8a9aaa; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7ec8ff; }
    nav { margin-bottom: 20px; font-size: 0.9rem; }
    nav a { margin-right: 14px; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    ul { padding-left: 1.2rem; }
    .card {
      background: #171e26;
      border: 1px solid #243040;
      border-radius: 14px;
      padding: 18px 18px 6px;
    }
    footer { margin-top: 36px; color: #7a8a99; font-size: 0.85rem; }
    label { display: block; margin: 16px 0 6px; font-size: 0.9rem; color: #c5d0da; font-weight: 600; }
    input[type="email"], input[type="password"] {
      width: 100%;
      box-sizing: border-box;
      padding: 11px 12px;
      border-radius: 10px;
      border: 1px solid #2c3a4a;
      background: #0f1419;
      color: #e8eef4;
      font-size: 0.98rem;
    }
    input:focus { outline: 2px solid #4a9eff; outline-offset: 1px; }
    .checkbox-row { display: flex; align-items: flex-start; gap: 10px; margin: 18px 0; }
    .checkbox-row input { margin-top: 4px; }
    .checkbox-row label { margin: 0; font-weight: 400; color: #c5d0da; }
    button {
      width: 100%;
      padding: 13px;
      margin-top: 8px;
      border: none;
      border-radius: 10px;
      background: #e5484d;
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    #result { margin-top: 16px; font-size: 0.95rem; white-space: pre-wrap; }
    #result.ok { color: #6fd48c; }
    #result.err { color: #ff8a8a; }
    .warn-box {
      background: #241318;
      border: 1px solid #5a2530;
      border-radius: 10px;
      padding: 12px 14px;
      margin: 16px 0;
    }
    .warn-box p { margin: 0; color: #ffb4b4; font-size: 0.92rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/delete-account">Delete Account</a>
      <a href="/health">API health</a>
    </nav>
    <div class="card">
      ${body}
    </div>
    <footer>
      ${APP_NAME} (${PACKAGE_ID}) · Contact:
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
    </footer>
  </div>
</body>
</html>`;
}

export function privacyPolicyHtml(): string {
  const body = `
    <h1>Privacy Policy</h1>
    <p class="meta">Last updated: ${LAST_UPDATED}</p>
    <p>
      This Privacy Policy explains how <strong>${APP_NAME}</strong> (“we”, “us”) collects,
      uses, and shares information when you use our mobile app and related services
      (including our API hosted on Render).
    </p>

    <h2>1. Information we collect</h2>
    <ul>
      <li><strong>Account data</strong> — name, email address, and password (stored hashed).</li>
      <li><strong>Expense data</strong> — amounts, merchants, categories, notes, dates, budgets,
        and joint/group expense details you create.</li>
      <li><strong>Device &amp; notifications</strong> — push notification tokens (FCM) and basic
        device identifiers needed for password-reset device checks and delivery of notifications.</li>
      <li><strong>Support &amp; feedback</strong> — messages you send via in-app support, feedback,
        or password-reset requests.</li>
      <li><strong>Assistant usage</strong> — Ask Expenso chat inputs/outputs and usage counters
        (including optional AI processing when enabled).</li>
      <li><strong>Purchases</strong> — subscription / in-app purchase status verified with
        Google Play or Apple (we do not store your full payment card details).</li>
      <li><strong>App preferences</strong> — themes, notification preferences, and similar settings
        synced to your account where applicable. App Lock PIN / biometrics stay on your device.</li>
    </ul>

    <h2>2. How we use information</h2>
    <ul>
      <li>Provide account login, sync, joint expenses, analytics in the app, and exports.</li>
      <li>Send notifications you enable (for example joint expense alerts).</li>
      <li>Operate Ask Expenso (rules-based answers and, when configured, AI fallback).</li>
      <li>Verify Pro / theme purchases and restore entitlements.</li>
      <li>Respond to support tickets and improve product quality and safety.</li>
    </ul>

    <h2>3. Third-party services</h2>
    <p>We use trusted processors to run the service, which may process data on our behalf:</p>
    <ul>
      <li>Cloud hosting (e.g. Render)</li>
      <li>Database hosting (MongoDB Atlas)</li>
      <li>Firebase Cloud Messaging for push notifications</li>
      <li>Google Play Billing / Apple In-App Purchase for payments</li>
      <li>Optional AI providers (e.g. Gemini / Groq / Hugging Face) when Ask Expenso uses AI fallback</li>
    </ul>
    <p>These providers process data under their own privacy terms and our instructions.</p>

    <h2>4. Data sharing</h2>
    <p>
      We do not sell your personal information. We share data only as needed to operate the app
      (processors above), to comply with law, or to protect ${APP_NAME} and our users.
      Joint/group features share relevant expense data with members of that group.
    </p>

    <h2>5. Retention &amp; deletion</h2>
    <p>
      We keep account and expense data while your account is active. You may delete your account
      and all associated data at any time from inside the app, via our
      <a href="/delete-account">account deletion page</a> (no app install required), or by
      contacting us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
      After deletion, we remove or anonymize personal data except where we must retain limited
      records for legal, security, or billing reasons.
    </p>

    <h2>6. Security</h2>
    <p>
      We use industry-standard measures such as HTTPS in production, hashed passwords, and
      access controls. No method of transmission or storage is 100% secure.
    </p>

    <h2>7. Children’s privacy</h2>
    <p>
      ${APP_NAME} is not directed to children under 13 (or the minimum age required in your
      country). We do not knowingly collect data from children.
    </p>

    <h2>8. Your choices</h2>
    <ul>
      <li>Update profile and notification preferences in the app.</li>
      <li>Disable notifications in system settings.</li>
      <li>Request account/data deletion via support or available in-app controls.</li>
    </ul>

    <h2>9. Changes</h2>
    <p>
      We may update this policy. The “Last updated” date above will change when we do.
      Continued use after changes means you accept the updated policy.
    </p>

    <h2>10. Contact</h2>
    <p>
      Questions about privacy:
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
    </p>
  `;
  return layout('Privacy Policy', body);
}

export function termsOfServiceHtml(): string {
  const body = `
    <h1>Terms of Service</h1>
    <p class="meta">Last updated: ${LAST_UPDATED}</p>
    <p>
      These Terms of Service (“Terms”) govern your use of <strong>${APP_NAME}</strong>
      (package <code>${PACKAGE_ID}</code>), including our mobile app and backend API.
      By creating an account or using the app, you agree to these Terms and our
      <a href="/privacy">Privacy Policy</a>.
    </p>

    <h2>1. The service</h2>
    <p>
      ${APP_NAME} helps you track personal and joint expenses, view analytics, use voice/manual
      entry, optional Ask Expenso assistance, themes, and Pro features. Features may change over time.
    </p>

    <h2>2. Accounts</h2>
    <ul>
      <li>You must provide accurate registration information and keep your password secure.</li>
      <li>You are responsible for activity under your account.</li>
      <li>We may suspend or terminate accounts that abuse the service, break the law, or harm others.</li>
    </ul>

    <h2>3. Acceptable use</h2>
    <ul>
      <li>Do not misuse the API, attempt unauthorized access, or disrupt the service.</li>
      <li>Do not upload unlawful, harmful, or infringing content.</li>
      <li>Do not reverse engineer the app except where allowed by law.</li>
    </ul>

    <h2>4. Subscriptions &amp; purchases</h2>
    <ul>
      <li>Pro plans and paid themes are sold through Google Play or the App Store.</li>
      <li>Prices are shown in the store / paywall and may change for future purchases.</li>
      <li>Billing, renewals, refunds, and cancellations are handled by the platform store
        under their policies. Manage or cancel subscriptions in your store account settings.</li>
      <li>Restoring purchases may require the same store account used to buy.</li>
    </ul>

    <h2>5. Ask Expenso &amp; AI</h2>
    <p>
      Ask Expenso may use rules and, when configured, third-party AI models. Answers can be
      incomplete or incorrect — they are guidance only, not financial, tax, or legal advice.
      Do not share sensitive secrets in chat that you would not want processed by our systems
      or AI providers.
    </p>

    <h2>6. Your content</h2>
    <p>
      You retain ownership of expense and other content you submit. You grant us a limited
      license to host, process, and display that content solely to provide the service
      (including joint groups you join).
    </p>

    <h2>7. Disclaimer</h2>
    <p>
      The service is provided “as is” and “as available”. We do not guarantee uninterrupted
      or error-free operation (including free-tier hosting cold starts). To the fullest extent
      permitted by law, we disclaim warranties of merchantability, fitness for a particular
      purpose, and non-infringement.
    </p>

    <h2>8. Limitation of liability</h2>
    <p>
      To the fullest extent permitted by law, ${APP_NAME} and its operators are not liable for
      indirect, incidental, special, consequential, or punitive damages, or for loss of data,
      profits, or business arising from your use of the service. Our total liability for any
      claim is limited to the greater of amounts you paid us for the service in the 12 months
      before the claim or INR 1,000, except where liability cannot be limited by law.
    </p>

    <h2>9. Termination</h2>
    <p>
      You may stop using the app and request account deletion at any time. We may stop
      providing the service or terminate access for breach of these Terms.
    </p>

    <h2>10. Changes</h2>
    <p>
      We may update these Terms. Material changes will be reflected by updating the date above
      and/or notifying you in the app where practical. Continued use means you accept the updated Terms.
    </p>

    <h2>11. Contact</h2>
    <p>
      Questions about these Terms:
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
    </p>
  `;
  return layout('Terms of Service', body);
}

export function deleteAccountHtml(): string {
  const body = `
    <h1>Delete your ${APP_NAME} account</h1>
    <p>
      Use this page to permanently delete your ${APP_NAME} account and all data associated
      with it — even if you no longer have the app installed. Sign in with your account
      email and password to confirm it's you; deletion happens immediately and cannot be undone.
    </p>

    <div class="warn-box">
      <p>
        <strong>This deletes, instantly and permanently:</strong> your profile, all personal
        and joint expenses, budgets, custom categories, Ask Expenso usage history, joint/group
        membership, and any pending support or password-reset requests. Pro/theme purchase
        records with the app store are not affected by this — manage subscriptions from
        Google Play / App Store.
      </p>
    </div>

    <form id="delete-form" autocomplete="off">
      <label for="email">Account email</label>
      <input type="email" id="email" name="email" required autocomplete="username" />

      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password" />

      <div class="checkbox-row">
        <input type="checkbox" id="confirm" name="confirm" required />
        <label for="confirm">
          I understand this permanently deletes my account and all my data, and cannot be undone.
        </label>
      </div>

      <button type="submit" id="submit-btn">Delete my account and all data</button>
    </form>

    <div id="result" role="status"></div>

    <script>
      (function () {
        var form = document.getElementById('delete-form');
        var btn = document.getElementById('submit-btn');
        var result = document.getElementById('result');

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var confirmed = document.getElementById('confirm').checked;
          if (!confirmed) return;

          var email = document.getElementById('email').value.trim();
          var password = document.getElementById('password').value;

          result.className = '';
          result.textContent = '';
          btn.disabled = true;
          btn.textContent = 'Deleting…';

          fetch('/api/auth/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password }),
          })
            .then(function (res) {
              return res.json().then(function (data) {
                return { ok: res.ok, data: data };
              });
            })
            .then(function (r) {
              if (r.ok) {
                result.className = 'ok';
                result.textContent = '✅ ' + (r.data.message || 'Your account and all data have been deleted.');
                form.style.display = 'none';
              } else {
                result.className = 'err';
                result.textContent = '⚠️ ' + (r.data.error || 'Could not delete account.');
                btn.disabled = false;
                btn.textContent = 'Delete my account and all data';
              }
            })
            .catch(function () {
              result.className = 'err';
              result.textContent = "⚠️ Couldn't connect. Please check your internet and try again.";
              btn.disabled = false;
              btn.textContent = 'Delete my account and all data';
            });
        });
      })();
    </script>

    <p style="margin-top:24px;">
      Prefer email instead? Contact <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
      from your account email and we'll delete it for you.
    </p>
  `;
  return layout('Delete Account', body);
}
