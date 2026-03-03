const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.static(__dirname));
app.use(express.json());

// ==================== API ANAHTARLARI ====================
// DİKKAT: Bu anahtarlar kodda tutulmaz, ortam değişkenlerinden okunur.
const API_KEYS = {
    GEMINI: process.env.GEMINI_API_KEY,
    GROQ: process.env.GROQ_API_KEY,
    OPENROUTER: process.env.OPENROUTER_API_KEY,
    TOGETHER: process.env.TOGETHER_API_KEY
};

const AI_PROMPT = (category, count) => `T\u00fcrk\u00e7e trivia sorular\u0131 \u00fcret. Kategori: ${category}

KURALLAR:
- TAM OLARAK ${count} soru \u00fcret
- Sadece JSON format\u0131nda yan\u0131t ver
- Ba\u015fka hi\u00e7bir a\u00e7\u0131klama yazma

JSON FORMAT:
[
  {
    "id": 1,
    "c": "${category}",
    "q": "Soru metni buraya",
    "o": [
       {"id": "A", "t": "\u015e\u0131k A"},
       {"id": "B", "t": "\u015e\u0131k B"},
       {"id": "C", "t": "\u015e\u0131k C"},
       {"id": "D", "t": "\u015e\u0131k D"}
    ],
    "a": "A"
  }
]`;

function extractJSON(text) {
    let str = text.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const first = str.indexOf('[');
    const last = str.lastIndexOf(']');
    if (first === -1 || last === -1) throw new Error('JSON formati hatali');
    str = str.substring(first, last + 1);
    const parsed = JSON.parse(str);
    if (!Array.isArray(parsed) || parsed.length < 5) {
        throw new Error(`Yetersiz soru: ${parsed.length}`);
    }
    return parsed;
}

async function fetchFromGroq(model, category, count) {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEYS.GROQ}` },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: "Sen bir trivia soru ureticisisin. Sadece JSON formatinda yanit veriyorsun." },
                { role: "user", content: AI_PROMPT(category, count) }
            ],
            temperature: 0.7, max_tokens: 8000
        })
    });
    if (!resp.ok) throw new Error(`GROQ ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("GROQ yaniti bos");
    return extractJSON(text);
}

async function fetchFromGemini(model, category, count) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEYS.GEMINI}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: AI_PROMPT(category, count) }] }] })
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini yaniti bos");
    return extractJSON(text);
}

async function fetchFromOpenRouter(model, category, count) {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEYS.OPENROUTER}`,
            "Content-Type": "application/json",
            "X-Title": "Mind Arena"
        },
        body: JSON.stringify({
            model, messages: [{ role: "user", content: AI_PROMPT(category, count) }], temperature: 0.7
        })
    });
    if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenRouter yaniti bos");
    return extractJSON(text);
}

async function fetchFromTogether(model, category, count) {
    const resp = await fetch("https://api.together.xyz/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${API_KEYS.TOGETHER}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model, messages: [{ role: "user", content: AI_PROMPT(category, count) }], temperature: 0.7, max_tokens: 8000
        })
    });
    if (!resp.ok) throw new Error(`Together ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Together yaniti bos");
    return extractJSON(text);
}

const AI_CHAIN = [
    { name: "GROQ", fn: (cat, n) => fetchFromGroq("llama3-70b-8192", cat, n), source: "API-1" },
    { name: "GROQ-fast", fn: (cat, n) => fetchFromGroq("llama3-8b-8192", cat, n), source: "API-1" },
    { name: "Gemini-flash", fn: (cat, n) => fetchFromGemini("gemini-2.0-flash", cat, n), source: "API-2" },
    { name: "Gemini-lite", fn: (cat, n) => fetchFromGemini("gemini-2.0-flash-lite", cat, n), source: "API-2" },
    { name: "OpenRouter", fn: (cat, n) => fetchFromOpenRouter("meta-llama/llama-3.1-8b-instruct:free", cat, n), source: "API-3" },
    { name: "Together", fn: (cat, n) => fetchFromTogether("meta-llama/Llama-3.2-3B-Instruct-Turbo", cat, n), source: "API-4" },
];

app.post('/api/questions', async (req, res) => {
    const { category, questionCount } = req.body;
    if (!category) return res.status(400).json({ error: 'Kategori zorunlu' });
    const count = questionCount || 20;

    for (const provider of AI_CHAIN) {
        try {
            console.log(`[AI] ${provider.name} deneniyor (${count} soru)...`);
            const questions = await provider.fn(category, count);
            console.log(`[AI] ${provider.name} basarili! (${questions.length} soru)`);
            return res.json({ questions: questions.slice(0, count), source: provider.source });
        } catch (err) {
            console.warn(`[AI] ${provider.name} basarisiz: ${err.message}`);
        }
    }

    try {
        const bankQuestions = loadQuestionBank(category, count);
        if (bankQuestions.length > 0) {
            return res.json({ questions: bankQuestions, source: 'Lokal' });
        }
    } catch (err) {
        console.error('[AI] Yerel banka hatasi:', err.message);
    }
    res.status(500).json({ error: 'Hicbir kaynak calismadi' });
});

