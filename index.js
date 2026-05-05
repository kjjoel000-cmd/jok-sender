const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'jok-messages' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--js-flags=--max-old-space-size=256'
        ]
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
    console.log('✅ WhatsApp client is ready!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    isReady = false;
});

client.on('disconnected', (reason) => {
    console.log('⚠️ WhatsApp disconnected:', reason);
    isReady = false;
    setTimeout(() => client.initialize(), 5000);
});

client.initialize();

app.get('/status', (req, res) => {
    res.json({ ready: isReady, service: 'JOK Messages Sender' });
});

app.post('/send', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ success: false, error: 'Phone and message required' });
    if (!isReady) return res.status(503).json({ success: false, error: 'WhatsApp not ready' });
    try {
        const chatId = phone.replace(/\D/g, '') + '@c.us';
        await client.sendMessage(chatId, message);
        console.log('✓ Sent to ' + phone);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log('🚀 JOK Sender running on port ' + PORT);
});
