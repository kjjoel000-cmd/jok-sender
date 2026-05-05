// ============================================================
// JOK MESSAGES - WhatsApp Sender Service (Node.js)
// ============================================================
// SETUP:
//   1. cd into this folder (sender/)
//   2. npm install
//   3. node index.js
//   4. Scan the QR code with your WhatsApp Business account
//   5. Service runs on http://localhost:3001
// ============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');

const app  = express();
const PORT = 3001;

app.use(express.json());

// ============================================================
// WhatsApp Client Setup
// ============================================================
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'jok-messages' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let isReady = false;

client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code with your WhatsApp Business app:\n');
    qrcode.generate(qr, { small: true });
    console.log('\nWaiting for scan...\n');
});

client.on('ready', () => {
    isReady = true;
    console.log('✅ WhatsApp client is ready! JOK Messages sender is live.\n');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    isReady = false;
});

client.on('disconnected', (reason) => {
    console.log('⚠️  WhatsApp disconnected:', reason);
    isReady = false;
    // Auto-reconnect
    setTimeout(() => client.initialize(), 5000);
});

client.initialize();

// ============================================================
// API Endpoints
// ============================================================

// Health check
app.get('/status', (req, res) => {
    res.json({ ready: isReady, service: 'JOK Messages Sender', version: '1.0.0' });
});

// Send a message
app.post('/send', async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'Phone and message are required' });
    }

    if (!isReady) {
        return res.status(503).json({ success: false, error: 'WhatsApp client not ready. Please scan QR code.' });
    }

    try {
        // Format phone: must be in international format without +
        const formattedPhone = phone.replace(/\D/g, '');
        const chatId = formattedPhone + '@c.us';

        // Check if number exists on WhatsApp
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.json({ success: false, error: 'Phone number not registered on WhatsApp' });
        }

        await client.sendMessage(chatId, message);
        console.log(`✓ Message sent to ${formattedPhone}`);
        res.json({ success: true, message: 'Message sent successfully' });

    } catch (err) {
        console.error(`✗ Failed to send to ${phone}:`, err.message);
        res.json({ success: false, error: err.message });
    }
});

// Send to multiple recipients
app.post('/send-bulk', async (req, res) => {
    const { recipients, message } = req.body; // recipients = array of phone numbers

    if (!recipients || !Array.isArray(recipients) || !message) {
        return res.status(400).json({ success: false, error: 'Recipients array and message required' });
    }

    if (!isReady) {
        return res.status(503).json({ success: false, error: 'WhatsApp client not ready' });
    }

    const results = [];

    for (const phone of recipients) {
        try {
            const formattedPhone = phone.replace(/\D/g, '');
            const chatId = formattedPhone + '@c.us';
            await client.sendMessage(chatId, message);
            results.push({ phone, status: 'sent' });
            console.log(`✓ Bulk sent to ${formattedPhone}`);
            // Delay between messages to avoid spam detection
            await new Promise(r => setTimeout(r, 1500));
        } catch (err) {
            results.push({ phone, status: 'failed', error: err.message });
            console.error(`✗ Bulk failed to ${phone}:`, err.message);
        }
    }

    res.json({ success: true, results });
});

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => {
    console.log(`\n🚀 JOK Messages Sender running on http://localhost:${PORT}`);
    console.log('Initializing WhatsApp connection...\n');
});