// ==================== SORU BANKASI ====================
function loadQuestionBank(category, count) {
    const filePath = path.join(__dirname, 'QuestionBank.json');
    const data = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(data);
    const list = json[category];
    if (!Array.isArray(list) || list.length === 0) return [];
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count || 20);
}

app.get('/question-bank', (req, res) => {
    const { category } = req.query;
    if (!category) return res.status(400).json({ error: 'Kategori zorunlu' });
    try {
        const questions = loadQuestionBank(category, 20);
        if (questions.length === 0) return res.status(404).json({ error: 'Soru bulunamadi' });
        res.json(questions);
    } catch (err) {
        res.status(500).json({ error: 'Soru bankasina erisilemedi' });
    }
});

// ==================== ODA YONETIMI ====================
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return rooms.has(code) ? generateRoomCode() : code;
}

app.get('/rooms', (req, res) => {
    const list = [];
    rooms.forEach((room, code) => {
        if (room.gameState === 'waiting') {
            list.push({
                roomCode: code, hostName: room.hostName, category: room.category,
                playerCount: room.players.filter(p => p.connected).length,
                questionCount: room.questionCount || 20,
                maxPlayers: 10, createdAt: room.createdAt
            });
        }
    });
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ serverIP: getLocalIP(), serverPort: PORT, rooms: list });
});

// ==================== NETWORK ====================
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const priority = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'eth'];
    const exclude = ['vmware', 'virtualbox', 'docker', 'hyper-v', 'vpn'];
    const candidates = [];
    for (const [name, ifaces] of Object.entries(interfaces)) {
        const lower = name.toLowerCase();
        if (exclude.some(kw => lower.includes(kw))) continue;
        for (const iface of ifaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const isLAN = iface.address.startsWith('192.168.') || iface.address.startsWith('10.');
                const isPriority = priority.some(kw => lower.includes(kw));
                candidates.push({ address: iface.address, score: (isPriority ? 2 : 0) + (isLAN ? 1 : 0) });
            }
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.address || 'localhost';
}

// ==================== SOCKET.IO ====================
const questionTimers = new Map();

io.on('connection', (socket) => {
    console.log(`[Socket] Baglanti: ${socket.id}`);
    socket.emit('serverInfo', { ip: getLocalIP(), port: PORT });

    socket.on('getRooms', () => {
        const list = [];
        rooms.forEach((room, code) => {
            if (room.gameState === 'waiting') {
                list.push({
                    roomCode: code, hostName: room.hostName, category: room.category,
                    playerCount: room.players.filter(p => p.connected).length,
                    questionCount: room.questionCount || 20,
                    maxPlayers: 10, createdAt: room.createdAt
                });
            }
        });
        list.sort((a, b) => b.createdAt - a.createdAt);
        socket.emit('roomList', { serverIP: getLocalIP(), serverPort: PORT, rooms: list });
    });

    socket.on('createRoom', ({ playerName, category, questionCount }) => {
        const roomCode = generateRoomCode();
        const room = {
            roomCode, host: socket.id, hostName: playerName, category,
            questionCount: questionCount || 20,
            players: [{ id: socket.id, name: playerName, score: 0, connected: true }],
            gameState: 'waiting', currentQuestion: 0, questions: [],
            answers: new Map(), createdAt: Date.now()
        };
        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        console.log(`[Room] Olusturuldu: ${roomCode} (Host: ${playerName}, ${room.questionCount} soru)`);
        socket.emit('roomCreated', { roomCode, players: room.players, isHost: true, questionCount: room.questionCount });
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms.get(roomCode);
        if (!room) return socket.emit('error', 'Oda bulunamadi!');
        if (room.gameState !== 'waiting') return socket.emit('error', 'Bu oda zaten oyunda!');
        if (room.players.some(p => p.name === playerName)) return socket.emit('error', 'Bu isim zaten kullaniliyor!');

        const player = { id: socket.id, name: playerName, score: 0, connected: true };
        room.players.push(player);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        console.log(`[Room] ${playerName} katildi: ${roomCode}`);
        socket.emit('roomJoined', { roomCode, players: room.players, isHost: false, category: room.category, questionCount: room.questionCount });
        socket.to(roomCode).emit('playerJoined', { player, players: room.players });
    });

    socket.on('startGame', ({ roomCode, questions }) => {
        const room = rooms.get(roomCode);
        if (!room) return socket.emit('error', 'Oda bulunamadi!');
        if (room.host !== socket.id) return socket.emit('error', 'Sadece host oyunu baslatabilir!');
        if (!questions?.length) return socket.emit('error', 'Sorular yuklenemedi!');

        room.questions = questions.slice(0, room.questionCount);
        room.gameState = 'playing';
        room.currentQuestion = 0;
        console.log(`[Game] Basladi: ${roomCode} (${room.questions.length} soru)`);
        io.to(roomCode).emit('gameStarted', { totalQuestions: room.questions.length });
        setTimeout(() => sendQuestion(roomCode), 1000);
    });

    socket.on('submitAnswer', ({ roomCode, questionIndex, selectedAnswer, timeLeft }) => {
        const room = rooms.get(roomCode);
        if (!room || room.gameState !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        if (!room.answers.has(questionIndex)) room.answers.set(questionIndex, new Map());
        const qAnswers = room.answers.get(questionIndex);
        if (qAnswers.has(socket.id)) return;

        const question = room.questions[questionIndex];
        const correctAnswer = question.a || question.correctAnswer;
        const isCorrect = selectedAnswer === correctAnswer;
        let scoreGain = !selectedAnswer ? -100 : isCorrect ? 300 : -200;
        player.score += scoreGain;

        qAnswers.set(socket.id, { answer: selectedAnswer, isCorrect, scoreGain, timeLeft });

        // Sadece "cevap alindi" bildir, dogru cevabi gosterme
        socket.emit('answerReceived', { questionIndex });

        // Herkes cevapladiysa reveal yap
        const connectedCount = room.players.filter(p => p.connected).length;
        if (qAnswers.size >= connectedCount) {
            revealAnswer(roomCode, questionIndex);
        }
    });

    socket.on('timeUp', ({ roomCode, questionIndex }) => {
        const room = rooms.get(roomCode);
        if (!room || room.host !== socket.id) return;

        // Sure bitti - cevap vermeyenlere bos cevap yaz
        if (!room.answers.has(questionIndex)) room.answers.set(questionIndex, new Map());
        const qAnswers = room.answers.get(questionIndex);
        const question = room.questions[questionIndex];
        const correctAnswer = question.a || question.correctAnswer;

        room.players.filter(p => p.connected).forEach(p => {
            if (!qAnswers.has(p.id)) {
                p.score -= 100;
                qAnswers.set(p.id, { answer: null, isCorrect: false, scoreGain: -100, timeLeft: 0 });
            }
        });

        revealAnswer(roomCode, questionIndex);
    });

    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.connected = false;

        if (room.host === socket.id) {
            io.to(roomCode).emit('roomClosed', { reason: 'Host oyundan ayrildi' });
            rooms.delete(roomCode);
        } else {
            io.to(roomCode).emit('playerLeft', {
                playerId: socket.id, playerName: player?.name,
                players: room.players.filter(p => p.connected)
            });
            // Kalan herkes cevapladiysa reveal
            if (room.gameState === 'playing') {
                const qi = room.currentQuestion;
                if (room.answers.has(qi)) {
                    const qAnswers = room.answers.get(qi);
                    const connectedCount = room.players.filter(p => p.connected).length;
                    if (qAnswers.size >= connectedCount) revealAnswer(roomCode, qi);
                }
            }
        }
    });
});

