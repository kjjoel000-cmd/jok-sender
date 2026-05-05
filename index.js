// ============================================================
// JOK MESSAGES - WhatsApp Sender (Baileys - No Chrome Needed)
// ============================================================

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode-terminal');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

let sock = null;
let isReady = false;

// ============================================================
// Start WhatsApp Connection
// ============================================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 Scan this QR code with your WhatsApp Business:\n');
            qrcode.generate(qr, { small: true });
            console.log('\nWaiting for scan...\n');
        }

        if (connection === 'close') {
            isReady = false;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                console.log('Logged out. Delete auth_info folder and restart.');
            }
        }

        if (connection === 'open') {
            isReady = true;
            console.log('✅ WhatsApp connected! JOK Messages is ready.\n');
        }
    });
}

connectToWhatsApp();

// ============================================================
// API Endpoints
// ============================================================

app.get('/status', (req, res) => {
    res.json({ ready: isReady, service: 'JOK Messages Sender', version: '2.0.0' });
});

app.post('/send', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ success: false, error: 'Phone and message are required' });
    if (!isReady) return res.status(503).json({ success: false, error: 'WhatsApp not connected. Scan QR code first.' });
    try {
        const formattedPhone = phone.replace(/\D/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(formattedPhone, { text: message });
        console.log('✓ Sent to ' + phone);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/send-bulk', async (req, res) => {
    const { recipients, message } = req.body;
    if (!recipients || !Array.isArray(recipients) || !message) return res.status(400).json({ success: false, error: 'Recipients and message required' });
    if (!isReady) return res.status(503).json({ success: false, error: 'WhatsApp not connected' });
    const results = [];
    for (const phone of recipients) {
        try {
            const formattedPhone = phone.replace(/\D/g, '') + '@s.whatsapp.net';
            await sock.sendMessage(formattedPhone, { text: message });
            results.push({ phone, status: 'sent' });
            await new Promise(r => setTimeout(r, 1500));
        } catch (err) {
            results.push({ phone, status: 'failed', error: err.message });
        }
    }
    res.json({ success: true, results });
});

app.listen(PORT, () => {
    console.log('\n🚀 JOK Sender running on port ' + PORT);
    console.log('Connecting to WhatsApp...\n');
});
