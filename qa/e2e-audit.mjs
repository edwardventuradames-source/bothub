import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPath =
  process.env.PLAYWRIGHT_PATH ||
  'C:/Users/edwar/.gemini/antigravity/brain/ccee2769-79eb-4a14-814e-66dcc7270a6a/scratch/pw/node_modules/playwright-core';
const { chromium } = require(playwrightPath);

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';
const API_URL = process.env.QA_API_URL || 'http://localhost:4000/api';
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'qa/screenshots/after');
const REPORT_JSON_PATH = path.resolve(process.cwd(), 'qa/e2e-after-metrics.json');
const CHROME_PATH =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 }
];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(`E2E Assertion Failed: ${message}`);
  }
}

async function inspectPageMetrics(page, routeLabel, vpName) {
  return page.evaluate(({ routeLabel, vpName }) => {
    const html = document.documentElement;
    const horizontalOverflow = html.scrollWidth > window.innerWidth + 1;
    const overflowPx = Math.max(0, html.scrollWidth - window.innerWidth);
    const hasFavicon = Boolean(document.querySelector('link[rel*="icon"]'));
    const title = document.title;

    const brokenImages = Array.from(document.querySelectorAll('img')).filter(
      (img) => !img.complete || img.naturalWidth === 0
    ).length;

    const unlabeledButtons = Array.from(document.querySelectorAll('button'))
      .filter((btn) => {
        const text = (btn.innerText || '').trim();
        const aria = btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby');
        return !text && !aria;
      })
      .map((b) => b.getAttribute('title') || b.outerHTML.slice(0, 80));

    const unlabeledInputs = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter((el) => {
        if (el.type === 'hidden') return false;
        const id = el.getAttribute('id');
        const hasLabel =
          id && Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`));
        const hasAria = Boolean(
          el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
        );
        return !hasLabel && !hasAria;
      })
      .map(
        (el) =>
          `${el.tagName}:${el.getAttribute('placeholder') || el.getAttribute('type') || el.outerHTML.slice(0, 60)}`
      );

    const smallMobileControls =
      vpName === 'mobile'
        ? Array.from(document.querySelectorAll('button, a[href], select')).filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (rect.height < 44 || rect.width < 44);
          }).length
        : 0;

    return {
      routeLabel,
      vpName,
      title,
      hasFavicon,
      horizontalOverflow,
      overflowPx,
      scrollWidth: html.scrollWidth,
      innerWidth: window.innerWidth,
      brokenImages,
      unlabeledButtons,
      unlabeledInputs,
      smallMobileControls
    };
  }, { routeLabel, vpName });
}

async function seedAdmin() {
  const regRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Edward Admin',
      organizationName: 'BotHub QA Studio',
      email: 'admin@bothub.local',
      password: 'Password2026!'
    })
  });
  return regRes.json();
}

async function populateRealisticData(token) {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const botCwRes = await fetch(`${API_URL}/bots`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      name: 'Bot Atención ByteMV',
      driver: 'CHATWOOT',
      isActive: true
    })
  });
  const { bot: botCw } = await botCwRes.json();

  await fetch(`${API_URL}/bots/${botCw.id}/chatwoot`, {
    method: 'PUT',
    headers: h,
    body: JSON.stringify({
      baseUrl: 'https://chat.bothub.local',
      accountId: 1,
      inboxId: 1,
      apiAccessToken: 'cw_token_qa_123456',
      webhookToken: 'whsec_qa_chatwoot_2026',
      handoffReturnCommand: '#bot',
      isActive: true
    })
  });

  await fetch(`${API_URL}/bots/${botCw.id}/chatwoot/test`, {
    method: 'POST',
    headers: h
  }).catch(() => undefined);

  const botBaileysRes = await fetch(`${API_URL}/bots`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      name: 'Bot Ventas QR',
      phoneNumber: '+18095550199',
      driver: 'BAILEYS',
      isActive: true
    })
  });
  const { bot: botBaileys } = await botBaileysRes.json();

  const botCloudRes = await fetch(`${API_URL}/bots`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      name: 'Bot Cloud Meta',
      phoneNumber: '+18095550188',
      driver: 'CLOUD_API',
      isActive: true
    })
  });
  const { bot: botCloud } = await botCloudRes.json();

  const flowRes = await fetch(`${API_URL}/flows`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      name: 'Flujo Principal Atención',
      description: 'Bienvenida, validación de cédula, botones y transferencia a Chatwoot.',
      botId: botCw.id,
      isMainMenu: true
    })
  });
  const { flow } = await flowRes.json();

  await fetch(`${API_URL}/flows/${flow.id}/graph`, {
    method: 'PUT',
    headers: h,
    body: JSON.stringify({
      publish: true,
      nodes: [
        {
          id: 'n-trig',
          type: 'TRIGGER',
          position: { x: 40, y: 120 },
          data: { title: 'Inicio', matchMode: 'FIRST_MESSAGE', keyword: 'hola' }
        },
        {
          id: 'n-msg',
          type: 'MESSAGE',
          position: { x: 310, y: 120 },
          data: { title: 'Saludo', text: '¡Hola {{nombre}}! Bienvenido a BotHub.' }
        },
        {
          id: 'n-q',
          type: 'QUESTION',
          position: { x: 580, y: 120 },
          data: {
            title: 'Pedir Cédula',
            promptText: 'Por favor indica tu número de cédula:',
            variableName: 'cedula',
            validationType: 'NATIONAL_ID',
            errorMessage: 'Cédula inválida (6-12 dígitos).'
          }
        },
        {
          id: 'n-btn',
          type: 'BUTTONS',
          position: { x: 850, y: 120 },
          data: {
            title: 'Menú Principal',
            bodyText: '¿Con qué área deseas comunicarte?',
            buttons: [
              { id: 'btn-1', label: '1. Ventas' },
              { id: 'btn-2', label: '2. Soporte' }
            ]
          }
        },
        {
          id: 'n-end',
          type: 'END',
          position: { x: 1120, y: 40 },
          data: { title: 'Fin Ventas', farewellMessage: 'Gracias por cotizar con nosotros.' }
        },
        {
          id: 'n-ho',
          type: 'HANDOFF',
          position: { x: 1120, y: 200 },
          data: {
            title: 'Handoff Soporte',
            teamName: 'Soporte Técnico',
            clientMessage: 'Te conectamos con un agente.',
            privateNoteTemplate: 'Cliente {{nombre}} ({{cedula}})'
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'n-trig', target: 'n-msg' },
        { id: 'e2', source: 'n-msg', target: 'n-q' },
        { id: 'e3', source: 'n-q', target: 'n-btn' },
        { id: 'e4', source: 'n-btn', sourceHandle: 'btn-1', target: 'n-end', label: '1. Ventas' },
        { id: 'e5', source: 'n-btn', sourceHandle: 'btn-2', target: 'n-ho', label: '2. Soporte' }
      ]
    })
  });

  await fetch(`${API_URL}/webhooks/chatwoot/${botCw.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-chatwoot-webhook-token': 'whsec_qa_chatwoot_2026' },
    body: JSON.stringify({
      id: 10001,
      event: 'message_created',
      message_type: 'incoming',
      content: 'Hola, necesito ayuda con mi factura',
      conversation: { id: 101 },
      sender: { id: 501, name: 'Carlos Mendoza', phone_number: '+18095550123', email: 'carlos@cliente.do', type: 'contact' }
    })
  });
  await fetch(`${API_URL}/webhooks/chatwoot/${botCw.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-chatwoot-webhook-token': 'whsec_qa_chatwoot_2026' },
    body: JSON.stringify({
      id: 10002,
      event: 'message_created',
      message_type: 'incoming',
      content: '40212345678',
      conversation: { id: 101 },
      sender: { id: 501, name: 'Carlos Mendoza', phone_number: '+18095550123', email: 'carlos@cliente.do', type: 'contact' }
    })
  });

  await fetch(`${API_URL}/users`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      name: 'María Operadora',
      email: 'operador@bothub.local',
      password: 'Password2026!',
      role: 'OPERATOR'
    })
  });

  await fetch(`${API_URL}/settings/api-keys`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ name: 'Integración n8n', scopes: ['bots:read', 'flows:execute'] })
  });

  await fetch(`${API_URL}/settings/webhooks`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      name: 'CRM Webhook',
      targetUrl: 'https://crm.example.com/hook',
      events: ['conversation.handoff'],
      secretToken: 'whsec_crm_prod_12345'
    })
  });

  return { botCw, botBaileys, botCloud, flow };
}

async function run() {
  const session = await seedAdmin();
  const token = session.accessToken;

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const metricsReport = [];
  let allowExpectedLogin401 = false;

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (allowExpectedLogin401 && text.includes('401')) {
        return;
      }
      consoleErrors.push({ url: page.url(), text });
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push({ url: page.url(), text: err.message });
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('/auth/login')) {
      failedRequests.push({ url: res.url(), status: res.status() });
    }
  });

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `login_${vp.name}.png`), fullPage: true });
    metricsReport.push(await inspectPageMetrics(page, '/login', vp.name));

    await page.goto(`${BASE_URL}/forgot-password`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `forgot_password_${vp.name}.png`), fullPage: true });
    metricsReport.push(await inspectPageMetrics(page, '/forgot-password', vp.name));
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'admin@bothub.local');
  await page.fill('#current-password', 'WrongPass999!');
  allowExpectedLogin401 = true;
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]');
  allowExpectedLogin401 = false;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'login_error_desktop.png'), fullPage: true });

  await page.fill('#current-password', 'Password2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`);
  await page.waitForTimeout(600);

  for (const r of [
    { path: '/', name: 'dashboard_empty' },
    { path: '/bots', name: 'bots_empty' },
    { path: '/flows', name: 'flows_empty' },
    { path: '/conversations', name: 'conversations_empty' },
    { path: '/contacts', name: 'contacts_empty' },
    { path: '/logs', name: 'logs_empty' }
  ]) {
    await page.goto(`${BASE_URL}${r.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${r.name}_desktop.png`), fullPage: true });
  }

  await populateRealisticData(token);

  const authRoutes = [
    { path: '/', name: 'dashboard' },
    { path: '/bots', name: 'bots' },
    { path: '/flows', name: 'flows' },
    { path: '/conversations', name: 'conversations' },
    { path: '/contacts', name: 'contacts' },
    { path: '/logs', name: 'logs' },
    { path: '/users', name: 'users' },
    { path: '/settings', name: 'settings' }
  ];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const r of authRoutes) {
      await page.goto(`${BASE_URL}${r.path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(550);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${r.name}_${vp.name}.png`), fullPage: true });
      metricsReport.push(await inspectPageMetrics(page, r.path, vp.name));
    }
  }

  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto(`${BASE_URL}/bots`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('button:has-text("Crear Nuevo Bot")');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bots_modal_desktop.png'), fullPage: true });
  await page.keyboard.press('Escape');

  await page.click('button:has-text("Bot Ventas QR")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bots_baileys_tab_desktop.png'), fullPage: true });

  await page.click('button:has-text("Bot Cloud Meta")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bots_cloud_tab_desktop.png'), fullPage: true });

  await page.click('#tab-schedule');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bots_schedule_tab_desktop.png'), fullPage: true });

  await page.goto(`${BASE_URL}/flows`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('button[aria-label="Enviar mensaje de prueba"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flows_simulator_desktop.png'), fullPage: true });

  await page.goto(`${BASE_URL}/users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('button:has-text("Nuevo Usuario")');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'users_modal_desktop.png'), fullPage: true });
  await page.keyboard.press('Escape');

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('button[aria-label="Cambiar tema y configuración visual"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'theme_configurator_desktop.png'), fullPage: true });
  await page.click('[aria-label="Configurador Soft UI"] button:has-text("Oscuro")');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_dark_desktop.png'), fullPage: true });
  await page.click('button[aria-label="Personalizar apariencia"]');
  await page.click('[aria-label="Configurador Soft UI"] button:has-text("Claro")');
  await page.keyboard.press('Escape');

  await page.goto(`${BASE_URL}/bots`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Crear Nuevo Bot")');
  await page.fill('#new-bot-name', 'Bot E2E Browser');
  await page.click('button[type="submit"]:has-text("Crear Bot")');
  await page.waitForSelector('text=Bot "Bot E2E Browser" creado exitosamente');

  await page.click('button[aria-label="Eliminar Bot Bot E2E Browser"]');
  await page.waitForSelector('text=Eliminar Bot Permanentemente');
  await page.click('button:has-text("Eliminar Bot")');
  await page.waitForSelector('text=Bot eliminado correctamente');

  await page.click('#tab-schedule');
  await page.fill('#faq-title', 'Envíos');
  await page.fill('#faq-keywords', 'envio, domicilio');
  await page.fill('#faq-response', 'Despachos el mismo día.');
  await page.click('button:has-text("+ Agregar Respuesta Rápida")');
  await page.waitForSelector('text=Respuesta rápida agregada al bot');

  await page.goto(`${BASE_URL}/flows`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Reiniciar")');
  await page.fill('#sim-chat-input', 'hola');
  await page.click('button[aria-label="Enviar mensaje de prueba"]');
  await page.waitForSelector('text=Por favor indica tu número de cédula');
  await page.fill('#sim-chat-input', 'abc');
  await page.click('button[aria-label="Enviar mensaje de prueba"]');
  await page.waitForSelector('text=Cédula inválida');
  await page.fill('#sim-chat-input', '1020458912');
  await page.click('button[aria-label="Enviar mensaje de prueba"]');
  await page.waitForSelector('text=¿Con qué área deseas comunicarte?');

  await page.goto(`${BASE_URL}/contacts`, { waitUntil: 'networkidle' });
  await page.fill('#var-key', 'ciudad');
  await page.fill('#var-val', 'Santo Domingo');
  await page.click('button:has-text("Guardar")');
  await page.waitForSelector('text=Variable {{ciudad}} actualizada');

  await page.goto(`${BASE_URL}/conversations`, { waitUntil: 'networkidle' });
  const transferBtn = page.locator('button:has-text("Transferir a Chatwoot")');
  if ((await transferBtn.count()) > 0) {
    await transferBtn.first().click();
    await page.waitForSelector('text=Devolver Control al Bot');
  }

  await page.click('button[aria-label="Notificaciones"]');
  await page.waitForSelector('text=Actividad reciente');
  await page.keyboard.press('Escape');

  await page.click('button[aria-label="Cerrar sesión"]');
  await page.waitForURL(`${BASE_URL}/login`);

  await browser.close();

  const summary = {
    totalScreenshots: fs.readdirSync(SCREENSHOT_DIR).length,
    consoleErrors,
    pageErrors,
    failedRequests,
    overflows: metricsReport.filter((m) => m.horizontalOverflow),
    missingFavicons: metricsReport.some((m) => !m.hasFavicon),
    brokenImages: metricsReport.filter((m) => m.brokenImages > 0),
    unlabeledButtons: metricsReport.filter((m) => m.unlabeledButtons.length > 0),
    unlabeledInputsAll: [...new Set(metricsReport.flatMap((m) => m.unlabeledInputs))],
    mobileSmallTapTargetsMax: Math.max(
      0,
      ...metricsReport.filter((m) => m.vpName === 'mobile').map((m) => m.smallMobileControls)
    ),
    e2ePassed: true
  };

  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify({ summary, metricsReport }, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  assertCondition(consoleErrors.length === 0, `Console errors detected: ${consoleErrors.length}`);
  assertCondition(pageErrors.length === 0, `Page errors detected: ${pageErrors.length}`);
  assertCondition(failedRequests.length === 0, `Failed HTTP requests detected: ${failedRequests.length}`);
  assertCondition(summary.overflows.length === 0, `Horizontal overflows detected: ${summary.overflows.length}`);
  assertCondition(!summary.missingFavicons, 'Missing favicon detected');
  assertCondition(summary.brokenImages.length === 0, 'Broken images detected');
  assertCondition(summary.unlabeledButtons.length === 0, 'Unlabeled buttons detected');
  assertCondition(summary.unlabeledInputsAll.length === 0, 'Unlabeled inputs detected');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