function revealAnswer(roomCode, questionIndex) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Cift reveal engelle
    const revealKey = `${roomCode}_${questionIndex}`;
    if (questionTimers.has(revealKey)) return;
    questionTimers.set(revealKey, true);

    const question = room.questions[questionIndex];
    const correctAnswer = question.a || question.correctAnswer;
    const qAnswers = room.answers.get(questionIndex) || new Map();

    // Her oyuncuya kendi sonucunu ve dogru cevabi gonder
    room.players.filter(p => p.connected).forEach(p => {
        const answer = qAnswers.get(p.id);
        const sock = io.sockets.sockets.get(p.id);
        if (sock) {
            sock.emit('revealAnswer', {
                correctAnswer,
                selectedAnswer: answer?.answer || null,
                isCorrect: answer?.isCorrect || false,
                scoreGain: answer?.scoreGain || -100,
                newScore: p.score
            });
        }
    });

    io.to(roomCode).emit('scoresUpdate', {
        players: room.players.map(p => ({ name: p.name, score: p.score }))
    });

    // 2 saniye sonra sonraki soruya gec
    setTimeout(() => {
        questionTimers.delete(revealKey);
        nextQuestion(roomCode);
    }, 2500);
}

function nextQuestion(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.currentQuestion++;
    if (room.currentQuestion >= room.questions.length) endGame(roomCode);
    else sendQuestion(roomCode);
}

function sendQuestion(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const question = room.questions[room.currentQuestion];
    io.to(roomCode).emit('newQuestion', {
        questionIndex: room.currentQuestion,
        totalQuestions: room.questions.length,
        question: { q: question.q, o: question.o, category: question.c || question.category }
    });
}

function endGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.gameState = 'finished';
    const sorted = room.players.filter(p => p.connected).sort((a, b) => b.score - a.score);
    console.log(`[Game] Bitti: ${roomCode}`);
    io.to(roomCode).emit('gameEnded', { players: sorted, winner: sorted[0] });
    setTimeout(() => rooms.delete(roomCode), 30000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('\n========================================');
    console.log('          MIND ARENA SUNUCUSU');
    console.log('========================================');
    console.log(`  Lokal:   http://localhost:${PORT}`);
    console.log(`  LAN IP:  http://${ip}:${PORT}`);
    console.log('========================================\n');
    const isElectron = process.versions?.electron;
    if (!isElectron) {
        const cmd = process.platform === 'win32' ? 'start' : 'open';
        require('child_process').exec(`${cmd} http://localhost:${PORT}`);
    }
});