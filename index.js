const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// ============================================================
// Database Config — your byethost MySQL
// ============================================================
const DB_CONFIG = {
    host:     'sql209.byethost32.com',
    user:     'b32_41828106',
    password: '#Technology1',
    database: 'b32_41828106_jok_messages',
    waitForConnections: true,
    connectionLimit: 5,
};

let pool = null;
let sock = null;
let isReady = false;

// ============================================================
// Connect to MySQL
// ============================================================
async function connectDB() {
    try {
        pool = mysql.createPool(DB_CONFIG);
        const conn = await pool.getConnection();
        conn.release();
        console.log('✅ MySQL connected!');
    } catch (err) {
        console.error('❌ MySQL connection failed:', err.message);
        setTimeout(connectDB, 10000);
    }
}

// ============================================================
// Connect to WhatsApp
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
            if (shouldReconnect) setTimeout(connectToWhatsApp, 5000);
        }

        if (connection === 'open') {
            isReady = true;
            console.log('✅ WhatsApp connected!\n');
        }
    });
}

// ============================================================
// Send a WhatsApp message
// ============================================================
async function sendWhatsApp(phone, message) {
    const formattedPhone = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    await sock.sendMessage(formattedPhone, { text: message });
}

// ============================================================
// Process due schedules — called every 15 minutes
// ============================================================
async function processDueMessages() {
    if (!pool) { console.log('DB not ready'); return; }
    if (!isReady) { console.log('WhatsApp not ready'); return; }

    console.log('\n[' + new Date().toISOString() + '] Checking for due messages...');

    try {
        const now = new Date();
        const currentTime = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
        const today = now.toISOString().split('T')[0];

        console.log('Current time: ' + currentTime);

        // Get all pending schedules
        const [schedules] = await pool.query(`
            SELECT s.*, t.message as template_message
            FROM scheduled_messages s
            LEFT JOIN templates t ON s.template_id = t.id
            WHERE s.status = 'pending'
            AND TIME_FORMAT(s.send_time, '%H:%i') = ?
            AND (s.send_date IS NULL OR s.send_date = ?)
            AND (s.last_sent IS NULL OR DATE(s.last_sent) < ?)
        `, [currentTime, today, today]);

        console.log('Found ' + schedules.length + ' due schedules');

        for (const schedule of schedules) {
            const messageTemplate = schedule.custom_message || schedule.template_message;
            if (!messageTemplate) continue;

            // Get clients
            let clients;
            if (schedule.client_id) {
                const [rows] = await pool.query('SELECT * FROM clients WHERE id = ? AND is_active = 1', [schedule.client_id]);
                clients = rows;
            } else {
                const [rows] = await pool.query('SELECT * FROM clients WHERE is_active = 1');
                clients = rows;
            }

            console.log('Sending to ' + clients.length + ' clients...');

            for (const client of clients) {
                const message = messageTemplate
                    .replace(/{name}/g, client.name)
                    .replace(/{phone}/g, client.phone)
                    .replace(/{date}/g, today);

                let status = 'sent';
                let errorMsg = null;

                try {
                    await sendWhatsApp(client.phone, message);
                    console.log('✓ Sent to ' + client.name + ' (' + client.phone + ')');
                    await new Promise(r => setTimeout(r, 1500));
                } catch (err) {
                    status = 'failed';
                    errorMsg = err.message;
                    console.error('✗ Failed to ' + client.phone + ':', err.message);
                }

                // Log result
                await pool.query(`
                    INSERT INTO message_logs (scheduled_id, client_id, phone, message, status, error_message)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [schedule.id, client.id, client.phone, message, status, errorMsg]);
            }

            // Update last_sent
            await pool.query('UPDATE scheduled_messages SET last_sent = NOW() WHERE id = ?', [schedule.id]);

            // Mark as sent if not repeating
            if (!schedule.repeat_daily) {
                await pool.query("UPDATE scheduled_messages SET status = 'sent' WHERE id = ?", [schedule.id]);
            }
        }

        console.log('Done processing.\n');
    } catch (err) {
        console.error('Error processing schedules:', err.message);
    }
}

// ============================================================
// API Endpoints
// ============================================================

// Health check
app.get('/status', (req, res) => {
    res.json({ ready: isReady, service: 'JOK Messages Sender', version: '3.0.0' });
});

// Trigger message processing (called by cron-job.org)
app.get('/process', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== 'jok_secret_2024') {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    await processDueMessages();
    res.json({ success: true, message: 'Processing complete' });
});

// Send single message manually
app.post('/send', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ success: false, error: 'Phone and message required' });
    if (!isReady) return res.status(503).json({ success: false, error: 'WhatsApp not ready' });
    try {
        await sendWhatsApp(phone, message);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ============================================================
// Start everything
// ============================================================
app.listen(PORT, async () => {
    console.log('\n🚀 JOK Messages Sender v3.0 running on port ' + PORT);
    await connectDB();
    await connectToWhatsApp();

    // Also run every 15 minutes internally as backup
    setInterval(processDueMessages, 15 * 60 * 1000);
});
